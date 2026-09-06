import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import {
  circleRoleSchema,
  circleSettingsSchema,
  createCircleSchema,
  createInviteSchema,
  createPinSchema,
  joinCircleSchema,
  ownershipTransferSchema,
  updateCircleSchema,
} from '@circlechat/shared';
import type { Database } from '../../db/client';
import { conversations } from '../../db/schema';
import { notFound, validationFailed } from '../../errors';
import { findReadyAvatarById, issueMediaDownloadUrl } from '../media/service';
import type { StorageGateway } from '../media/storage';
import { unreadCountFor } from '../conversations/service';
import { activePollsForHome } from '../polls/service';
import { serializeMessage } from '../messages/service';
import {
  addPin,
  createCircle,
  createInvite,
  deleteCircle,
  findCircleById,
  getCallerRole,
  getCircleSettings,
  getPinRow,
  joinCircle,
  leaveCircle,
  listMembers,
  listPinRows,
  listMyCircles,
  removeMember,
  removePin,
  pinsCount,
  resolveInvitePreview,
  revokeInvite,
  transferOwnership,
  updateCircleDetails,
  updateCircleSettings,
  updateMemberRole,
  type PinRow,
} from './service';

/** Fallback for Circles created before settings rows existed (raw-seeded rows). */
const DEFAULT_CIRCLE_SETTINGS = {
  themePreset: 'dark_purple',
  accentColor: null,
  backgroundKey: null,
} as const;

/**
 * Circle routes (M4) — docs/API.md. Every handler authorizes server-side via
 * getCallerRole before touching data; non-member failures are generic 404s so
 * Circle existence is not leaked to outsiders.
 */
export async function circleRoutes(
  app: FastifyInstance,
  options: {
    db: Database;
    storage?: StorageGateway;
    /** M10: change-notification publisher for pinboard updates (M6 design). */
    publish?: (event: string, payload: unknown) => void;
  },
): Promise<void> {
  const { db, storage, publish } = options;

  const requireCircle = async (circleId: string, userId: string, minRole?: 'admin') => {
    const circle = await findCircleById(db, circleId);
    const role = circle ? await getCallerRole(db, circleId, userId) : undefined;
    if (!circle || !role || circle.deletedAt) {
      throw notFound('Circle not found.');
    }
    if (minRole && role !== 'owner' && role !== 'admin') {
      throw notFound('Circle not found.');
    }
    return { circle, role };
  };

  app.post('/v1/circles', { config: { auth: true } }, async (request, reply) => {
    const parsed = createCircleSchema.safeParse(request.body);
    if (!parsed.success) {
      throw validationFailed();
    }
    const { avatarMediaId } = parsed.data;
    if (avatarMediaId) {
      // Ownership check: only the caller's own READY avatar-kind media is allowed.
      const mediaRow = await findReadyAvatarById(db, avatarMediaId);
      if (!mediaRow || mediaRow.ownerId !== request.authUser!.userId) {
        throw validationFailed();
      }
    }
    const circle = await createCircle(db, {
      ownerId: request.authUser!.userId,
      name: parsed.data.name,
      description: parsed.data.description,
      avatarMediaId: parsed.data.avatarMediaId,
    });
    request.log.info({ circleId: circle.id }, 'circle-created');
    await reply.code(201).send({
      circle: {
        id: circle.id,
        name: circle.name,
        description: circle.description,
        avatarMediaId: circle.avatarMediaId,
        membersCount: circle.membersCount,
        callerRole: 'owner',
        createdAt: circle.createdAt.toISOString(),
      },
    });
  });

  app.get('/v1/circles', { config: { auth: true } }, async (request, reply) => {
    const rows = await listMyCircles(db, request.authUser!.userId);
    await reply.header('cache-control', 'no-store').send({
      circles: rows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        avatarMediaId: row.avatarMediaId,
        membersCount: row.membersCount,
        callerRole: row.role as 'owner' | 'admin' | 'member',
        // Real unread counts arrive with M5 messaging.
        unreadCount: 0,
      })),
    });
  });

  // Route order: concrete paths before :id params. Public: the invite code
  // itself is the authorization (docs/API.md "Avatar access") — only limited
  // pre-join fields and a short-TTL avatar URL are exposed, never members.
  app.get('/v1/circles/invite-preview', { config: { auth: false } }, async (request, reply) => {
    const { code } = request.query as { code?: string };
    const normalized = (code ?? '').toUpperCase().replace(/[\s-]/g, '');
    const preview = await resolveInvitePreview(db, normalized);
    if (!preview) {
      throw notFound('This invite is not valid.');
    }
    let avatarUrl: string | null = null;
    if (preview.avatarMediaId && storage) {
      avatarUrl = (await issueMediaDownloadUrl(db, storage, { mediaId: preview.avatarMediaId })) ?? null;
    }
    await reply.header('cache-control', 'no-store').send({ preview: { ...preview, avatarUrl } });
  });

  app.post('/v1/circles/join', { config: { auth: true } }, async (request, reply) => {
    const parsed = joinCircleSchema.safeParse(request.body);
    if (!parsed.success) {
      throw validationFailed();
    }
    const outcome = await joinCircle(db, {
      userId: request.authUser!.userId,
      rawCode: parsed.data.inviteCode,
    });
    request.log.info({ circleId: outcome.circleId, userId: request.authUser!.userId }, 'circle-joined');
    await reply.code(201).send({ circleId: outcome.circleId });
  });

  app.get('/v1/circles/:id', { config: { auth: true } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { circle, role } = await requireCircle(id, request.authUser!.userId);
    const members = await listMembers(db, id);
    await reply.header('cache-control', 'no-store').send({
      circle: {
        id: circle.id,
        name: circle.name,
        description: circle.description,
        avatarMediaId: circle.avatarMediaId,
        membersCount: circle.membersCount,
        callerRole: role,
        createdAt: circle.createdAt.toISOString(),
        members: members.map((member) => ({
          userId: member.userId,
          username: member.username,
          displayName: member.displayName,
          role: member.role,
          joinedAt: member.joinedAt.toISOString(),
        })),
      },
    });
  });

  app.patch('/v1/circles/:id', { config: { auth: true } }, async (request, reply) => {
    const parsed = updateCircleSchema.safeParse(request.body);
    if (!parsed.success) {
      throw validationFailed();
    }
    const { id } = request.params as { id: string };
    const { role } = await requireCircle(id, request.authUser!.userId, 'admin');
    const updated = await updateCircleDetails(db, {
      circleId: id,
      callerId: request.authUser!.userId,
      name: parsed.data.name,
      description: parsed.data.description,
    });
    await reply.header('cache-control', 'no-store').send({
      circle: {
        id: updated.id,
        name: updated.name,
        description: updated.description,
        avatarMediaId: updated.avatarMediaId,
        membersCount: updated.membersCount,
        callerRole: role,
        createdAt: updated.createdAt.toISOString(),
      },
    });
  });

  app.delete('/v1/circles/:id', { config: { auth: true } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await requireCircle(id, request.authUser!.userId); // owner check inside service
    await deleteCircle(db, { circleId: id, callerId: request.authUser!.userId });
    await reply.send({ ok: true });
  });

  app.post('/v1/circles/:id/invite', { config: { auth: true } }, async (request, reply) => {
    const parsed = createInviteSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      throw validationFailed();
    }
    const { id } = request.params as { id: string };
    await requireCircle(id, request.authUser!.userId, 'admin');
    const rawCode = await createInvite(db, { circleId: id, expiresInDays: parsed.data.expiresInDays });
    request.log.info({ circleId: id }, 'invite-created'); // raw code never logged
    await reply.code(201).send({ inviteCode: rawCode });
  });

  app.delete('/v1/circles/:id/invite', { config: { auth: true } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await requireCircle(id, request.authUser!.userId, 'admin');
    const revoked = await revokeInvite(db, id);
    await reply.send({ ok: revoked });
  });

  app.delete('/v1/circles/:id/members/me', { config: { auth: true } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await requireCircle(id, request.authUser!.userId);
    await leaveCircle(db, { circleId: id, userId: request.authUser!.userId });
    await reply.send({ ok: true });
  });

  app.delete('/v1/circles/:id/members/:userId', { config: { auth: true } }, async (request, reply) => {
    const { id, userId } = request.params as { id: string; userId: string };
    await requireCircle(id, request.authUser!.userId, 'admin');
    await removeMember(db, {
      circleId: id,
      callerId: request.authUser!.userId,
      targetUserId: userId,
    });
    await reply.send({ ok: true });
  });

  app.patch('/v1/circles/:id/members/:userId', { config: { auth: true } }, async (request, reply) => {
    const body = (request.body ?? {}) as { role?: unknown };
    const parsed = circleRoleSchema.safeParse(body.role);
    if (!parsed.success) {
      throw validationFailed();
    }
    const { id, userId } = request.params as { id: string; userId: string };
    await requireCircle(id, request.authUser!.userId); // owner check inside service
    await updateMemberRole(db, {
      circleId: id,
      callerId: request.authUser!.userId,
      targetUserId: userId,
      role: parsed.data,
    });
    await reply.send({ ok: true });
  });

  app.post('/v1/circles/:id/ownership-transfer', { config: { auth: true } }, async (request, reply) => {
    const parsed = ownershipTransferSchema.safeParse(request.body);
    if (!parsed.success) {
      throw validationFailed();
    }
    const { id } = request.params as { id: string };
    await requireCircle(id, request.authUser!.userId); // owner check inside service
    await transferOwnership(db, {
      circleId: id,
      callerId: request.authUser!.userId,
      newOwnerUserId: parsed.data.newOwnerUserId,
    });
    await reply.send({ ok: true });
  });

  app.get('/v1/circles/:id/settings', { config: { auth: true } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await requireCircle(id, request.authUser!.userId);
    const settings = (await getCircleSettings(db, id)) ?? DEFAULT_CIRCLE_SETTINGS;
    await reply.header('cache-control', 'no-store').send({
      settings: {
        themePreset: settings.themePreset,
        accentColor: settings.accentColor,
        backgroundKey: settings.backgroundKey,
      },
    });
  });

  app.patch('/v1/circles/:id/settings', { config: { auth: true } }, async (request, reply) => {
    const parsed = circleSettingsSchema.safeParse(request.body);
    if (!parsed.success) {
      throw validationFailed();
    }
    const { id } = request.params as { id: string };
    await requireCircle(id, request.authUser!.userId, 'admin');
    await updateCircleSettings(db, {
      circleId: id,
      callerId: request.authUser!.userId,
      ...parsed.data,
    });
    const settings = (await getCircleSettings(db, id)) ?? DEFAULT_CIRCLE_SETTINGS;
    await reply.header('cache-control', 'no-store').send({
      settings: {
        themePreset: settings!.themePreset,
        accentColor: settings!.accentColor,
        backgroundKey: settings!.backgroundKey,
      },
    });
  });

  // M10 Pinboard serializer: pin metadata + the referenced message through the
  // same tombstone-safe message serializer the chat history uses. Media stays
  // metadata-only here — bytes flow through the existing authorized presigned
  // GET (docs/API.md Media), never as stored URLs.
  const serializePin = async (row: PinRow) => ({
    id: row.id,
    messageId: row.messageId,
    pinnedAt: row.pinnedAt.toISOString(),
    pinnedBy: row.pinnedBy,
    message: await serializeMessage(db, row.message),
  });

  // M10 Pinboard (docs/API.md): any active member pins an eligible Circle
  // message; an owner/admin may remove any pin, a member only their own.
  app.get('/v1/circles/:id/pinboard', { config: { auth: true } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await requireCircle(id, request.authUser!.userId);
    const rows = await listPinRows(db, id);
    const items = await Promise.all(rows.map(serializePin));
    await reply.header('cache-control', 'no-store').send({ items });
  });

  app.post(
    '/v1/circles/:id/pinboard',
    { config: { auth: true, rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      await requireCircle(id, request.authUser!.userId);
      const parsed = createPinSchema.safeParse(request.body);
      if (!parsed.success) {
        throw validationFailed();
      }
      const { pin, conversationId } = await addPin(db, {
        circleId: id,
        messageId: parsed.data.messageId,
        callerId: request.authUser!.userId,
      });
      const row = await getPinRow(db, id, pin.id);
      publish?.('pinboard:updated', { circleId: id, conversationId });
      await reply.header('cache-control', 'no-store').code(201).send({
        item: row ? await serializePin(row) : null,
      });
    },
  );

  app.delete(
    '/v1/circles/:id/pinboard/:itemId',
    { config: { auth: true, rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { id, itemId } = request.params as { id: string; itemId: string };
      await requireCircle(id, request.authUser!.userId);
      await removePin(db, { circleId: id, pinId: itemId, callerId: request.authUser!.userId });
      // The publisher routes by conversationId; without it the removal notice
      // would silently no-op and members would keep a stale pinboard.
      const [conversation] = await db
        .select({ id: conversations.id })
        .from(conversations)
        .where(eq(conversations.circleId, id))
        .limit(1);
      publish?.('pinboard:updated', { circleId: id, conversationId: conversation?.id });
      await reply.header('cache-control', 'no-store').send({ ok: true });
    },
  );

  app.get('/v1/circles/:id/home', { config: { auth: true } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { circle, role } = await requireCircle(id, request.authUser!.userId);
    // One conversation per Circle (docs/DATABASE.md §1.5); "Open Chat" routes
    // through it (M5). Members ride along so Circle Home is a single fetch (M9).
    const [conversation] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.circleId, circle.id))
      .limit(1);
    const [members, unreadCount, pinRows, pins, pollStats] = await Promise.all([
      listMembers(db, id),
      conversation
        ? unreadCountFor(db, conversation.id, request.authUser!.userId)
        : Promise.resolve(0),
      listPinRows(db, id, 5),
      pinsCount(db, id),
      // M11: active (unclosed) polls preview + total active count.
      conversation
        ? activePollsForHome(db, conversation.id, request.authUser!.userId)
        : Promise.resolve({ activePolls: [], activePollsCount: 0 }),
    ]);
    await reply.header('cache-control', 'no-store').send({
      home: {
        circleId: circle.id,
        conversationId: conversation?.id ?? null,
        name: circle.name,
        description: circle.description,
        avatarMediaId: circle.avatarMediaId,
        membersCount: circle.membersCount,
        callerRole: role,
        unreadCount,
        activePolls: pollStats.activePolls,
        activePollsCount: pollStats.activePollsCount,
        pinnedItems: await Promise.all(pinRows.map(serializePin)),
        pinsCount: pins,
        members: members.map((member) => ({
          userId: member.userId,
          username: member.username,
          displayName: member.displayName,
          role: member.role,
          joinedAt: member.joinedAt.toISOString(),
        })),
      },
    });
  });
}
