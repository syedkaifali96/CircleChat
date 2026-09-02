import { io as ioClient, type Socket } from 'socket.io-client';
import type { FastifyInstance } from 'fastify';
import { Server as SocketServer } from 'socket.io';
import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { createDatabase, type Database } from '../../db/client';
import { migrateTestDatabase, resolveTestDatabaseUrl, startEmbeddedPostgres } from '../../db/testing';
import { wireRealtime } from '../../realtime';

/**
 * M2 security follow-up: a revoked session must terminate its live Socket.IO
 * connection (docs/SECURITY.md §3). These tests run a REAL Socket.IO server on
 * the Fastify HTTP server and connect REAL socket.io clients, then exercise
 * the three revocation paths that revoke sessions OTHER than the caller:
 * change-password, revoke-all-other-sessions, recovery-reset.
 * (logout and single-session revoke were already covered in M2.)
 */

let client: Client;
let stopEmbedded: (() => Promise<void>) | undefined;
let db: Database;
let app: FastifyInstance;
let io: SocketServer | undefined;
let port: number;
const sockets: Socket[] = [];

const suffix = () => Math.random().toString(36).slice(2, 10);

async function signup(username: string, password = 'super-secret-password'): Promise<Record<string, unknown>> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/signup',
    payload: { username, displayName: `Display ${username}`, password },
  });
  return res.json() as Record<string, unknown>;
}

async function login(username: string, password: string): Promise<Record<string, unknown>> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    payload: { username, password },
  });
  return res.json() as Record<string, unknown>;
}

/** Connects a real socket.io client authenticated by the session token. */
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
  // Wait for the server-side room join to complete.
  await new Promise((resolve) => setTimeout(resolve, 100));
  return socket;
}

/** Resolves when the given socket disconnects (or times out). */
function waitForDisconnect(socket: Socket, timeoutMs = 10_000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (socket.disconnected) {
      resolve();
      return;
    }
    const timer = setTimeout(() => reject(new Error('socket was not disconnected')), timeoutMs);
    socket.on('disconnect', () => {
      clearTimeout(timer);
      resolve();
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
  app = await buildApp({ db });
  const io = new SocketServer(app.server);
  const realtime = wireRealtime(io, db, 30);
  app.decorate('revokeSessionSockets', (sessionId: string) => realtime.disconnectSessionSockets(sessionId));
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

describe('session revocation disconnects live sockets (docs/SECURITY.md §3)', () => {
  afterEach(() => {
    for (const socket of sockets.splice(0)) {
      socket.disconnect();
    }
  });

  it('change-password revokes other sessions and disconnects their sockets; the current socket survives', async () => {
    const username = `cp_${suffix()}`;
    const signupBody = await signup(username);
    const tokenA = signupBody.token as string;
    const loginBody = await login(username, 'super-secret-password');
    const tokenB = loginBody.token as string;

    const socketA = await connectSocket(tokenA);
    const socketB = await connectSocket(tokenB);
    expect(socketA.connected).toBe(true);
    expect(socketB.connected).toBe(true);

    const disconnectB = waitForDisconnect(socketB);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/change-password',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { currentPassword: 'super-secret-password', newPassword: 'brand-new-password-42' },
    });
    expect(res.statusCode).toBe(200);

    await disconnectB; // the revoked session's socket MUST die
    expect(socketB.connected).toBe(false);
    expect(socketA.connected).toBe(true); // current session untouched
  });

  it('revoke-all-other-sessions disconnects the other session socket and preserves the current one', async () => {
    const username = `ro_${suffix()}`;
    const signupBody = await signup(username);
    const tokenA = signupBody.token as string;
    const loginBody = await login(username, 'super-secret-password');
    const tokenB = loginBody.token as string;

    const socketA = await connectSocket(tokenA);
    const socketB = await connectSocket(tokenB);

    const disconnectB = waitForDisconnect(socketB);
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/auth/sessions',
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().revokedSessions).toBe(1);

    await disconnectB;
    expect(socketB.connected).toBe(false);
    expect(socketA.connected).toBe(true);
  });

  it('recovery-reset revokes ALL sessions and disconnects every socket', async () => {
    const username = `rr_${suffix()}`;
    const signupBody = await signup(username);
    const recoveryCode = signupBody.recoveryCode as string;
    const tokenA = signupBody.token as string;
    const loginBody = await login(username, 'super-secret-password');
    const tokenB = loginBody.token as string;

    const socketA = await connectSocket(tokenA);
    const socketB = await connectSocket(tokenB);

    const disconnectA = waitForDisconnect(socketA);
    const disconnectB = waitForDisconnect(socketB);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/recovery-reset',
      payload: { username, recoveryCode, newPassword: 'recovered-password-99' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().revokedSessions).toBe(2);

    await Promise.all([disconnectA, disconnectB]);
    expect(socketA.connected).toBe(false);
    expect(socketB.connected).toBe(false);
  });
});
