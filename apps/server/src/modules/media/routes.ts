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
import { isGifSearchConfigured, searchGifs } from './gif';
import type { StorageGateway } from './storage';

void getMediaById;

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

  // M7.1: per-user GIF search limiter — searches proxy Tenor and cost real
  // provider quota; abuse must not flow through (docs/SECURITY.md §6).
  const gifSearchHits = new Map<string, number[]>();
  const GIF_SEARCH_LIMIT = 30;
  const GIF_SEARCH_WINDOW_MS = 60_000;

  app.get('/v1/media/gif-search', { config: { auth: true } }, async (request, reply) => {
    if (!isGifSearchConfigured()) {
      // Documented blocker: the owner must supply TENOR_API_KEY; the API key
      // itself never leaves the server environment.
      await reply.code(503).send({
        code: 'GIF_SEARCH_UNAVAILABLE',
        message: 'GIF search is not configured on this server.',
      });
      return;
    }
    const { q } = request.query as { q?: string };
    const query = (q ?? '').trim();
    if (query.length < 1 || query.length > 60) {
      throw validationFailed();
    }
    const requesterId = request.authUser!.userId;
    const now = Date.now();
    const recent = (gifSearchHits.get(requesterId) ?? []).filter((t) => now - t < GIF_SEARCH_WINDOW_MS);
    if (recent.length >= GIF_SEARCH_LIMIT) {
      await reply.code(429).send({ code: 'RATE_LIMITED', message: 'Too many searches. Try again shortly.' });
      return;
    }
    recent.push(now);
    gifSearchHits.set(requesterId, recent);

    try {
      const results = await searchGifs(query);
      await reply.header('cache-control', 'no-store').send({ results });
    } catch (err) {
      request.log.warn({ err }, 'gif search failed');
      await reply.code(502).send({ code: 'GIF_SEARCH_FAILED', message: 'GIF search failed. Try again.' });
    }
  });

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
      log: request.log,
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
    const { variant } = request.query as { variant?: string };

    // Conversation media (M7): participant/member of the bound conversation
    // or the uploader. requireConversationAccess throws the generic 404.
    const chatMedia = await getAccessibleChatMedia(db, {
      mediaId: id,
      requesterId: request.authUser!.userId,
      canAccessConversation: (conversationId, requesterId) =>
        requireConversationAccess(db, conversationId, requesterId).then(() => true),
    });
    if (chatMedia) {
      // M7.1: thumbnail variant falls back to the original when absent.
      const key =
        variant === 'thumb' && chatMedia.thumbnailKey ? chatMedia.thumbnailKey : chatMedia.storageKey;
      const url = await storage.createDownloadUrl(key, 60);
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
