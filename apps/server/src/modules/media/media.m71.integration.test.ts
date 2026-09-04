import type { FastifyInstance } from 'fastify';
import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../app';
import { createDatabase, type Database } from '../../db/client';
import { InMemoryStorageGateway } from '../media/storage';
import { migrateTestDatabase, resolveTestDatabaseUrl, startEmbeddedPostgres } from '../../db/testing';

/**
 * M7.1 tests — GIF search proxy (Tenor, key server-side only), external GIF
 * sends, and image thumbnail generation on confirm. Real PostgreSQL; the
 * external provider fetch is mocked at the network boundary (that IS the
 * third-party service), while storage + sockets stay real.
 */

let client: Client;
let stopEmbedded: (() => Promise<void>) | undefined;
let db: Database;
let app: FastifyInstance;
let appStorage: InMemoryStorageGateway;

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
  const owner = await signup(`m71_ow_${suffix()}`);
  const created = await app.inject({
    method: 'POST',
    url: '/v1/circles',
    headers: bearer(owner.token),
    payload: { name: `M71 ${suffix()}` },
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
  app = await buildApp({ db, storage: appStorage, logger: { level: 'error' } });
}, 300_000);

afterAll(async () => {
  await db.$client.end();
  await client?.end();
  await stopEmbedded?.();
}, 60_000);

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.TENOR_API_KEY;
});

describe('GIF search endpoint (docs/API.md M7.1)', () => {
  it('returns 503 GIF_SEARCH_UNAVAILABLE when no Tenor key is configured', async () => {
    const user = await signup(`gs_nc_${suffix()}`);
    delete process.env.TENOR_API_KEY;

    const res = await app.inject({
      method: 'GET',
      url: '/v1/media/gif-search?q=cats',
      headers: bearer(user.token),
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('GIF_SEARCH_UNAVAILABLE');
  });

  it('requires authentication', async () => {
    process.env.TENOR_API_KEY = 'test-key';
    const res = await app.inject({ method: 'GET', url: '/v1/media/gif-search?q=cats' });
    expect(res.statusCode).toBe(401);
  });

  it('proxies and normalizes Tenor results without exposing the API key', async () => {
    process.env.TENOR_API_KEY = 'super-secret-tenor-key';
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              results: [
                {
                  id: 'gif-1',
                  media_formats: {
                    gif: { url: 'https://media.tenor.com/gif-1.gif', dims: [400, 300] },
                    tinygif: { url: 'https://media.tenor.com/tiny-1.gif', dims: [200, 150] },
                  },
                },
              ],
            }),
        }),
      ) as unknown as typeof fetch,
    );

    const user = await signup(`gs_ok_${suffix()}`);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/media/gif-search?q=happy',
      headers: bearer(user.token),
    });
    expect(res.statusCode).toBe(200);
    const results = res.json().results as Array<{ id: string; url: string; previewUrl: string }>;
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      id: 'gif-1',
      url: 'https://media.tenor.com/gif-1.gif',
      previewUrl: 'https://media.tenor.com/tiny-1.gif',
      width: 400,
      height: 300,
    });
    // The provider key never crosses the wire.
    expect(res.body).not.toContain('super-secret-tenor-key');
  });

  it('rate limits searches per user (429 after the window is exhausted)', async () => {
    process.env.TENOR_API_KEY = 'test-key';
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({ ok: true, json: () => Promise.resolve({ results: [] }) }),
      ) as unknown as typeof fetch,
    );
    const user = await signup(`gs_rl_${suffix()}`);

    let rateLimited = 0;
    for (let i = 0; i < 35; i++) {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/media/gif-search?q=q${i}`,
        headers: bearer(user.token),
      });
      if (res.statusCode === 429) {
        rateLimited += 1;
      }
    }
    expect(rateLimited).toBeGreaterThan(0);
  });

  it('validates the query (empty/overlong rejected)', async () => {
    process.env.TENOR_API_KEY = 'test-key';
    const user = await signup(`gs_q_${suffix()}`);
    const empty = await app.inject({ method: 'GET', url: '/v1/media/gif-search?q=', headers: bearer(user.token) });
    expect(empty.statusCode).toBe(400);
    const long = await app.inject({ method: 'GET', url: `/v1/media/gif-search?q=${'x'.repeat(61)}`, headers: bearer(user.token) });
    expect(long.statusCode).toBe(400);
  });
});

describe('external GIF messages (docs/API.md M7.1)', () => {
  it('creates a gif message + external media row; idempotent on retry', async () => {
    const member = await signup(`m71_g_${suffix()}`);
    const { conversationId } = await setupCircleConversation([member.token]);
    const cmi = `gif_${suffix()}`;

    const send = async () =>
      app.inject({
        method: 'POST',
        url: `/v1/conversations/${conversationId}/messages`,
        headers: bearer(member.token),
        payload: {
          type: 'gif',
          externalUrl: 'https://media.tenor.com/abc123/gif.gif',
          clientMessageId: cmi,
        },
      });

    const first = await send();
    expect(first.statusCode).toBe(201);
    const message = first.json().message as Record<string, unknown>;
    expect(message.type).toBe('gif');
    const media = message.media as Record<string, unknown>;
    expect(media.mimeType).toBe('image/gif');
    expect(media.externalUrl).toBe('https://media.tenor.com/abc123/gif.gif');

    const retry = await send();
    expect(retry.statusCode).toBe(200);
    expect((retry.json().message as { id: string }).id).toBe((message as { id: string }).id);

    const mediaRows = await client.query<{ external_url: string | null; storage_key: string }>(
      `SELECT external_url, storage_key FROM media WHERE conversation_id = $1`,
      [conversationId],
    );
    expect(mediaRows.rows).toHaveLength(1);
    expect(mediaRows.rows[0]!.external_url).toBe('https://media.tenor.com/abc123/gif.gif');
    expect(mediaRows.rows[0]!.storage_key).toMatch(/^external\//);
  });

  it('rejects gif messages without a URL and non-https URLs', async () => {
    const member = await signup(`m71_gr_${suffix()}`);
    const { conversationId } = await setupCircleConversation([member.token]);

    const noUrl = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${conversationId}/messages`,
      headers: bearer(member.token),
      payload: { type: 'gif', clientMessageId: `g1_${suffix}` },
    });
    expect(noUrl.statusCode).toBe(400);

    const http = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${conversationId}/messages`,
      headers: bearer(member.token),
      payload: { type: 'gif', externalUrl: 'http://insecure.example/gif.gif', clientMessageId: `g2_${suffix}` },
    });
    expect(http.statusCode).toBe(400);
  });
});

describe('image thumbnails (M7.1b)', () => {
  it('generates a 400px JPEG thumbnail on image confirm; variant URL serves it', async () => {
    const member = await signup(`m7t_ok_${suffix()}`);
    const { conversationId } = await setupCircleConversation([member.token]);

    // A real 800x600 PNG so sharp has valid bytes to downscale.
    const sharp = (await import('sharp')).default;
    const bigPng = await sharp({
      create: { width: 800, height: 600, channels: 3, background: { r: 124, g: 58, b: 237 } },
    })
      .png()
      .toBuffer();

    const intent = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${conversationId}/media/upload-url`,
      headers: bearer(member.token),
      payload: { kind: 'image', mimeType: 'image/png', sizeBytes: bigPng.length },
    });
    const { mediaId, uploadFields } = intent.json() as { mediaId: string; uploadFields: Record<string, string> };
    appStorage!.put(uploadFields.key!, bigPng);
    const confirm = await app.inject({ method: 'POST', url: `/v1/media/${mediaId}/confirm`, headers: bearer(member.token) });
    expect(confirm.statusCode).toBe(200);

    const row = await client.query<{ thumbnail_key: string | null }>(
      `SELECT thumbnail_key FROM media WHERE id = $1`,
      [mediaId],
    );
    expect(row.rows[0]!.thumbnail_key).toMatch(/-thumb$/);
    // A real thumbnail was stored: JPEG magic + within the 400px edge cap.
    const thumb = appStorage!.get(row.rows[0]!.thumbnail_key!);
    expect(thumb).toBeTruthy();
    expect(thumb![0]).toBe(0xff);
    expect(thumb![1]).toBe(0xd8);
    const meta = await (await import('sharp')).default(thumb!).metadata();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(400);

    // variant=thumb serves the derivative.
    const thumbUrl = await app.inject({
      method: 'GET',
      url: `/v1/media/${mediaId}/url?variant=thumb`,
      headers: bearer(member.token),
    });
    expect(thumbUrl.statusCode).toBe(200);
    expect((thumbUrl.json() as { url: string }).url).toBeTruthy();
  }, 30_000);

  it('falls back to the original image when thumbnail generation fails', async () => {
    const member = await signup(`m7t_bad_${suffix()}`);
    const { conversationId } = await setupCircleConversation([member.token]);

    const intent = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${conversationId}/media/upload-url`,
      headers: bearer(member.token),
      payload: { kind: 'image', mimeType: 'image/png', sizeBytes: 64 },
    });
    const { mediaId, uploadFields } = intent.json() as { mediaId: string; uploadFields: Record<string, string> };
    // Valid PNG header but corrupt body: passes sniffing, breaks sharp.
    const corrupt = Buffer.alloc(64);
    PNG_BYTES.copy(corrupt, 0, 0, Math.min(PNG_BYTES.length, 64));
    appStorage!.put(uploadFields.key!, corrupt);
    const confirm = await app.inject({ method: 'POST', url: `/v1/media/${mediaId}/confirm`, headers: bearer(member.token) });
    expect(confirm.statusCode).toBe(200); // confirm does NOT fail

    const row = await client.query<{ thumbnail_key: string | null; status: string }>(
      `SELECT thumbnail_key, status FROM media WHERE id = $1`,
      [mediaId],
    );
    expect(row.rows[0]!.status).toBe('ready');
    expect(row.rows[0]!.thumbnail_key).toBeNull(); // fallback: original image

    const url = await app.inject({ method: 'GET', url: `/v1/media/${mediaId}/url?variant=thumb`, headers: bearer(member.token) });
    expect(url.statusCode).toBe(200); // falls back to the original
  }, 30_000);
});
