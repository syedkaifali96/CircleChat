import type { FastifyInstance } from 'fastify';
import { mediaUploadIntentSchema } from '@circlechat/shared';
import type { Database } from '../../db/client';
import { validationFailed } from '../../errors';
import { confirmMedia, createMediaIntent, getMediaById } from './service';
import type { StorageGateway } from './storage';

/**
 * Media routes (docs/API.md): upload-intent and confirm. M3 covers avatar
 * uploads; chat media arrives with M5 and will reuse this lifecycle.
 * All routes require authentication; bytes flow directly client ↔ private
 * storage, never through this server.
 */
export async function mediaRoutes(
  app: FastifyInstance,
  options: { db: Database; storage: StorageGateway },
): Promise<void> {
  const { db, storage } = options;

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
}
