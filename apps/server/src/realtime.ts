import type { Server as SocketServer, Socket } from 'socket.io';
import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from './db/client';
import { circleMembers, circles, conversationParticipants, conversations, users } from './db/schema';
import { validateSession } from './modules/auth/service';
import { createPresenceRegistry, TYPING_TTL_MS, type PresenceHandle } from './presence';

/**
 * Socket.IO realtime (M2 foundation → M5 message events → M6 typing/presence).
 * - Handshake requires a valid session token (`auth.token`); unauthenticated
 *   handshakes are rejected.
 * - Each admitted socket joins a per-session room; revoking that session
 *   disconnects its sockets immediately (disconnectSessionSockets).
 * - M5: conversation rooms via `join {conversationId}` — access is re-checked
 *   against circle_members / conversation_participants on every join.
 * - M6: typing indicators are EPHEMERAL (in-memory, server-side TTL expiry —
 *   never persisted). Presence is derived from live connections; on a user's
 *   LAST disconnect the M1 `users.last_seen_at` column is stamped with now().
 *   Broadcasts are fan-out per conversation room, and a room only ever
 *   receives events about a user who is authorized to see it (shared active
 *   Circle or direct conversation — the D1 rule, checked per conversation).
 * - REST remains the source of truth; sockets deliver change notifications.
 */

const SESSION_ROOM_PREFIX = 'sess:';
const CONVERSATION_ROOM_PREFIX = 'conv:';

/** Simple per-user sliding-window limiter for client-emitted events. */
class SocketRateLimiter {
  private hits = new Map<string, number[]>();

  constructor(private readonly max: number, private readonly windowMs: number) {}

  allow(key: string): boolean {
    const now = Date.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }
}

export interface RealtimeHandle {
  disconnectSessionSockets(sessionId: string): void;
  /**
   * Publishes a change notification to a conversation room. Pure in-process
   * fan-out: whatever authorization applies was enforced before publishing.
   */
  publishToConversation(conversationId: string, event: string, payload: unknown): void;
  /** Presence registry — exposed for tests and the REST presence endpoint. */
  presence: PresenceHandle;
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

/** All conversation ids the user is authorized for right now (M5 rooms). */
async function authorizedConversationIds(db: Database, userId: string): Promise<string[]> {
  const circleRows = await db
    .select({ conversationId: conversations.id })
    .from(conversations)
    .innerJoin(circleMembers, eq(circleMembers.circleId, conversations.circleId))
    .innerJoin(circles, eq(circles.id, conversations.circleId))
    .where(and(eq(circleMembers.userId, userId), isNull(circles.deletedAt)));
  const directRows = await db
    .select({ conversationId: conversations.id })
    .from(conversationParticipants)
    .innerJoin(conversations, eq(conversations.id, conversationParticipants.conversationId))
    .where(and(eq(conversationParticipants.userId, userId), eq(conversations.type, 'direct')));
  return [...new Set([...circleRows.map((r) => r.conversationId), ...directRows.map((r) => r.conversationId)])];
}

export function wireRealtime(
  io: SocketServer,
  db: Database,
  ttlDays: number,
  options: { presence?: PresenceHandle } = {},
): RealtimeHandle {
  const presence = options.presence ?? createPresenceRegistry();
  const typingLimiter = new SocketRateLimiter(30, 10_000);

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

  io.on('connection', (socket: Socket) => {
    const userId = socket.data.userId!;

    // ---- Presence (M6): first connection takes the user online. ----------
    if (presence.connect(userId)) {
      (async () => {
        const roomIds = await authorizedConversationIds(db, userId);
        for (const conversationId of roomIds) {
          io.in(`${CONVERSATION_ROOM_PREFIX}${conversationId}`).emit('presence:online', {
            userId,
            lastSeenAt: null,
          });
        }
      })().catch(() => undefined);
    }

    // ---- Conversation room join (M5) with per-attempt authorization. -----
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
        const allowed = await canAccessConversation(db, conversationId, userId);
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

    // ---- Typing (M6): ephemeral, rate-limited, TTL-expired. Timers live
    // here (not in the registry) so expiry can broadcast the stop. ----------
    const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();

    const broadcastTyping = (conversationId: string, typingUserId: string, isTyping: boolean) => {
      io.in(`${CONVERSATION_ROOM_PREFIX}${conversationId}`).emit('typing:update', {
        conversationId,
        userId: typingUserId,
        isTyping,
      });
    };

    const handleTyping = (isTyping: boolean) =>
      async (payload: unknown, ack?: (result: { ok: boolean }) => void) => {
        const conversationId =
          typeof payload === 'object' && payload !== null
            ? (payload as { conversationId?: unknown }).conversationId
            : undefined;
        if (typeof conversationId !== 'string' || !/^[0-9a-f-]{36}$/i.test(conversationId)) {
          ack?.({ ok: false });
          return;
        }
        // Rate limit per user per conversation (docs/SECURITY.md §6).
        if (!typingLimiter.allow(`${userId}:${conversationId}`)) {
          ack?.({ ok: false });
          return;
        }
        try {
          const allowed = await canAccessConversation(db, conversationId, userId);
          if (!allowed) {
            ack?.({ ok: false });
            return;
          }
        } catch {
          ack?.({ ok: false });
          return;
        }
        const timerKey = `${userId}:${conversationId}`;
        if (isTyping) {
          // Only the false → typing transition broadcasts; refreshes reset the TTL.
          if (presence.setTyping(userId, conversationId)) {
            broadcastTyping(conversationId, userId, true);
          }
          const existing = typingTimers.get(timerKey);
          if (existing) {
            clearTimeout(existing);
          }
          typingTimers.set(
            timerKey,
            setTimeout(() => {
              typingTimers.delete(timerKey);
              // Server-side auto-expiry (docs/API.md Realtime): the client
              // never sent typing:stop — the room still learns it stopped.
              if (presence.expireTyping(userId, conversationId)) {
                broadcastTyping(conversationId, userId, false);
              }
            }, TYPING_TTL_MS),
          );
        } else {
          const existing = typingTimers.get(timerKey);
          if (existing) {
            clearTimeout(existing);
            typingTimers.delete(timerKey);
          }
          if (presence.clearTyping(userId, conversationId)) {
            broadcastTyping(conversationId, userId, false);
          }
        }
        ack?.({ ok: true });
      };

    socket.on('typing:start', handleTyping(true));
    socket.on('typing:stop', handleTyping(false));

    // ---- Disconnect (M6): last socket stamps last_seen_at. ---------------
    socket.on('disconnect', () => {
      // A typer whose socket died (crash, network loss, no typing:stop) must
      // have their indicator cleared for the room immediately — never left
      // hanging until TTL. Clearing and broadcasting happen per conversation.
      const typingConversations = presence.typingConversationsOf(userId);
      for (const conversationId of typingConversations) {
        presence.expireTyping(userId, conversationId);
        const timer = typingTimers.get(`${userId}:${conversationId}`);
        if (timer) {
          clearTimeout(timer);
          typingTimers.delete(`${userId}:${conversationId}`);
        }
        broadcastTyping(conversationId, userId, false);
      }
      if (!presence.disconnect(userId)) {
        return; // other devices still online
      }
      void (async () => {
        const lastSeenAt = new Date();
        await db
          .update(users)
          .set({ lastSeenAt })
          .where(eq(users.id, userId));
        const roomIds = await authorizedConversationIds(db, userId);
        for (const conversationId of roomIds) {
          io.in(`${CONVERSATION_ROOM_PREFIX}${conversationId}`).emit('presence:offline', {
            userId,
            lastSeenAt: lastSeenAt.toISOString(),
          });
        }
      })().catch(() => undefined);
    });
  });

  return {
    disconnectSessionSockets(sessionId: string): void {
      io.in(`${SESSION_ROOM_PREFIX}${sessionId}`).disconnectSockets(true);
    },
    publishToConversation(conversationId: string, event: string, payload: unknown): void {
      io.in(`${CONVERSATION_ROOM_PREFIX}${conversationId}`).emit(event, payload);
    },
    presence,
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

export { TYPING_TTL_MS };
