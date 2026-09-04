/**
 * Presence registry (M6) — in-memory, per socket-server process.
 *
 * Design decision (docs/ARCHITECTURE.md §8, M6): presence is derived purely
 * from live socket connections — a user is online while ≥1 authorized socket
 * exists. `users.last_seen_at` (M1 column) is the ONLY persisted piece,
 * written when a user's last socket disconnects. No `is_online` column: a
 * persisted boolean would drift from the truth (live connections) on every
 * crash/restart, and single-process in-memory state matches the MVP's
 * single-node deployment. Multi-node would need Redis (post-MVP).
 *
 * Typing state is ephemeral-only: never persisted. The registry holds pure
 * state; TTL timers and their broadcasts live in realtime.ts (which owns the
 * io server) so expiry can notify room members.
 */

export interface PresenceHandle {
  /** Increments the connection count; true when the user just came online. */
  connect(userId: string): boolean;
  /** Decrements; true when the user's LAST socket disconnected. */
  disconnect(userId: string): boolean;
  isOnline(userId: string): boolean;
  /** Marks typing; true when this transitioned false → typing. */
  setTyping(userId: string, conversationId: string): boolean;
  /** Clears typing; true when the user was typing (a stop must broadcast). */
  clearTyping(userId: string, conversationId: string): boolean;
  /** Deletes typing state; true when the user was typing before expiry. */
  expireTyping(userId: string, conversationId: string): boolean;
  isTyping(userId: string, conversationId: string): boolean;
  typingConversationsOf(userId: string): string[];
  clearUserTyping(userId: string): void;
  reset(): void;
}

export function createPresenceRegistry(): PresenceHandle {
  const connections = new Map<string, number>();
  const typing = new Map<string, Set<string>>();

  return {
    connect(userId) {
      const next = (connections.get(userId) ?? 0) + 1;
      connections.set(userId, next);
      return next === 1;
    },
    disconnect(userId) {
      const next = (connections.get(userId) ?? 1) - 1;
      if (next <= 0) {
        connections.delete(userId);
        // Their typing state dies with their last connection.
        typing.delete(userId);
        return true;
      }
      connections.set(userId, next);
      return false;
    },
    isOnline(userId) {
      return (connections.get(userId) ?? 0) > 0;
    },
    setTyping(userId, conversationId) {
      let userTyping = typing.get(userId);
      if (!userTyping) {
        userTyping = new Set();
        typing.set(userId, userTyping);
      }
      if (userTyping.has(conversationId)) {
        return false; // refresh only — no duplicate broadcast
      }
      userTyping.add(conversationId);
      return true;
    },
    clearTyping(userId, conversationId) {
      const userTyping = typing.get(userId);
      if (!userTyping?.has(conversationId)) {
        return false;
      }
      userTyping.delete(conversationId);
      return true;
    },
    expireTyping(userId, conversationId) {
      return this.clearTyping(userId, conversationId);
    },
    isTyping(userId, conversationId) {
      return typing.get(userId)?.has(conversationId) ?? false;
    },
    typingConversationsOf(userId) {
      return [...(typing.get(userId) ?? [])];
    },
    clearUserTyping(userId) {
      typing.delete(userId);
    },
    reset() {
      connections.clear();
      typing.clear();
    },
  };
}

export const TYPING_TTL_MS = 6_000;
