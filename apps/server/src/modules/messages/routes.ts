import type { FastifyInstance } from 'fastify';
import {
  addReactionSchema,
  conversationMessagesQuerySchema,
  editMessageSchema,
  messageSchema,
  sendMessageSchema,
} from '@circlechat/shared';
import type { Database } from '../../db/client';
import { validationFailed } from '../../errors';
import {
  addReaction,
  conversationChatHeader,
  deleteMessage,
  editMessage,
  listMessages,
  removeReaction,
  sendMessage,
} from './service';

/**
 * Message routes (M5) — docs/API.md. Authorization happens inside the service
 * (requireConversationAccess) before any data is touched; inputs are parsed
 * with the shared Zod schemas; responses never expose tombstoned content.
 * `publish` fans out minimal Socket.IO change notifications after the DB write
 * (docs/ARCHITECTURE.md §8: REST is the source of truth).
 */
export async function messageRoutes(
  app: FastifyInstance,
  options: { db: Database; publish?: (event: string, payload: unknown) => void },
): Promise<void> {
  const { db, publish } = options;

  app.get('/v1/conversations/:id/messages', { config: { auth: true } }, async (request, reply) => {
    const query = conversationMessagesQuerySchema.safeParse(request.query);
    if (!query.success) {
      throw validationFailed();
    }
    const { id } = request.params as { id: string };
    const page = await listMessages(db, {
      conversationId: id,
      userId: request.authUser!.userId,
      before: query.data.before,
      limit: query.data.limit,
    });
    await reply.header('cache-control', 'no-store').send(page);
  });

  app.post('/v1/conversations/:id/messages', { config: { auth: true } }, async (request, reply) => {
    const parsed = sendMessageSchema.safeParse(request.body);
    if (!parsed.success) {
      throw validationFailed();
    }
    const { id } = request.params as { id: string };
    const result = await sendMessage(db, {
      conversationId: id,
      senderId: request.authUser!.userId,
      body: parsed.data.body!,
      replyToId: parsed.data.replyToId,
      clientMessageId: parsed.data.clientMessageId,
    });
    if (result.created) {
      publish?.('message:new', { conversationId: id, message: result.message });
    }
    await reply.code(result.created ? 201 : 200).send({ message: result.message, created: result.created });
  });

  app.get('/v1/conversations/:id/header', { config: { auth: true } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const header = await conversationChatHeader(db, id, request.authUser!.userId);
    await reply.header('cache-control', 'no-store').send({ header });
  });

  app.patch('/v1/messages/:id', { config: { auth: true } }, async (request, reply) => {
    const parsed = editMessageSchema.safeParse(request.body);
    if (!parsed.success) {
      throw validationFailed();
    }
    const { id } = request.params as { id: string };
    const message = await editMessage(db, {
      messageId: id,
      callerId: request.authUser!.userId,
      body: parsed.data.body,
    });
    publish?.('message:updated', { conversationId: message.conversationId, message });
    await reply.header('cache-control', 'no-store').send({ message: messageSchema.parse(message) });
  });

  app.delete('/v1/messages/:id', { config: { auth: true } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const message = await deleteMessage(db, {
      messageId: id,
      callerId: request.authUser!.userId,
    });
    publish?.('message:deleted', { conversationId: message.conversationId, message });
    await reply.header('cache-control', 'no-store').send({ message: messageSchema.parse(message) });
  });

  app.put('/v1/messages/:id/reactions', { config: { auth: true } }, async (request, reply) => {
    const parsed = addReactionSchema.safeParse(request.body);
    if (!parsed.success) {
      throw validationFailed();
    }
    const { id } = request.params as { id: string };
    const message = await addReaction(db, {
      messageId: id,
      callerId: request.authUser!.userId,
      emoji: parsed.data.emoji,
    });
    publish?.('reaction:changed', { conversationId: message.conversationId, message });
    await reply.header('cache-control', 'no-store').send({ message: messageSchema.parse(message) });
  });

  app.delete('/v1/messages/:id/reactions/:emoji', { config: { auth: true } }, async (request, reply) => {
    const { id, emoji } = request.params as { id: string; emoji: string };
    const parsed = addReactionSchema.safeParse({ emoji });
    if (!parsed.success) {
      throw validationFailed();
    }
    const message = await removeReaction(db, {
      messageId: id,
      callerId: request.authUser!.userId,
      emoji: parsed.data.emoji,
    });
    publish?.('reaction:changed', { conversationId: message.conversationId, message });
    await reply.header('cache-control', 'no-store').send({ message: messageSchema.parse(message) });
  });
}
