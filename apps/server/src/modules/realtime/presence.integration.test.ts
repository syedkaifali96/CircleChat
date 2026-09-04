import { io as ioClient, type Socket } from 'socket.io-client';
import type { FastifyInstance } from 'fastify';
import { Server as SocketServer } from 'socket.io';
import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { createDatabase, type Database } from '../../db/client';
import { wireRealtime, conversationPublisher, type RealtimeHandle } from '../../realtime';
import { createPresenceRegistry } from '../../presence';
import { migrateTestDatabase, resolveTestDatabaseUrl, startEmbeddedPostgres } from '../../db/testing';

/**
 * M6 realtime tests — REAL Socket.IO server + REAL socket.io clients over
 * real PostgreSQL (docs/API.md Realtime, docs/ARCHITECTURE.md §8): typing
 * start/stop with room-scoped fan-out, non-member rejection, server-side TTL
 * expiry, per-user rate limiting, presence online/offline with last_seen_at
 * persistence, multi-device counting, revocation interaction, and the
 * D1-authorized REST presence endpoint.
 */

let client: Client;
let stopEmbedded: (() => Promise<void>) | undefined;
let db: Database;
let app: FastifyInstance;
let io: SocketServer | undefined;
let realtime: RealtimeHandle | undefined;
let port: number;
const sockets: Socket[] = [];

const suffix = () => Math.random().toString(36).slice(2, 10);

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

async function signup(username: string): Promise<{ token: string; userId: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/signup',
    payload: { username, displayName: `Display ${username}`, password: 'super-secret-password' },
  });
  const body = res.json() as { token: string; user: { id: string } };
  return { token: body.token, userId: body.user.id };
}

async function connectSocket(token: string): Promise<Socket> {
  const socket = ioClient(`http://127.0.0.1:${port}`, {
    auth: { token },
    transports: ['websocket'],
    reconnection: false,
  });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('connect timeout')), 10_000);
    socket.on('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.on('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  return socket;
}

function waitForEvent<T>(socket: Socket, event: string, timeoutMs = 10_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ${event} event`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

async function disconnectSocket(socket: Socket): Promise<void> {
  await new Promise<void>((resolve) => {
    if (socket.disconnected) {
      resolve();
      return;
    }
    const timer = setTimeout(() => resolve(), 5_000);
    socket.on('disconnect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.disconnect();
  });
}

/** Circle + its conversation, with the given member tokens joined. */
async function setupCircleConversation(memberTokens: string[]): Promise<{
  owner: { token: string; userId: string };
  conversationId: string;
}> {
  const owner = await signup(`m6_ow_${suffix()}`);
  const created = await app.inject({
    method: 'POST',
    url: '/v1/circles',
    headers: bearer(owner.token),
    payload: { name: `M6 ${suffix()}` },
  });
  const circleId = (created.json() as { circle: { id: string } }).circle.id;
  const invite = await app.inject({
    method: 'POST',
    url: `/v1/circles/${circleId}/invite`,
    headers: bearer(owner.token),
    payload: {},
  });
  const code = (invite.json() as { inviteCode: string }).inviteCode;
  for (const token of memberTokens) {
    await app.inject({
      method: 'POST',
      url: '/v1/circles/join',
      headers: bearer(token),
      payload: { inviteCode: code },
    });
  }
  const list = await app.inject({ method: 'GET', url: '/v1/conversations', headers: bearer(owner.token) });
  const conversationId = (list.json() as { conversations: Array<{ id: string; circleId: string | null }> })
    .conversations.find((c) => c.circleId === circleId)!.id;
  return { owner, conversationId };
}

async function createDirect(aToken: string, bUsername: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/conversations/direct',
    headers: bearer(aToken),
    payload: { username: bUsername },
  });
  return (res.json() as { conversationId: string }).conversationId;
}

beforeAll(async () => {
  let url = resolveTestDatabaseUrl();
  if (!url) {
    const embedded = await startEmbeddedPostgres();
    stopEmbedded = embedded.stop;
    url = embedded.url;
  }
  client = new Client({ connectionString: url });
  await client.connect();
  await migrateTestDatabase(client);
  db = createDatabase(url);
  const presence = createPresenceRegistry();
  io = new SocketServer();
  realtime = wireRealtime(io, db, 30, { presence });
  app = await buildApp({ db, publish: conversationPublisher(realtime), presence });
  io.attach(app.server);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  port = typeof address === 'object' && address ? address.port : 0;
}, 300_000);

afterAll(async () => {
  for (const socket of sockets) {
    socket.disconnect();
  }
  io?.close();
  await app.close();
  await db.$client.end();
  await client?.end();
  await stopEmbedded?.();
}, 60_000);

afterEach(() => {
  for (const socket of sockets.splice(0)) {
    socket.disconnect();
  }
});

describe('typing indicators (docs/API.md Realtime, M6)', () => {
  it('broadcasts typing:start/stop only to authorized room members', async () => {
    const member = await signup(`m6_t_${suffix()}`);
    const outsider = await signup(`m6_to_${suffix()}`);
    const { owner, conversationId } = await setupCircleConversation([member.token]);

    const memberSocket = await connectSocket(member.token);
    const joinAck = await memberSocket.emitWithAck('join', { conversationId });
    expect(joinAck.ok).toBe(true);
    const typingPromise = waitForEvent<{ conversationId: string; userId: string; isTyping: boolean }>(
      memberSocket,
      'typing:update',
    );

    let outsiderSawTyping = false;
    const outsiderSocket = await connectSocket(outsider.token);
    outsiderSocket.on('typing:update', () => {
      outsiderSawTyping = true;
    });

    const ownerSocket = await connectSocket(owner.token);
    const ack = await ownerSocket.emitWithAck('typing:start', { conversationId });
    expect(ack.ok).toBe(true);

    const event = await typingPromise;
    expect(event).toEqual({ conversationId, userId: owner.userId, isTyping: true });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(outsiderSawTyping).toBe(false);

    // Attach BEFORE the stop: the broadcast races the ack back to this test.
    const stopEvent = waitForEvent<{ isTyping: boolean }>(memberSocket, 'typing:update');
    const stopAck = await ownerSocket.emitWithAck('typing:stop', { conversationId });
    expect(stopAck.ok).toBe(true);
    expect((await stopEvent).isTyping).toBe(false);
  });

  it('rejects typing from users who cannot access the conversation', async () => {
    const outsider = await signup(`m6_tx_${suffix()}`);
    const { conversationId } = await setupCircleConversation([]);

    const socket = await connectSocket(outsider.token);
    const ack = await socket.emitWithAck('typing:start', { conversationId });
    expect(ack.ok).toBe(false);

    const garbage = await socket.emitWithAck('typing:start', { conversationId: 'garbage' });
    expect(garbage.ok).toBe(false);
  });

  it('auto-expires typing state server-side after the TTL', async () => {
    const member = await signup(`m6_ttl_${suffix()}`);
    const { owner, conversationId } = await setupCircleConversation([member.token]);

    const memberSocket = await connectSocket(member.token);
    await memberSocket.emitWithAck('join', { conversationId });

    const startEvent = waitForEvent<{ userId: string; isTyping: boolean }>(memberSocket, 'typing:update');
    const ownerSocket = await connectSocket(owner.token);
    await ownerSocket.emitWithAck('typing:start', { conversationId });
    const started = await startEvent;
    expect(started.isTyping).toBe(true);

    // Owner never sends typing:stop — the server TTL must emit the stop.
    const stopEvent = waitForEvent<{ userId: string; isTyping: boolean }>(memberSocket, 'typing:update', 10_000);
    const stopped = await stopEvent;
    expect(stopped.isTyping).toBe(false);
    expect(stopped.userId).toBe(owner.userId);
  }, 20_000);

  it('rate limits typing spam per user per conversation', async () => {
    const member = await signup(`m6_rl_${suffix()}`);
    const { owner, conversationId } = await setupCircleConversation([member.token]);

    const ownerSocket = await connectSocket(owner.token);
    // Limit is 30 per 10s window — hammer past it.
    let denied = 0;
    for (let i = 0; i < 40; i++) {
      const ack = await ownerSocket.emitWithAck('typing:start', { conversationId });
      if (!ack.ok) {
        denied += 1;
      }
    }
    expect(denied).toBeGreaterThan(0);
  });

  it('clears the typer indicator in the room when their socket dies mid-typing', async () => {
    // Regression (manual verification finding): a typer whose network drops
    // without typing:stop must not leave the room's indicator hanging — the
    // disconnect handler clears and broadcasts the stop immediately.
    const member = await signup(`m6_kl_${suffix()}`);
    const { owner, conversationId } = await setupCircleConversation([member.token]);

    const memberSocket = await connectSocket(member.token);
    await memberSocket.emitWithAck('join', { conversationId });

    const startPromise = waitForEvent<{ userId: string; isTyping: boolean }>(memberSocket, 'typing:update');
    const typerSocket = await connectSocket(owner.token);
    await typerSocket.emitWithAck('typing:start', { conversationId });
    expect((await startPromise).isTyping).toBe(true);

    // Abrupt network loss: destroy the engine without a close frame and
    // without ever sending typing:stop. (close(force?) — the arg is runtime
    // supported but untyped in this client version.)
    (typerSocket.io.engine.close as (force?: boolean) => void)(true);

    const stopPromise = waitForEvent<{ userId: string; isTyping: boolean }>(memberSocket, 'typing:update', 12_000);
    const stop = await stopPromise;
    expect(stop.userId).toBe(owner.userId);
    expect(stop.isTyping).toBe(false);
  }, 20_000);
});

describe('presence (M6, docs/API.md Realtime)', () => {
  it('broadcasts online on connect and offline + last_seen_at on last disconnect', async () => {
    const member = await signup(`m6_p_${suffix()}`);
    const { owner, conversationId } = await setupCircleConversation([member.token]);

    const memberSocket = await connectSocket(member.token);
    await memberSocket.emitWithAck('join', { conversationId });

    // Owner connecting must broadcast presence:online into the shared room.
    const onlinePromise = waitForEvent<{ userId: string; lastSeenAt: null }>(memberSocket, 'presence:online');
    const ownerSocket = await connectSocket(owner.token);
    const online = await onlinePromise;
    expect(online.userId).toBe(owner.userId);
    expect(online.lastSeenAt).toBeNull();

    // Owner disconnecting broadcasts offline with a last_seen_at timestamp.
    const offlinePromise = waitForEvent<{ userId: string; lastSeenAt: string }>(memberSocket, 'presence:offline');
    await disconnectSocket(ownerSocket);
    const offline = await offlinePromise;
    expect(offline.userId).toBe(owner.userId);
    expect(new Date(offline.lastSeenAt).getTime()).not.toBeNaN();

    // Persisted last_seen_at (docs/DATABASE.md §1.1).
    const row = await client.query<{ last_seen_at: Date | null }>(
      `SELECT last_seen_at FROM users WHERE id = $1`,
      [owner.userId],
    );
    expect(row.rows[0]!.last_seen_at).not.toBeNull();
  });

  it('keeps a user online while ANY device is connected (multi-device)', async () => {
    const member = await signup(`m6_md_${suffix()}`);
    const { owner, conversationId } = await setupCircleConversation([member.token]);

    const memberSocket = await connectSocket(member.token);
    await memberSocket.emitWithAck('join', { conversationId });
    const ownerSocketA = await connectSocket(owner.token);
    const ownerSocketB = await connectSocket(owner.token);

    // First device disconnects: no offline event (second still connected).
    let sawOffline = false;
    memberSocket.on('presence:offline', () => {
      sawOffline = true;
    });
    await disconnectSocket(ownerSocketA);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(sawOffline).toBe(false);

    // Last device disconnects: offline event fires.
    const offlinePromise = waitForEvent<{ userId: string }>(memberSocket, 'presence:offline');
    await disconnectSocket(ownerSocketB);
    const offline = await offlinePromise;
    expect(offline.userId).toBe(owner.userId);
    void conversationId;
  });

  it('hides presence from users without a shared Circle or direct conversation', async () => {
    const stranger = await signup(`m6_st_${suffix()}`);
    const target = await signup(`m6_tg_${suffix()}`);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/users/${target.userId}/presence`,
      headers: bearer(stranger.token),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_FOUND');
  });

  it('serves presence over REST to users sharing an active Circle (200)', async () => {
    const member = await signup(`m6_pr_${suffix()}`);
    const { owner } = await setupCircleConversation([member.token]);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/users/${owner.userId}/presence`,
      headers: bearer(member.token),
    });
    expect(res.statusCode).toBe(200);
    const presence = res.json().presence as { userId: string; isOnline: boolean; lastSeenAt: string | null };
    expect(presence.userId).toBe(owner.userId);
    expect(presence.isOnline).toBe(false); // not connected in this test
    expect(presence.lastSeenAt).toBeNull(); // never connected
  });

  it('serves own presence and reflects live online state from sockets', async () => {
    const member = await signup(`m6_po_${suffix()}`);
    const { conversationId } = await setupCircleConversation([]);
    const socket = await connectSocket(member.token);
    await socket.emitWithAck('join', { conversationId });

    const self = await app.inject({
      method: 'GET',
      url: `/v1/users/${member.userId}/presence`,
      headers: bearer(member.token),
    });
    expect(self.statusCode).toBe(200);
    expect((self.json().presence as { isOnline: boolean }).isOnline).toBe(true);
  });

  it('serves presence over REST to users sharing a direct conversation', async () => {
    const a = await signup(`m6_da_${suffix()}`);
    const b = await signup(`m6_db_${suffix()}`);
    // A shared Circle is the prerequisite for creating the DM (D1 rule).
    const circle = await app.inject({
      method: 'POST',
      url: '/v1/circles',
      headers: bearer(a.token),
      payload: { name: `M6DM ${suffix()}` },
    });
    const circleId = (circle.json() as { circle: { id: string } }).circle.id;
    const invite = await app.inject({
      method: 'POST',
      url: `/v1/circles/${circleId}/invite`,
      headers: bearer(a.token),
      payload: {},
    });
    await app.inject({
      method: 'POST',
      url: '/v1/circles/join',
      headers: bearer(b.token),
      payload: { inviteCode: (invite.json() as { inviteCode: string }).inviteCode },
    });
    const bName = (await client.query<{ username: string }>(`SELECT username FROM users WHERE id = $1`, [b.userId])).rows[0]!.username;
    await createDirect(a.token, bName);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/users/${b.userId}/presence`,
      headers: bearer(a.token),
    });
    expect(res.statusCode).toBe(200);
    expect((res.json().presence as { userId: string }).userId).toBe(b.userId);
  });

  it('revoked sessions disconnect and the user goes offline', async () => {
    const member = await signup(`m6_rv_${suffix()}`);
    const { conversationId } = await setupCircleConversation([member.token]);
    const socket = await connectSocket(member.token);
    await socket.emitWithAck('join', { conversationId });

    await client.query(`UPDATE sessions SET revoked_at = now() WHERE user_id = $1`, [member.userId]);
    // Same hook the M2/M5 revocation paths call: revoked sessions die.
    const session = await client.query<{ id: string }>(`SELECT id FROM sessions WHERE user_id = $1`, [member.userId]);
    realtime!.disconnectSessionSockets(session.rows[0]!.id);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('socket was not disconnected')), 10_000);
      socket.on('disconnect', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(realtime!.presence.isOnline(member.userId)).toBe(false);

    const row = await client.query<{ last_seen_at: Date | null }>(
      `SELECT last_seen_at FROM users WHERE id = $1`,
      [member.userId],
    );
    expect(row.rows[0]!.last_seen_at).not.toBeNull();

    // A revoked token cannot reconnect.
    await expect(connectSocket(member.token)).rejects.toThrow();
  });
});
