import type { FastifyInstance } from 'fastify';
import { mediaUploadIntentSchema } from '@circlechat/shared';
import type { Database } from '../../db/client';
import { validationFailed } from '../../errors';
import { canViewAvatarMedia, confirmMedia, createMediaIntent, getMediaById, issueMediaDownloadUrl } from './service';
import type { StorageGateway } from './storage';

/**
 * Media routes (docs/API.md): upload-intent, confirm and the authorized
 * download endpoint. M3 covers avatar media; chat media arrives with M5 and
 * will reuse this lifecycle. All routes require authentication; bytes flow
 * directly client ↔ private storage, never through this server.
 *
 * GET /v1/media/:id/url applies the documented profile-visibility rule
 * (self or ≥1 shared active Circle with the avatar owner) BEFORE issuing the
 * short-TTL presigned URL; failures return the generic 404 so media
 * existence is never leaked.
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
    // Avatar visibility rule first; the presigned URL is issued only after it
    // passes. Generic 404 for unauthorized/absent/pending/non-avatar media.
    const allowed = await canViewAvatarMedia(db, {
      mediaId: id,
      requesterId: request.authUser!.userId,
      sharesActiveCircle,
    });
    if (!allowed) {
      await reply
        .code(404)
        .header('cache-control', 'no-store')
        .send({ code: 'NOT_FOUND', message: 'Media not found.' });
      return;
    }
    const url = await issueMediaDownloadUrl(db, storage, { mediaId: id });
    if (!url) {
      await reply
        .code(404)
        .header('cache-control', 'no-store')
        .send({ code: 'NOT_FOUND', message: 'Media not found.' });
      return;
    }
    await reply.header('cache-control', 'no-store').send({ url, mediaId: id });
  });
}
