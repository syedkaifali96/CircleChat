import type { FastifyInstance } from 'fastify';
import {
  addReactionSchema,
  chatMediaUploadSchema,
  conversationMessagesQuerySchema,
  editMessageSchema,
  messageSchema,
  sendMessageSchema,
} from '@circlechat/shared';
import type { Database } from '../../db/client';
import { notFound, validationFailed } from '../../errors';
import { createChatMediaIntent } from '../media/service';
import type { StorageGateway } from '../media/storage';
import { requireConversationAccess as requireConversationAccessFn } from '../conversations/service';
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
 * Message routes (M5 text + M7 media) — docs/API.md. Authorization happens
 * inside the service (requireConversationAccess) before any data is touched;
 * inputs are parsed with the shared Zod schemas; responses never expose
 * tombstoned content. `publish` fans out minimal Socket.IO change notifications
 * after the DB write (docs/ARCHITECTURE.md §8: REST is the source of truth).
 * Media endpoints issue presigned URLs only after the conversation-access
 * check — bytes flow client ↔ private storage, never through this server.
 */
export async function messageRoutes(
  app: FastifyInstance,
  options: {
    db: Database;
    publish?: (event: string, payload: unknown) => void;
    storage?: StorageGateway;
  },
): Promise<void> {
  const { db, publish, storage } = options;

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
      type: parsed.data.type,
      body: parsed.data.body,
      mediaId: parsed.data.mediaId,
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

  // M7: presigned upload for a chat attachment. The requester must be an
  // authorized sender in THIS conversation (same gate as sending text), and
  // the declared kind/MIME/size/duration are validated by the shared schema
  // against the per-kind caps before any URL exists. The presigned download
  // endpoint lives in the media module (single /v1/media/:id/url registration)
  // and applies the conversation-access rule for chat media.
  app.post('/v1/conversations/:id/media/upload-url', { config: { auth: true } }, async (request, reply) => {
    if (!storage) {
      throw notFound('Media storage is not configured.');
    }
    const parsed = chatMediaUploadSchema.safeParse(request.body);
    if (!parsed.success) {
      throw validationFailed();
    }
    const { id } = request.params as { id: string };
    await requireConversationAccessFn(db, id, request.authUser!.userId);
    const intent = await createChatMediaIntent(db, storage, {
      ownerId: request.authUser!.userId,
      conversationId: id,
      kind: parsed.data.kind,
      mimeType: parsed.data.mimeType,
      sizeBytes: parsed.data.sizeBytes,
      durationMs: parsed.data.durationMs,
    });
    request.log.info({ mediaId: intent.mediaId, kind: parsed.data.kind }, 'chat-media-upload-url');
    await reply.code(201).send({
      mediaId: intent.mediaId,
      uploadUrl: intent.uploadUrl,
      uploadFields: intent.uploadFields,
    });
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
