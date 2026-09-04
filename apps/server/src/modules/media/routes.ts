import type { FastifyInstance } from 'fastify';
import { mediaUploadIntentSchema } from '@circlechat/shared';
import type { Database } from '../../db/client';
import { notFound, validationFailed } from '../../errors';
import { requireConversationAccess } from '../conversations/service';
import {
  canViewAvatarMedia,
  confirmMedia,
  createMediaIntent,
  getAccessibleChatMedia,
  getMediaById,
  issueMediaDownloadUrl,
} from './service';
import type { StorageGateway } from './storage';

/**
 * Media routes (docs/API.md): upload-intent, confirm and the authorized
 * download endpoint. M3 covers avatar media; M7 extends the download endpoint
 * to conversation media (chat images/video/voice) with the D1 conversation
 * access rule. All routes require authentication; bytes flow directly
 * client ↔ private storage, never through this server.
 *
 * GET /v1/media/:id/url applies the documented access rules BEFORE issuing
 * the short-TTL presigned URL: conversation media requires the caller to be
 * a participant/member of the bound conversation (or the uploader); avatar
 * media requires the profile-visibility rule (self or ≥1 shared active Circle
 * with the owner). Failures return the generic 404 so media existence is
 * never leaked.
 */
export async function mediaRoutes(
  app: FastifyInstance,
  options: {
    db: Database;
    storage: StorageGateway;
    /** Injected profile-visibility rule (avoids a media→profile import). */
    sharesActiveCircle: (userA: string, userB: string) => Promise<boolean>;
  },
): Promise<void> {
  const { db, storage, sharesActiveCircle } = options;

  app.post('/v1/media/upload-intent', { config: { auth: true } }, async (request, reply) => {
    const parsed = mediaUploadIntentSchema.safeParse(request.body);
    if (!parsed.success) {
      throw validationFailed();
    }
    const intent = await createMediaIntent(db, storage, {
      ownerId: request.authUser!.userId,
      kind: parsed.data.kind,
      mimeType: parsed.data.mimeType,
      sizeBytes: parsed.data.sizeBytes,
    });
    request.log.info({ mediaId: intent.mediaId, kind: parsed.data.kind }, 'media-upload-intent');
    await reply.code(201).send({
      mediaId: intent.mediaId,
      uploadUrl: intent.uploadUrl,
      uploadFields: intent.uploadFields,
    });
  });

  app.post('/v1/media/:id/confirm', { config: { auth: true } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const outcome = await confirmMedia(db, storage, {
      mediaId: id,
      ownerId: request.authUser!.userId,
    });
    if (outcome !== 'ready') {
      // Foreign ids, non-pending rows and failed verification are
      // indistinguishable (docs/SECURITY.md §12).
      await reply.code(404).send({ code: 'NOT_FOUND', message: 'Media not found.' });
      return;
    }
    const row = await getMediaById(db, id);
    await reply.send({ mediaId: id, status: 'ready', kind: row!.kind });
  });

  app.get('/v1/media/:id/url', { config: { auth: true } }, async (request, reply) => {
    const { id } = request.params as { id: string };

    // Conversation media (M7): participant/member of the bound conversation
    // or the uploader. requireConversationAccess throws the generic 404.
    const chatMedia = await getAccessibleChatMedia(db, {
      mediaId: id,
      requesterId: request.authUser!.userId,
      canAccessConversation: (conversationId, requesterId) =>
        requireConversationAccess(db, conversationId, requesterId).then(() => true),
    });
    if (chatMedia) {
      const url = await issueMediaDownloadUrl(db, storage, { mediaId: id });
      if (!url) {
        throw notFound('Media not found.');
      }
      await reply.header('cache-control', 'no-store').send({ url, mediaId: id });
      return;
    }

    // Avatar media falls through to the M3 profile-visibility rule. Generic
    // 404 for unauthorized/absent/pending media — existence is never leaked.
    const allowed = await canViewAvatarMedia(db, {
      mediaId: id,
      requesterId: request.authUser!.userId,
      sharesActiveCircle,
    });
    if (!allowed) {
      throw notFound('Media not found.');
    }
    const url = await issueMediaDownloadUrl(db, storage, { mediaId: id });
    if (!url) {
      throw notFound('Media not found.');
    }
    await reply.header('cache-control', 'no-store').send({ url, mediaId: id });
  });
}
