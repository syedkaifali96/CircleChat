import type { Server as SocketServer, Socket } from 'socket.io';
import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from './db/client';
import { circleMembers, circles, conversationParticipants, conversations } from './db/schema';
import { validateSession } from './modules/auth/service';

/**
 * Socket.IO realtime (M2 foundation + M5 minimal message events).
 * - Handshake requires a valid session token (`auth.token`); unauthenticated
 *   handshakes are rejected.
 * - Each admitted socket joins a per-session room; revoking that session
 *   disconnects its sockets immediately (disconnectSessionSockets).
 * - M5: clients join conversation rooms via `join {conversationId}` — access
 *   is re-checked against circle_members / conversation_participants on every
 *   join (docs/API.md Realtime). `typing`/`presence` and other ephemeral
 *   product events arrive with M6. REST stays the source of truth; socket
 *   events are change notifications only.
 */

const SESSION_ROOM_PREFIX = 'sess:';
const CONVERSATION_ROOM_PREFIX = 'conv:';

export interface RealtimeHandle {
  disconnectSessionSockets(sessionId: string): void;
  /**
   * Publishes a change notification to a conversation room. Pure in-process
   * fan-out: whatever authorization applies was enforced before publishing.
   */
  publishToConversation(conversationId: string, event: string, payload: unknown): void;
}

/** True when the user may access this conversation right now (server-side). */
async function canAccessConversation(
  db: Database,
  conversationId: string,
  userId: string,
): Promise<boolean> {
  const rows = await db
    .select({ type: conversations.type, circleId: conversations.circleId })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  const conversation = rows[0];
  if (!conversation) {
    return false;
  }
  if (conversation.type === 'circle') {
    const membership = await db
      .select({ role: circleMembers.role })
      .from(circleMembers)
      .innerJoin(circles, eq(circles.id, circleMembers.circleId))
      .where(
        and(
          eq(circleMembers.circleId, conversation.circleId!),
          eq(circleMembers.userId, userId),
          isNull(circles.deletedAt),
        ),
      )
      .limit(1);
    return membership.length > 0;
  }
  const participant = await db
    .select({ userId: conversationParticipants.userId })
    .from(conversationParticipants)
    .where(
      and(
        eq(conversationParticipants.conversationId, conversationId),
        eq(conversationParticipants.userId, userId),
      ),
    )
    .limit(1);
  return participant.length > 0;
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

  // M5: conversation room join with server-side re-authorization on every
  // attempt (docs/API.md Realtime rules). `leave` only detaches this socket.
  // Malformed ids must ack a clean rejection — never leave the client hanging.
  io.on('connection', (socket: Socket) => {
    socket.on('join', async (payload: unknown, ack?: (result: { ok: boolean }) => void) => {
      const conversationId =
        typeof payload === 'object' && payload !== null
          ? (payload as { conversationId?: unknown }).conversationId
          : undefined;
      if (typeof conversationId !== 'string' || !/^[0-9a-f-]{36}$/i.test(conversationId)) {
        ack?.({ ok: false });
        return;
      }
      try {
        const allowed = await canAccessConversation(db, conversationId, socket.data.userId!);
        if (!allowed) {
          ack?.({ ok: false });
          return;
        }
        socket.join(`${CONVERSATION_ROOM_PREFIX}${conversationId}`);
        ack?.({ ok: true });
      } catch {
        ack?.({ ok: false });
      }
    });

    socket.on('leave', (payload: unknown) => {
      const conversationId =
        typeof payload === 'object' && payload !== null
          ? (payload as { conversationId?: unknown }).conversationId
          : undefined;
      if (typeof conversationId === 'string' && conversationId.length > 0) {
        socket.leave(`${CONVERSATION_ROOM_PREFIX}${conversationId}`);
      }
    });
  });

  return {
    disconnectSessionSockets(sessionId: string): void {
      io.in(`${SESSION_ROOM_PREFIX}${sessionId}`).disconnectSockets(true);
    },
    publishToConversation(conversationId: string, event: string, payload: unknown): void {
      io.in(`${CONVERSATION_ROOM_PREFIX}${conversationId}`).emit(event, payload);
    },
  };
}

/**
 * Publish helper bound at boot: REST modules call this after a committed DB
 * write. publishToConversation keeps room naming in one place.
 */
export function conversationPublisher(handle: RealtimeHandle) {
  return (event: string, payload: unknown) => {
    const conversationId =
      typeof payload === 'object' && payload !== null
        ? (payload as { conversationId?: string }).conversationId
        : undefined;
    if (conversationId) {
      handle.publishToConversation(conversationId, event, payload);
    }
  };
}
