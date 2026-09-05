import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { notificationSettingsSchema, usernameSchema } from '@circlechat/shared';
import { users } from '../../db/schema';
import type { Database } from '../../db/client';
import { notFound, validationFailed } from '../../errors';
import { sharesActiveCircle } from '../profile/service';
import { sharesDirectConversationWith } from '../conversations/service';
import type { PresenceHandle } from '../../presence';

/**
 * Minimal user surface: the current authenticated user (session bootstrap),
 * the signup-time username availability check, and the M6 presence endpoint.
 * Presence follows the D1 visibility rule: a viewer sees another user's
 * online state only when they share an active Circle OR an existing direct
 * conversation; everyone else gets a generic 404 (existence not leaked).
 */
export async function usersRoutes(
  app: FastifyInstance,
  options: { db: Database; presence?: PresenceHandle },
): Promise<void> {
  const { db } = options;
  app.get('/v1/users/me', { config: { auth: true } }, async (request, reply) => {
    const rows = await db
      .select({
        id: users.id,
        username: users.username,
        displayName: users.displayName,
        bio: users.bio,
        avatarMediaId: users.avatarMediaId,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, request.authUser!.userId))
      .limit(1);
    const user = rows[0]!;
    await reply
      .header('cache-control', 'no-store')
      .send({
        user: {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          bio: user.bio,
          avatarMediaId: user.avatarMediaId,
          createdAt: user.createdAt.toISOString(),
        },
      });
  });

  app.get(
    '/v1/users/username-available',
    { config: { auth: false, rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { u } = request.query as { u?: string };
      // Format-valid usernames only; format failures are simply "unavailable".
      const formatOk = usernameSchema.safeParse(u?.toLowerCase()).success;
      if (!formatOk) {
        await reply.send({ available: false });
        return;
      }
      const existing = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, u!.toLowerCase()))
        .limit(1);
      await reply.send({ available: existing.length === 0 });
    },
  );

  // M6 presence: isOnline comes from the live-connection registry; the
  // persisted last_seen_at (M1 column) is stamped when the user's last
  // socket disconnects. Unauthorized viewers get the generic 404 so
  // presence state never leaks existence.
  // M8: the caller's own global notification settings (docs/DATABASE.md §1.1).
  // Per-conversation prefs live under /v1/conversations/:id/notification-pref.
  app.get('/v1/users/me/notification-settings', { config: { auth: true } }, async (request, reply) => {
    const rows = await db
      .select({
        notificationsEnabled: users.notificationsEnabled,
        notificationPreview: users.notificationPreview,
      })
      .from(users)
      .where(eq(users.id, request.authUser!.userId))
      .limit(1);
    await reply.header('cache-control', 'no-store').send({ settings: rows[0] });
  });

  app.patch(
    '/v1/users/me/notification-settings',
    { config: { auth: true, rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const parsed = notificationSettingsSchema.safeParse(request.body);
      if (!parsed.success) {
        throw validationFailed();
      }
      const updated = await db
        .update(users)
        .set({
          ...(parsed.data.notificationsEnabled !== undefined
            ? { notificationsEnabled: parsed.data.notificationsEnabled }
            : {}),
          ...(parsed.data.notificationPreview !== undefined
            ? { notificationPreview: parsed.data.notificationPreview }
            : {}),
        })
        .where(eq(users.id, request.authUser!.userId))
        .returning({
          notificationsEnabled: users.notificationsEnabled,
          notificationPreview: users.notificationPreview,
        });
      await reply.header('cache-control', 'no-store').send({ settings: updated[0] });
    },
  );

  app.get('/v1/users/:id/presence', { config: { auth: true } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const requesterId = request.authUser!.userId;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw notFound('User not found.');
    }
    const rows = await db
      .select({ id: users.id, lastSeenAt: users.lastSeenAt })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    const target = rows[0];
    if (!target) {
      throw notFound('User not found.');
    }
    const self = target.id === requesterId;
    const authorized =
      self ||
      (await sharesActiveCircle(db, requesterId, target.id)) ||
      (await sharesDirectConversationWith(db, requesterId, target.id));
    if (!authorized) {
      throw notFound('User not found.');
    }
    await reply.header('cache-control', 'no-store').send({
      presence: {
        userId: target.id,
        isOnline: options.presence?.isOnline(target.id) ?? false,
        lastSeenAt: target.lastSeenAt ? target.lastSeenAt.toISOString() : null,
      },
    });
  });
}
