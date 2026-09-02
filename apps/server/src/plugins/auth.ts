import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Database } from '../db/client';
import { authRequired } from '../errors';
import { validateSession } from '../modules/auth/service';

/**
 * Server-side authentication guard (docs/SECURITY.md §5, ARCHITECTURE §7).
 * The authenticated user is ALWAYS derived from the validated session token —
 * never from client-supplied ids, usernames or body fields.
 */
declare module 'fastify' {
  interface FastifyContextConfig {
    /** Routes declaring `auth: true` require a valid bearer session. */
    auth?: boolean;
  }
  interface FastifyRequest {
    authUser?: { sessionId: string; userId: string };
  }
  interface FastifyInstance {
    db?: Database;
    /** Disconnects any live sockets authenticated by this session. */
    revokeSessionSockets?(sessionId: string): void;
  }
}

export async function requireAuth(request: FastifyRequest, ttlDays: number): Promise<{ sessionId: string; userId: string }> {
  const header = request.headers.authorization;
  const raw = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : undefined;
  if (!raw) {
    throw authRequired();
  }
  const db = request.server.db;
  if (!db) {
    throw authRequired();
  }
  const session = await validateSession(db, raw, ttlDays);
  if (!session) {
    throw authRequired();
  }
  return session;
}

export function registerAuthPlugin(app: FastifyInstance, ttlDays: number): void {
  app.decorateRequest('authUser');
  app.addHook('preHandler', async (request) => {
    // Opt-in guard: routes that declare `config.auth: true` are protected.
    if (request.routeOptions.config?.auth === true) {
      request.authUser = await requireAuth(request, ttlDays);
    }
  });
}
