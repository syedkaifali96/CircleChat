import type { FastifyInstance } from 'fastify';
import { avatarAssignSchema, publicUserSchema, profileUpdateSchema } from '@circlechat/shared';
import type { Database } from '../../db/client';
import { notFound, validationFailed } from '../../errors';
import { findReadyAvatarById, issueMediaDownloadUrl } from '../media/service';
import type { StorageGateway } from '../media/storage';
import {
  assignAvatar,
  getProfileByUsername,
  getProfileById,
  sharesActiveCircle,
  updateProfile,
} from './service';

/**
 * Profile routes (docs/API.md M3): PATCH /users/me, POST /users/me/avatar and
 * GET /users/:username (minimal, viewer-restricted). Identity always comes
 * from the authenticated session; username is immutable.
 *
 * Responses carry only approved profile fields via publicUserSchema /
 * minimalProfileSchema — never hashes, tokens or notification settings.
 * Private responses are marked no-store so shared caches cannot retain them.
 */
export async function profileRoutes(
  app: FastifyInstance,
  options: { db: Database; storage: StorageGateway },
): Promise<void> {
  const { db, storage } = options;

  app.patch('/v1/users/me', { config: { auth: true } }, async (request, reply) => {
    const parsed = profileUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      throw validationFailed();
    }
    const updated = await updateProfile(db, request.authUser!.userId, parsed.data);
    await reply
      .header('cache-control', 'no-store')
      .send({
        user: publicUserSchema.parse({
          id: updated.id,
          username: updated.username,
          displayName: updated.displayName,
          bio: updated.bio,
          avatarMediaId: updated.avatarMediaId,
          createdAt: updated.createdAt.toISOString(),
        }),
      });
  });

  app.post('/v1/users/me/avatar', { config: { auth: true } }, async (request, reply) => {
    const parsed = avatarAssignSchema.safeParse(request.body);
    if (!parsed.success) {
      throw validationFailed();
    }
    // Ownership + lifecycle verification: only the uploader's own READY avatar
    // media may be assigned (docs/SECURITY.md §7).
    const mediaRow = await findReadyAvatarById(db, parsed.data.mediaId);
    if (!mediaRow || mediaRow.ownerId !== request.authUser!.userId) {
      throw notFound('Media not found.');
    }
    const updated = await assignAvatar(db, request.authUser!.userId, mediaRow.id);
    await reply
      .header('cache-control', 'no-store')
      .send({
        user: publicUserSchema.parse({
          id: updated.id,
          username: updated.username,
          displayName: updated.displayName,
          bio: updated.bio,
          avatarMediaId: updated.avatarMediaId,
          createdAt: updated.createdAt.toISOString(),
        }),
      });
  });

  app.get('/v1/users/:username', { config: { auth: true } }, async (request, reply) => {
    const { username } = request.params as { username: string };
    const target = await getProfileByUsername(db, username.toLowerCase());
    // Self always allowed; others require a shared active Circle. Existence is
    // not revealed to non-viewers (docs/SECURITY.md §5).
    const allowed =
      target &&
      (target.id === request.authUser!.userId ||
        (await sharesActiveCircle(db, request.authUser!.userId, target.id)));
    if (!allowed) {
      await reply
        .code(404)
        .header('cache-control', 'no-store')
        .send({ code: 'NOT_FOUND', message: 'Profile not found.' });
      return;
    }
    await reply.header('cache-control', 'no-store').send({
      profile: {
        username: target.username,
        displayName: target.displayName,
        avatarMediaId: target.avatarMediaId,
      },
    });
  });

  app.get('/v1/users/me/avatar-url', { config: { auth: true } }, async (request, reply) => {
    // Convenience endpoint: short-TTL presigned GET for the CALLER'S avatar.
    const profile = await getProfileById(db, request.authUser!.userId);
    if (!profile?.avatarMediaId) {
      await reply.code(404).send({ code: 'NOT_FOUND', message: 'No avatar set.' });
      return;
    }
    const mediaRow = await findReadyAvatarById(db, profile.avatarMediaId);
    if (!mediaRow || mediaRow.ownerId !== request.authUser!.userId) {
      await reply.code(404).send({ code: 'NOT_FOUND', message: 'No avatar set.' });
      return;
    }
    const url = await issueMediaDownloadUrl(db, storage, { mediaId: mediaRow.id });
    if (!url) {
      await reply.code(404).send({ code: 'NOT_FOUND', message: 'No avatar set.' });
      return;
    }
    await reply.header('cache-control', 'no-store').send({ url, mediaId: mediaRow.id });
  });
}

