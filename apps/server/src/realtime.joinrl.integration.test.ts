import { io as ioClient, type Socket } from 'socket.io-client';
import type { FastifyInstance } from 'fastify';
import { Server as SocketServer } from 'socket.io';
import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app';
import { createDatabase, type Database } from './db/client';
import { migrateTestDatabase, resolveTestDatabaseUrl, startEmbeddedPostgres } from './db/testing';
import { wireRealtime, conversationPublisher } from './realtime';
import { createPresenceRegistry } from './presence';

/**
 * M15: per-user socket event rate limiting on `join`/`leave`
 * (docs/SECURITY.md §6). The limiter is per-user per-minute, so a runaway
 * client must exhaust the allowance before its joins start failing —
 * authorized joins below the limit keep succeeding (the last one proves
 * the limit, not the authorization, is what rejected the spam).
 */

let client: Client;
let stopEmbedded: (() => Promise<void>) | undefined;
let db: Database;
let app: FastifyInstance;
let io: SocketServer | undefined;
let port: number;
const sockets: Socket[] = [];

const suffix = () => Math.random().toString(36).slice(2, 10);

async function signup(username: string): Promise<{ token: string; userId: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/signup',
    payload: { username, displayName: `Display ${username}`, password: 'super-secret-password' },
  });
  const body = res.json() as { token: string; user: { id: string } };
  return { token: body.token, userId: body.user.id };
}

async function formCircle(ownerToken: string, members: Array<{ token: string }>): Promise<string> {
  const created = await app.inject({
    method: 'POST',
    url: '/v1/circles',
    headers: { authorization: `Bearer ${ownerToken}` },
    payload: { name: `JoinRL ${suffix()}` },
  });
  const circleId = (created.json() as { circle: { id: string } }).circle.id;
  const invite = await app.inject({
    method: 'POST',
    url: `/v1/circles/${circleId}/invite`,
    headers: { authorization: `Bearer ${ownerToken}` },
    payload: {},
  });
  const code = (invite.json() as { inviteCode: string }).inviteCode;
  for (const member of members) {
    await app.inject({
      method: 'POST',
      url: '/v1/circles/join',
      headers: { authorization: `Bearer ${member.token}` },
      payload: { inviteCode: code },
    });
  }
  return circleId;
}

async function circleConversationId(token: string, circleId: string): Promise<string> {
  const list = await app.inject({ method: 'GET', url: '/v1/conversations', headers: { authorization: `Bearer ${token}` } });
  const conv = (list.json() as { conversations: Array<{ id: string; circleId: string | null }> })
    .conversations.find((c) => c.circleId === circleId)!;
  return conv.id;
}

function connectSocket(token: string): Promise<Socket> {
  const socket = ioClient(`http://127.0.0.1:${port}`, {
    auth: { token },
    transports: ['websocket'],
    reconnection: false,
  });
  sockets.push(socket);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('connect timeout')), 10_000);
    socket.on('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.on('connect_error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

function emitJoin(socket: Socket, conversationId: string): Promise<boolean> {
  return new Promise((resolve) => {
    socket.timeout(5_000).emit('join', { conversationId }, (err: unknown, ack?: { ok: boolean }) => {
      if (err) {
        resolve(false);
        return;
      }
      resolve(ack?.ok === true);
    });
  });
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
  const realtime = wireRealtime(io, db, 30, { presence });
  app = await buildApp({
    db,
    publish: conversationPublisher(realtime),
    presence,
    logger: { level: 'error' },
  });
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
  await client.end();
  await stopEmbedded?.();
}, 60_000);

afterEach(() => {
  for (const socket of sockets.splice(0)) {
    socket.disconnect();
  }
});

describe('socket join/leave rate limit (docs/SECURITY.md §6)', () => {
  it('lets an authorized user join below the limit', async () => {
    const owner = await signup(`jrl_ok_${suffix()}`);
    const circleId = await formCircle(owner.token, []);
    const conversationId = await circleConversationId(owner.token, circleId);

    const socket = await connectSocket(owner.token);
    const ok = await emitJoin(socket, conversationId);
    expect(ok).toBe(true);
  });

  it('starts rejecting joins after the per-user allowance is exhausted, then recovers nothing until the window passes', async () => {
    const owner = await signup(`jrl_rl_${suffix()}`);
    const circleId = await formCircle(owner.token, []);
    const conversationId = await circleConversationId(owner.token, circleId);

    const socket = await connectSocket(owner.token);
    // Exhaust the 60/minute allowance. Every attempt is authorized, so any
    // rejection past the allowance proves the limiter fired.
    let sawRejection = false;
    for (let i = 0; i < 65; i++) {
      const ok = await emitJoin(socket, conversationId);
      if (!ok) {
        sawRejection = true;
        break;
      }
    }
    expect(sawRejection).toBe(true);

    // Still rejected immediately after — the window has not reset.
    const stillLimited = await emitJoin(socket, conversationId);
    expect(stillLimited).toBe(false);
  });
});
