import { io as ioClient, type Socket } from 'socket.io-client';
import type { FastifyInstance } from 'fastify';
import { Server as SocketServer } from 'socket.io';
import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { createDatabase, type Database } from '../../db/client';
import { wireRealtime, conversationPublisher, type RealtimeHandle } from '../../realtime';
import { migrateTestDatabase, resolveTestDatabaseUrl, startEmbeddedPostgres } from '../../db/testing';

/**
 * M5 realtime tests — REAL Socket.IO server + REAL socket.io clients
 * (docs/API.md Realtime, docs/ARCHITECTURE.md §7–8): authorized conversation
 * room join, unauthorized join rejection, and the five message change
 * notifications (message:new/updated/deleted, reaction:changed, read:update).
 * REST is the source of truth; sockets only deliver change events.
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

/** Resolves with the first payload emitted for the given event. */
function waitForEvent<T>(socket: Socket, event: string, timeoutMs = 10_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ${event} event`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

/** Sets up a circle + its conversation, returning ids for the flows. */
async function setupCircleConversation(memberTokens: string[]) {
  const owner = await signup(`rt_ow_${suffix()}`);
  const created = await app.inject({
    method: 'POST',
    url: '/v1/circles',
    headers: bearer(owner.token),
    payload: { name: `RT ${suffix()}` },
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
  io = new SocketServer();
  realtime = wireRealtime(io, db, 30);
  // REST writes publish through the same handle the sockets joined rooms on.
  app = await buildApp({ db, publish: conversationPublisher(realtime) });
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

describe('conversation room authorization (docs/ARCHITECTURE.md §7)', () => {
  it('allows members to join and rejects non-members', async () => {
    const member = await signup(`rt_m_${suffix()}`);
    const outsider = await signup(`rt_o_${suffix()}`);
    const { conversationId } = await setupCircleConversation([member.token]);

    const memberSocket = await connectSocket(member.token);
    const joinOk = await memberSocket.emitWithAck('join', { conversationId });
    expect(joinOk.ok).toBe(true);

    const outsiderSocket = await connectSocket(outsider.token);
    const joinDenied = await outsiderSocket.emitWithAck('join', { conversationId });
    expect(joinDenied.ok).toBe(false);
    void outsiderSocket;

    const badAck = await memberSocket.emitWithAck('join', { conversationId: 'garbage' });
    expect(badAck.ok).toBe(false);
  });

  it('re-authorization applies: a member removed from the Circle cannot re-join', async () => {
    const member = await signup(`rt_rm_${suffix()}`);
    const { owner, conversationId } = await setupCircleConversation([member.token]);
    const memberId = member.userId;

    const socket = await connectSocket(member.token);
    expect((await socket.emitWithAck('join', { conversationId })).ok).toBe(true);

    // Owner removes the member from the Circle (M4 API).
    const circleId = (
      await client.query<{ circle_id: string }>(
        `SELECT circle_id FROM conversations WHERE id = $1`,
        [conversationId],
      )
    ).rows[0]!.circle_id;
    const removal = await app.inject({
      method: 'DELETE',
      url: `/v1/circles/${circleId}/members/${memberId}`,
      headers: bearer(owner.token),
    });
    expect(removal.statusCode).toBe(200);

    // A fresh join after removal must fail (re-checked against circle_members).
    const rejoined = await socket.emitWithAck('join', { conversationId });
    expect(rejoined.ok).toBe(false);
  });
});

describe('message change notifications (docs/API.md Realtime, M5 minimal)', () => {
  it('delivers message:new to authorized room members only', async () => {
    const member = await signup(`rt_n_${suffix()}`);
    const { owner, conversationId } = await setupCircleConversation([member.token]);
    const outsider = await signup(`rt_no_${suffix()}`);

    const memberSocket = await connectSocket(member.token);
    await memberSocket.emitWithAck('join', { conversationId });
    const nextMessage = waitForEvent<{ conversationId: string; message: { body: string } }>(memberSocket, 'message:new');

    // Outsider joins a DIFFERENT room; must not receive our events.
    const outsiderSocket = await connectSocket(outsider.token);
    void outsiderSocket;
    let outsiderSaw = false;
    outsiderSocket.on('message:new', () => {
      outsiderSaw = true;
    });

    const sent = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${conversationId}/messages`,
      headers: bearer(owner.token),
      payload: { type: 'text', body: 'realtime hello', clientMessageId: `rt_${suffix()}` },
    });
    expect(sent.statusCode).toBe(201);

    const payload = await nextMessage;
    expect(payload.conversationId).toBe(conversationId);
    expect(payload.message.body).toBe('realtime hello');
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(outsiderSaw).toBe(false);
  });

  it('publishes message:updated, message:deleted, reaction:changed and read:update', async () => {
    const member = await signup(`rt_u_${suffix()}`);
    const { owner, conversationId } = await setupCircleConversation([member.token]);

    const memberSocket = await connectSocket(member.token);
    await memberSocket.emitWithAck('join', { conversationId });

    const sent = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${conversationId}/messages`,
      headers: bearer(owner.token),
      payload: { type: 'text', body: 'will change', clientMessageId: `rt_${suffix()}` },
    });
    const messageId = (sent.json() as { message: { id: string } }).message.id;

    const updatedPromise = waitForEvent<{ message: { id: string; body: string; editedAt: string | null } }>(memberSocket, 'message:updated');
    await app.inject({
      method: 'PATCH',
      url: `/v1/messages/${messageId}`,
      headers: bearer(owner.token),
      payload: { body: 'changed!' },
    });
    const updated = await updatedPromise;
    expect(updated.message.id).toBe(messageId);
    expect(updated.message.body).toBe('changed!');
    expect(updated.message.editedAt).not.toBeNull();

    const reactionPromise = waitForEvent<{ message: { id: string; reactions: unknown[] } }>(memberSocket, 'reaction:changed');
    await app.inject({
      method: 'PUT',
      url: `/v1/messages/${messageId}/reactions`,
      headers: bearer(owner.token),
      payload: { emoji: '🔥' },
    });
    const reaction = await reactionPromise;
    expect(reaction.message.reactions).toHaveLength(1);

    const deletedPromise = waitForEvent<{ message: { id: string; deleted: boolean } }>(memberSocket, 'message:deleted');
    await app.inject({ method: 'DELETE', url: `/v1/messages/${messageId}`, headers: bearer(owner.token) });
    const deleted = await deletedPromise;
    expect(deleted.message.id).toBe(messageId);
    expect(deleted.message.deleted).toBe(true);

    // Read pointer change (member marks read).
    const readPromise = waitForEvent<{ conversationId: string; userId: string; lastReadMessageId: string | null }>(memberSocket, 'read:update');
    const remaining = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${conversationId}/messages`,
      headers: bearer(owner.token),
      payload: { type: 'text', body: 'read me', clientMessageId: `rt_${suffix()}` },
    });
    const remainingId = (remaining.json() as { message: { id: string } }).message.id;
    await app.inject({
      method: 'POST',
      url: `/v1/conversations/${conversationId}/read`,
      headers: bearer(member.token),
      payload: { lastReadMessageId: remainingId },
    });
    const read = await readPromise;
    expect(read.conversationId).toBe(conversationId);
    expect(read.lastReadMessageId).toBe(remainingId);
  });

  it('revoked sessions are disconnected and cannot keep receiving events', async () => {
    const member = await signup(`rt_rv_${suffix()}`);
    const { conversationId } = await setupCircleConversation([member.token]);
    const socket = await connectSocket(member.token);
    await socket.emitWithAck('join', { conversationId });

    await client.query(`UPDATE sessions SET revoked_at = now() WHERE user_id = $1`, [member.userId]);
    const session = await client.query<{ id: string }>(`SELECT id FROM sessions WHERE user_id = $1`, [member.userId]);
    realtime!.disconnectSessionSockets(session.rows[0]!.id);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('socket was not disconnected')), 10_000);
      socket.on('disconnect', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  });

  it('conversationPublisher fans out to the right room only', async () => {
    const member = await signup(`rt_p_${suffix()}`);
    const { conversationId } = await setupCircleConversation([member.token]);
    const socket = await connectSocket(member.token);
    await socket.emitWithAck('join', { conversationId });

    const eventPromise = waitForEvent<{ conversationId: string }>(socket, 'read:update');
    conversationPublisher(realtime!)('read:update', { conversationId, userId: 'x', lastReadMessageId: null });
    const payload = await eventPromise;
    expect(payload.conversationId).toBe(conversationId);
  });
});
