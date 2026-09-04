import { io as ioClient, type Socket } from 'socket.io-client';
import type { FastifyInstance } from 'fastify';
import { Server as SocketServer } from 'socket.io';
import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { createDatabase, type Database } from '../../db/client';
import { wireRealtime, conversationPublisher } from '../../realtime';
import { createPresenceRegistry } from '../../presence';
import { InMemoryStorageGateway } from '../media/storage';
import { migrateTestDatabase, resolveTestDatabaseUrl, startEmbeddedPostgres } from '../../db/testing';

/**
 * M7 media messaging integration tests — real PostgreSQL, real Socket.IO,
 * in-memory private storage (same gateway interface as R2). Covers the
 * docs/API.md media contract: conversation-scoped presigned uploads, the
 * confirmed-upload gate before message creation, media metadata in payloads,
 * per-kind caps (voice 2 minutes), D1 download authorization and realtime
 * delivery of confirmed media messages only.
 */

let client: Client;
let stopEmbedded: (() => Promise<void>) | undefined;
let db: Database;
let app: FastifyInstance;
let io: SocketServer | undefined;
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

async function setupCircleConversation(memberTokens: string[]): Promise<{ owner: { token: string; userId: string }; conversationId: string }> {
  const owner = await signup(`m7_ow_${suffix()}`);
  const created = await app.inject({
    method: 'POST',
    url: '/v1/circles',
    headers: bearer(owner.token),
    payload: { name: `M7 ${suffix()}` },
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

const PNG_BYTES = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000049454e44ae426082',
  'hex',
);
/** Minimal mp4-signature buffer ('ftyp' at offset 4) padded to 1200 bytes. */
const AUDIO_BYTES = Buffer.alloc(1200);
AUDIO_BYTES.write('ftyp', 4, 'ascii');

/** Full upload lifecycle for one chat attachment: URL → PUT → confirm. */
async function uploadChatMedia(
  token: string,
  conversationId: string,
  body: Record<string, unknown>,
  bytes: Buffer = PNG_BYTES,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const intent = await app.inject({
    method: 'POST',
    url: `/v1/conversations/${conversationId}/media/upload-url`,
    headers: bearer(token),
    payload: body,
  });
  if (intent.statusCode !== 201) {
    return { status: intent.statusCode, json: intent.json() as Record<string, unknown> };
  }
  const { mediaId, uploadFields } = intent.json() as { mediaId: string; uploadFields: Record<string, string> };
  // The stored object must match the declared sizeBytes (server HEAD check).
  const declared = body.sizeBytes as number;
  const stored = Buffer.alloc(declared);
  bytes.copy(stored, 0, 0, Math.min(bytes.length, declared));
  const storage = appStorage!;
  storage.put(uploadFields.key!, stored);
  const confirm = await app.inject({
    method: 'POST',
    url: `/v1/media/${mediaId}/confirm`,
    headers: bearer(token),
  });
  return { status: confirm.statusCode, json: { ...confirm.json(), mediaId } as Record<string, unknown> };
}

let appStorage: InMemoryStorageGateway | undefined;

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
  appStorage = new InMemoryStorageGateway();
  const presence = createPresenceRegistry();
  io = new SocketServer();
  const realtime = wireRealtime(io, db, 30, { presence });
  app = await buildApp({
    db,
    storage: appStorage,
    publish: conversationPublisher(realtime),
    presence,
    // Surface unhandled errors from the flows under test.
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
  await client?.end();
  await stopEmbedded?.();
}, 60_000);

afterEach(() => {
  for (const socket of sockets.splice(0)) {
    socket.disconnect();
  }
});

describe('chat media upload-url (docs/API.md M7)', () => {
  it('issues a presigned URL for an authorized member and binds the row to the conversation', async () => {
    const member = await signup(`m7_m_${suffix()}`);
    const { conversationId } = await setupCircleConversation([member.token]);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${conversationId}/media/upload-url`,
      headers: bearer(member.token),
      payload: { kind: 'image', mimeType: 'image/png', sizeBytes: PNG_BYTES.length },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { mediaId: string; uploadUrl: string; uploadFields: Record<string, string> };
    expect(body.uploadUrl).toBeTruthy();
    expect(body.uploadFields.key).toMatch(/^chat\/image\//);

    const row = await client.query<{ conversation_id: string | null; status: string; kind: string }>(
      `SELECT conversation_id::text, status, kind FROM media WHERE id = $1`,
      [body.mediaId],
    );
    expect(row.rows[0]).toEqual({ conversation_id: conversationId, status: 'pending', kind: 'image' });
  });

  it('rejects non-members and unauthenticated callers', async () => {
    const outsider = await signup(`m7_o_${suffix()}`);
    const { conversationId } = await setupCircleConversation([]);

    const denied = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${conversationId}/media/upload-url`,
      headers: bearer(outsider.token),
      payload: { kind: 'image', mimeType: 'image/png', sizeBytes: 100 },
    });
    expect(denied.statusCode).toBe(404);

    const anon = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${conversationId}/media/upload-url`,
      payload: { kind: 'image', mimeType: 'image/png', sizeBytes: 100 },
    });
    expect(anon.statusCode).toBe(401);
  });

  it('validates per-kind MIME, size and voice duration server-side', async () => {
    const member = await signup(`m7_v_${suffix()}`);
    const { conversationId } = await setupCircleConversation([member.token]);
    const call = (payload: Record<string, unknown>) =>
      app.inject({
        method: 'POST',
        url: `/v1/conversations/${conversationId}/media/upload-url`,
        headers: bearer(member.token),
        payload,
      });

    const badMime = await call({ kind: 'image', mimeType: 'image/svg+xml', sizeBytes: 100 });
    expect(badMime.statusCode).toBe(400);

    const crossKind = await call({ kind: 'voice', mimeType: 'image/png', sizeBytes: 100 });
    expect(crossKind.statusCode).toBe(400);

    const oversize = await call({ kind: 'video', mimeType: 'video/mp4', sizeBytes: 51 * 1024 * 1024 });
    expect(oversize.statusCode).toBe(400);

    const longVoice = await call({
      kind: 'voice', mimeType: 'audio/mp4', sizeBytes: 1000, durationMs: 2 * 60 * 1000 + 1,
    });
    expect(longVoice.statusCode).toBe(400);
    expect(longVoice.json().code).toBe('VALIDATION_FAILED');

    const okVoice = await call({ kind: 'voice', mimeType: 'audio/mp4', sizeBytes: 1000, durationMs: 119_000 });
    expect(okVoice.statusCode).toBe(201);
  });
});

describe('media message creation (confirmed-upload gate, docs/API.md M7)', () => {
  it('creates a media message only after the upload is confirmed', async () => {
    const member = await signup(`m7_s_${suffix()}`);
    const { owner, conversationId } = await setupCircleConversation([member.token]);

    const intent = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${conversationId}/media/upload-url`,
      headers: bearer(member.token),
      payload: { kind: 'image', mimeType: 'image/png', sizeBytes: PNG_BYTES.length },
    });
    const { mediaId, uploadFields } = intent.json() as { mediaId: string; uploadFields: Record<string, string> };

    // BEFORE confirm: the send must fail — no pending media messages.
    const early = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${conversationId}/messages`,
      headers: bearer(member.token),
      payload: { type: 'image', mediaId, clientMessageId: `early_${suffix}` },
    });
    expect(early.statusCode).toBe(400);
    expect(early.json().code).toBe('MEDIA_NOT_READY');

    // Nobody must have broadcast anything for the failed attempt.
    appStorage!.put(uploadFields.key!, PNG_BYTES);
    await app.inject({ method: 'POST', url: `/v1/media/${mediaId}/confirm`, headers: bearer(member.token) });

    const sent = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${conversationId}/messages`,
      headers: bearer(member.token),
      payload: { type: 'image', mediaId, clientMessageId: `ok_${suffix}` },
    });
    expect(sent.statusCode).toBe(201);
    const message = sent.json().message as Record<string, unknown>;
    expect(message.type).toBe('image');
    expect(message.mediaId).toBe(mediaId);
    expect((message.media as Record<string, unknown>).mimeType).toBe('image/png');
    expect((message.media as Record<string, unknown>).kind).toBe('image');
    void owner;
  });

  it('is idempotent: same clientMessageId returns the same media message', async () => {
    const member = await signup(`m7_id_${suffix()}`);
    const { conversationId } = await setupCircleConversation([member.token]);
    const up = await uploadChatMedia(member.token, conversationId, {
      kind: 'image', mimeType: 'image/png', sizeBytes: PNG_BYTES.length,
    });
    const mediaId = up.json.mediaId as string;
    const cmi = `idem_${suffix()}`;

    const first = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${conversationId}/messages`,
      headers: bearer(member.token),
      payload: { type: 'image', mediaId, clientMessageId: cmi },
    });
    const retry = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${conversationId}/messages`,
      headers: bearer(member.token),
      payload: { type: 'image', mediaId, clientMessageId: cmi },
    });
    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(200);
    expect((retry.json().message as { id: string }).id).toBe((first.json().message as { id: string }).id);

    const count = await client.query<{ count: number }>(
      `SELECT count(*)::int FROM messages WHERE conversation_id = $1`,
      [conversationId],
    );
    expect(count.rows[0]!.count).toBe(1);
  });

  it('rejects foreign media, cross-conversation media and text-with-media', async () => {
    const member = await signup(`m7_f_${suffix()}`);
    const other = await signup(`m7_fo_${suffix()}`);
    const { conversationId } = await setupCircleConversation([member.token]);
    const otherConv = await setupCircleConversation([]);

    // Member's upload for a DIFFERENT conversation.
    const foreign = await uploadChatMedia(member.token, otherConv.conversationId, {
      kind: 'image', mimeType: 'image/png', sizeBytes: PNG_BYTES.length,
    });
    const rejected = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${conversationId}/messages`,
      headers: bearer(member.token),
      payload: { type: 'image', mediaId: foreign.json.mediaId, clientMessageId: `f1_${suffix}` },
    });
    expect(rejected.statusCode).toBe(400);

    // Someone else's confirmed media.
    const others = await uploadChatMedia(other.token, otherConv.conversationId, {
      kind: 'image', mimeType: 'image/png', sizeBytes: PNG_BYTES.length,
    });
    const stolen = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${conversationId}/messages`,
      headers: bearer(member.token),
      payload: { type: 'image', mediaId: others.json.mediaId, clientMessageId: `f2_${suffix}` },
    });
    expect(stolen.statusCode).toBe(400);

    // Text carrying a mediaId is a schema error.
    const textWithMedia = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${conversationId}/messages`,
      headers: bearer(member.token),
      payload: { type: 'text', body: 'no attachments', mediaId: '00000000-0000-4000-8000-000000000000', clientMessageId: `f3_${suffix}` },
    });
    expect(textWithMedia.statusCode).toBe(400);
  });

  it('broadcasts message:new with media metadata to room members (real socket)', async () => {
    const member = await signup(`m7_rt_${suffix()}`);
    const { owner, conversationId } = await setupCircleConversation([member.token]);

    const memberSocket = await connectSocket(member.token);
    await memberSocket.emitWithAck('join', { conversationId });
    const newMessage = new Promise<{ message: Record<string, unknown> }>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('no message:new')), 10_000);
      memberSocket.once('message:new', (p: { message: Record<string, unknown> }) => {
        clearTimeout(t);
        resolve(p);
      });
    });

    const ownerSocket = await connectSocket(owner.token);
    await ownerSocket.emitWithAck('join', { conversationId });

    const up = await uploadChatMedia(owner.token, conversationId, {
      kind: 'image', mimeType: 'image/png', sizeBytes: PNG_BYTES.length,
    });
    const sent = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${conversationId}/messages`,
      headers: bearer(owner.token),
      payload: { type: 'image', mediaId: up.json.mediaId, clientMessageId: `rt_${suffix}` },
    });
    expect(sent.statusCode).toBe(201);

    const payload = await newMessage;
    expect((payload.message as { mediaId: string }).mediaId).toBe(up.json.mediaId);
    expect((payload.message as { media: Record<string, unknown> }).media).toBeTruthy();
  });
});

describe('chat media download authorization (docs/API.md M7)', () => {
  it('serves a short-TTL URL to conversation members and the uploader', async () => {
    const member = await signup(`m7_dl_${suffix()}`);
    const { owner, conversationId } = await setupCircleConversation([member.token]);
    const up = await uploadChatMedia(owner.token, conversationId, {
      kind: 'image', mimeType: 'image/png', sizeBytes: PNG_BYTES.length,
    });
    const mediaId = up.json.mediaId as string;

    for (const token of [owner.token, member.token]) {
      const res = await app.inject({ method: 'GET', url: `/v1/media/${mediaId}/url`, headers: bearer(token) });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { url: string }).url).toBeTruthy();
      expect(res.headers['cache-control']).toBe('no-store');
    }
  });

  it('rejects non-members without leaking existence', async () => {
    const outsider = await signup(`m7_dlx_${suffix()}`);
    // The circle owner (a member) uploads; an outsider must not read it.
    const { owner, conversationId } = await setupCircleConversation([]);
    const up = await uploadChatMedia(owner.token, conversationId, {
      kind: 'image', mimeType: 'image/png', sizeBytes: PNG_BYTES.length,
    });
    expect(up.status).toBe(200); // uploader confirm worked

    const denied = await app.inject({
      method: 'GET',
      url: `/v1/media/${up.json.mediaId}/url`,
      headers: bearer(outsider.token),
    });
    expect(denied.statusCode).toBe(404);
    expect(denied.json().code).toBe('NOT_FOUND');
  });

  it('serves direct-conversation media to the two participants only', async () => {
    const a = await signup(`m7_dd_${suffix()}`);
    const b = await signup(`m7_db_${suffix()}`);
    // D1: both must join a shared Circle before the DM can exist.
    await setupCircleConversation([a.token, b.token]);
    const bName = (await client.query<{ username: string }>(`SELECT username FROM users WHERE id = $1`, [b.userId])).rows[0]!.username;
    const direct = await app.inject({
      method: 'POST',
      url: '/v1/conversations/direct',
      headers: bearer(a.token),
      payload: { username: bName },
    });
    const convId = (direct.json() as { conversationId: string }).conversationId;
    const up = await uploadChatMedia(a.token, convId, {
      kind: 'voice', mimeType: 'audio/mp4', sizeBytes: 1200, durationMs: 3400,
    }, AUDIO_BYTES);
    expect(up.status).toBe(200);

    const ok = await app.inject({ method: 'GET', url: `/v1/media/${up.json.mediaId}/url`, headers: bearer(b.token) });
    expect(ok.statusCode).toBe(200);

    const outsider = await signup(`m7_ddo_${suffix()}`);
    const denied = await app.inject({ method: 'GET', url: `/v1/media/${up.json.mediaId}/url`, headers: bearer(outsider.token) });
    expect(denied.statusCode).toBe(404);
  });
});
