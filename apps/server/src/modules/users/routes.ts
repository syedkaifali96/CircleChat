import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { usernameSchema } from '@circlechat/shared';
import { users } from '../../db/schema';
import type { Database } from '../../db/client';

/**
 * Minimal user surface belonging to the M2 authentication scope:
 * the current authenticated user (session bootstrap) and the signup-time
 * username availability check. Profile editing arrives in M3.
 */
export async function usersRoutes(
  app: FastifyInstance,
  options: { db: Database },
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
    await reply.send({
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
}
