import type { Server as SocketServer } from 'socket.io';
import type { Database } from './db/client';
import { validateSession } from './modules/auth/service';

/**
 * Socket.IO authentication foundation (M2, docs/API.md Realtime, SECURITY.md §3).
 * - Handshake requires a valid session token (`auth.token`); unauthenticated
 *   handshakes are rejected.
 * - Each admitted socket joins a per-session room; revoking that session
 *   disconnects its sockets immediately (see disconnectSessionSockets).
 * - NO product events exist in M2 — messaging arrives in M5.
 */

const SESSION_ROOM_PREFIX = 'sess:';

export interface RealtimeHandle {
  disconnectSessionSockets(sessionId: string): void;
}

export function wireRealtime(io: SocketServer, db: Database, ttlDays: number): RealtimeHandle {
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (typeof token !== 'string' || token.length === 0) {
      next(new Error('AUTH_REQUIRED'));
      return;
    }
    const session = await validateSession(db, token, ttlDays);
    if (!session) {
      next(new Error('AUTH_REQUIRED'));
      return;
    }
    socket.data.sessionId = session.sessionId;
    socket.data.userId = session.userId;
    socket.join(`${SESSION_ROOM_PREFIX}${session.sessionId}`);
    next();
  });

  // M2: no product events are wired. Messaging/realtime events arrive in M5
  // with server-side membership authorization per docs/ARCHITECTURE.md §8.

  return {
    disconnectSessionSockets(sessionId: string): void {
      io.in(`${SESSION_ROOM_PREFIX}${sessionId}`).disconnectSockets(true);
    },
  };
}
