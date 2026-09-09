import { io, type Socket } from 'socket.io-client';
import { loadSessionToken } from '../auth/session';

/**
 * Socket.IO client (M6): one lazy singleton per app process, authenticated
 * with the session token (docs/SECURITY.md §3). Typing and presence are
 * change notifications only — REST stays the source of truth. The server
 * re-authorizes every room join; this client never assumes access.
 */

const API_SOCKET_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

let socket: Socket | null = null;
let connecting: Promise<Socket> | null = null;

/** Callbacks survive reconnects; re-registered by screens on mount. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- socket.io payloads are untyped wire data
type Handler = (payload: any) => void;
const handlers = new Map<string, Set<Handler>>();

function emit_local(event: string, payload: Record<string, unknown>): void {
  const set = handlers.get(event);
  if (set) {
    for (const handler of set) {
      handler(payload);
    }
  }
}
void emit_local; // reserved for M7 local echo; registry kept intentionally

export interface ConversationRoomOptions {
  conversationId: string;
  onTyping?: (payload: { conversationId: string; userId: string; isTyping: boolean }) => void;
  onPresence?: (payload: { userId: string; lastSeenAt: string | null; online: boolean }) => void;
  onMessage?: (payload: { conversationId: string; [key: string]: unknown }) => void;
}

/**
 * Ensures the socket is connected and joined to the conversation room.
 * Returns an unsubscribe function that removes the supplied listeners but
 * keeps the shared socket alive for other screens.
 */
export async function subscribeToConversation(options: ConversationRoomOptions): Promise<() => void> {
  const active = await ensureSocket();
  await new Promise<void>((resolve) => {
    if (active.connected) {
      resolve();
      return;
    }
    active.once('connect', () => resolve());
    // connect_error leaves the socket null; callers render REST data anyway.
    active.once('connect_error', () => resolve());
  });
  if (!socket || !socket.connected) {
    return () => undefined;
  }

  await new Promise<void>((resolve) => {
    socket!.emitWithAck('join', { conversationId: options.conversationId })
      .then(() => resolve())
      .catch(() => resolve());
  });

  const typingHandler: Handler = (payload) => options.onTyping?.(payload);
  const presenceOnline: Handler = (payload) =>
    options.onPresence?.({ ...payload, online: true });
  const presenceOffline: Handler = (payload) =>
    options.onPresence?.({ ...payload, online: false });
  const messageHandler: Handler = (payload) => options.onMessage?.(payload);

  socket.on('typing:update', typingHandler);
  socket.on('presence:online', presenceOnline);
  socket.on('presence:offline', presenceOffline);
  socket.on('message:new', messageHandler);
  socket.on('message:updated', messageHandler);
  socket.on('message:deleted', messageHandler);

  return () => {
    if (!socket) {
      return;
    }
    socket.off('typing:update', typingHandler);
    socket.off('presence:online', presenceOnline);
    socket.off('presence:offline', presenceOffline);
    socket.off('message:new', messageHandler);
    socket.off('message:updated', messageHandler);
    socket.off('message:deleted', messageHandler);
    socket.emit('leave', { conversationId: options.conversationId });
  };
}

async function ensureSocket(): Promise<Socket> {
  if (socket?.connected) {
    return socket;
  }
  if (connecting) {
    return connecting;
  }
  connecting = (async () => {
    const token = (await loadSessionToken()) ?? '';
    socket?.disconnect();
    socket = io(`${API_SOCKET_URL}`, {
      auth: { token },
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
    });
    // Re-join rooms after a reconnect: the server re-checks access on every
    // join, so replaying joins is safe and required (docs/API.md Realtime).
    socket.io.on('reconnect', () => {
      for (const conversationId of joinedRooms) {
        socket?.emit('join', { conversationId });
      }
    });
    return socket;
  })();
  const result = await connecting;
  connecting = null;
  return result;
}

const joinedRooms = new Set<string>();

/** Marks the conversation as one to re-join automatically after reconnects. */
export function trackJoinedRoom(conversationId: string): void {
  joinedRooms.add(conversationId);
}

/** Stops reconnects from silently rejoining a room after its screen closed. */
export function untrackJoinedRoom(conversationId: string): void {
  joinedRooms.delete(conversationId);
}

/** Optimistic typing signals; the server rate-limits and TTL-expires them. */
export function sendTypingStart(conversationId: string): void {
  socket?.emit('typing:start', { conversationId });
}

export function sendTypingStop(conversationId: string): void {
  socket?.emit('typing:stop', { conversationId });
}

/** Test/teardown helper: drops the singleton and all listeners. */
export function resetSocket(): void {
  socket?.disconnect();
  socket = null;
  connecting = null;
  handlers.clear();
  joinedRooms.clear();
}
