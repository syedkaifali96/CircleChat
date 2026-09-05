import type { FastifyInstance } from 'fastify';
import {
  conversationListItemSchema,
  conversationReadSchema,
  directUsernameSchema,
  notificationPrefSchema,
} from '@circlechat/shared';
import type { Database } from '../../db/client';
import { validationFailed } from '../../errors';
import {
  findOrCreateDirectConversation,
  getNotificationPref,
  listConversationsFor,
  markConversationRead,
  requireConversationAccess,
  updateNotificationPref,
} from './service';

/**
 * Conversation routes (M5) — docs/API.md. Every handler authorizes through
 * requireConversationAccess (circle_members / conversation_participants)
 * before touching data; failures are generic 404s so existence is hidden.
 * Unread counts are computed server-side, never accepted from clients.
 */
export async function conversationRoutes(
  app: FastifyInstance,
  options: { db: Database; publish?: (event: string, payload: unknown) => void },
): Promise<void> {
  const { db, publish } = options;

  app.post('/v1/conversations/direct', { config: { auth: true } }, async (request, reply) => {
    const parsed = directUsernameSchema.safeParse((request.body as { username?: unknown } | null)?.username);
    if (!parsed.success) {
      throw validationFailed();
    }
    const result = await findOrCreateDirectConversation(db, {
      callerId: request.authUser!.userId,
      targetUsername: parsed.data,
    });
    await reply.code(result.created ? 201 : 200).send({
      conversationId: result.conversationId,
      created: result.created,
    });
  });

  app.get('/v1/conversations', { config: { auth: true } }, async (request, reply) => {
    const items = await listConversationsFor(db, request.authUser!.userId);
    await reply.header('cache-control', 'no-store').send({
      conversations: items.map((item) => conversationListItemSchema.parse(item)),
    });
  });

  app.post('/v1/conversations/:id/read', { config: { auth: true } }, async (request, reply) => {
    const parsed = conversationReadSchema.safeParse(request.body);
    if (!parsed.success) {
      throw validationFailed();
    }
    const { id } = request.params as { id: string };
    await requireConversationAccess(db, id, request.authUser!.userId);
    const result = await markConversationRead(db, {
      conversationId: id,
      userId: request.authUser!.userId,
      lastReadMessageId: parsed.data.lastReadMessageId,
    });
    publish?.('read:update', {
      conversationId: id,
      userId: request.authUser!.userId,
      lastReadMessageId: result.lastReadMessageId,
    });
    await reply.header('cache-control', 'no-store').send(result);
  });

  app.get('/v1/conversations/:id/notification-pref', { config: { auth: true } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await requireConversationAccess(db, id, request.authUser!.userId);
    const pref = await getNotificationPref(db, {
      conversationId: id,
      userId: request.authUser!.userId,
    });
    await reply.header('cache-control', 'no-store').send({ pref });
  });

  app.patch('/v1/conversations/:id/notification-pref', { config: { auth: true } }, async (request, reply) => {
    const parsed = notificationPrefSchema.safeParse(request.body);
    if (!parsed.success) {
      throw validationFailed();
    }
    const { id } = request.params as { id: string };
    await requireConversationAccess(db, id, request.authUser!.userId);
    const pref = await updateNotificationPref(db, {
      conversationId: id,
      userId: request.authUser!.userId,
      ...parsed.data,
    });
    await reply.header('cache-control', 'no-store').send({ pref });
  });
}
