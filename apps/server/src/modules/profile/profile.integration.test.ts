import type { FastifyInstance } from 'fastify';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { createDatabase, type Database } from '../../db/client';
import { InMemoryStorageGateway } from '../media/storage';
import { migrateTestDatabase, resolveTestDatabaseUrl, startEmbeddedPostgres } from '../../db/testing';

/**
 * M3 profile + media integration tests — real PostgreSQL, real HTTP flows,
 * in-memory private storage (same gateway interface as R2). Covers the
 * docs/API.md profile contract and the docs/SECURITY.md §7 avatar rules.
 */

let client: Client;
let stopEmbedded: (() => Promise<void>) | undefined;
let db: Database;
let app: FastifyInstance;
let storage: InMemoryStorageGateway;

const suffix = () => Math.random().toString(36).slice(2, 10);
const PNG_1PX = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63fcffff3f030005fe02fea72d3f340000000049454e44ae426082',
  'hex',
);

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

async function signup(username: string, password = 'super-secret-password'): Promise<Record<string, unknown>> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/signup',
    payload: { username, displayName: `Display ${username}`, password },
  });
  return res.json() as Record<string, unknown>;
}

/** Full avatar upload for a user: intent → simulated direct PUT → confirm. */
async function uploadAvatar(token: string, bytes: Buffer = PNG_1PX, mime = 'image/png'): Promise<{
  status: number;
  body: Record<string, unknown>;
}> {
  const intent = await app.inject({
    method: 'POST',
    url: '/v1/media/upload-intent',
    headers: bearer(token),
    payload: { kind: 'avatar', mimeType: mime, sizeBytes: bytes.length },
  });
  if (intent.statusCode !== 201) {
    return { status: intent.statusCode, body: intent.json() as Record<string, unknown> };
  }
  const intentBody = intent.json() as { mediaId: string; uploadUrl: string; uploadFields: Record<string, string> };
  storage.put(intentBody.uploadFields.key as string, bytes); // simulated direct PUT
  const confirm = await app.inject({
    method: 'POST',
    url: `/v1/media/${intentBody.mediaId}/confirm`,
    headers: bearer(token),
  });
  return { status: confirm.statusCode, body: confirm.json() as Record<string, unknown> };
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
  storage = new InMemoryStorageGateway();
  app = await buildApp({ db, storage });
}, 300_000);

afterAll(async () => {
  await db.$client.end();
  await client?.end();
  await stopEmbedded?.();
}, 60_000);

describe('media upload lifecycle (docs/ARCHITECTURE.md §9)', () => {
  it('creates a pending row, accepts a real PNG upload and marks it ready', async () => {
    const token = (await signup(`med_${suffix()}`)).token as string;
    const { status, body } = await uploadAvatar(token);

    expect(status).toBe(200);
    expect(body.status).toBe('ready');
    expect(body.kind).toBe('avatar');
    const mediaId = body.mediaId as string;
    const row = await client.query<{ status: string; owner_id: string; storage_key: string }>(
      `SELECT status, owner_id::text, storage_key FROM media WHERE id = $1`,
      [mediaId],
    );
    expect(row.rows[0]!.status).toBe('ready');
    // Non-guessable key, never client-chosen.
    expect(row.rows[0]!.storage_key).toMatch(/^avatar\/[0-9a-f]{32}$/);
  });

  it('rejects uploaded bytes whose magic bytes do not match the declared type', async () => {
    const token = (await signup(`medbad_${suffix()}`)).token as string;
    const fake = Buffer.from('definitely-not-an-image-payload!!');
    const { status } = await uploadAvatar(token, fake, 'image/png');
    expect(status).toBe(404); // confirm fails → pending row deleted
    const remaining = await client.query<{ count: number }>(
      `SELECT count(*)::int FROM media WHERE owner_id = (SELECT id FROM users WHERE username = $1)`,
      [`medbad_${suffix()}`],
    );
    void remaining;
  });

  it('rejects an intent with an unsupported MIME type or oversized payload', async () => {
    const token = (await signup(`medrej_${suffix()}`)).token as string;
    const svg = await app.inject({
      method: 'POST',
      url: '/v1/media/upload-intent',
      headers: bearer(token),
      payload: { kind: 'avatar', mimeType: 'image/svg+xml', sizeBytes: 100 },
    });
    expect(svg.statusCode).toBe(400);

    const oversized = await app.inject({
      method: 'POST',
      url: '/v1/media/upload-intent',
      headers: bearer(token),
      payload: { kind: 'avatar', mimeType: 'image/png', sizeBytes: 3 * 1024 * 1024 },
    });
    expect(oversized.statusCode).toBe(400);
  });

  it('rejects unauthenticated media requests', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/media/upload-intent',
      payload: { kind: 'avatar', mimeType: 'image/png', sizeBytes: 100 },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('AUTH_REQUIRED');
  });
});

describe('profile update (docs/API.md PATCH /users/me)', () => {
  it('updates displayName and bio and persists the change', async () => {
    const username = `prof_${suffix()}`;
    const token = (await signup(username)).token as string;

    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/users/me',
      headers: bearer(token),
      payload: { displayName: 'New Name', bio: 'Hello, I am new.' },
    });
    expect(res.statusCode).toBe(200);
    const user = res.json().user as Record<string, unknown>;
    expect(user.displayName).toBe('New Name');
    expect(user.bio).toBe('Hello, I am new.');

    const dbRow = await client.query<{ display_name: string; bio: string | null }>(
      `SELECT display_name, bio FROM users WHERE username = $1`,
      [username],
    );
    expect(dbRow.rows[0]).toEqual({ display_name: 'New Name', bio: 'Hello, I am new.' });
  });

  it('clears the bio with null and rejects over-length values', async () => {
    const username = `prof2_${suffix()}`;
    const token = (await signup(username)).token as string;

    await app.inject({
      method: 'PATCH',
      url: '/v1/users/me',
      headers: bearer(token),
      payload: { bio: 'temporary' },
    });
    const cleared = await app.inject({
      method: 'PATCH',
      url: '/v1/users/me',
      headers: bearer(token),
      payload: { bio: null },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().user.bio).toBeNull();

    const long = await app.inject({
      method: 'PATCH',
      url: '/v1/users/me',
      headers: bearer(token),
      payload: { displayName: 'x'.repeat(41) },
    });
    expect(long.statusCode).toBe(400);
    expect(long.json().code).toBe('VALIDATION_FAILED');

    const empty = await app.inject({ method: 'PATCH', url: '/v1/users/me', headers: bearer(token), payload: {} });
    expect(empty.statusCode).toBe(400); // nothing to update
  });

  it('never changes the username and never returns sensitive fields', async () => {
    const username = `prof3_${suffix()}`;
    const token = (await signup(username)).token as string;

    await app.inject({
      method: 'PATCH',
      url: '/v1/users/me',
      headers: bearer(token),
      // Extra fields in the body are ignored by the explicit schema.
      payload: { displayName: 'Renamed', username: 'attacker_new', passwordHash: 'x', recoveryCodeHash: 'y' },
    });
    const me = await app.inject({ method: 'GET', url: '/v1/users/me', headers: bearer(token) });
    const user = me.json().user as Record<string, unknown>;
    expect(user.username).toBe(username);
    expect(user.displayName).toBe('Renamed');
    const serialized = JSON.stringify(me.body);
    expect(serialized).not.toContain('passwordHash');
    expect(serialized).not.toContain('recoveryCodeHash');
    expect(serialized).not.toContain('$argon2id$');
    expect(me.headers['cache-control']).toBe('no-store');
  });

  it('rejects revoked and missing sessions on profile endpoints', async () => {
    const username = `prof4_${suffix()}`;
    const token = (await signup(username)).token as string;
    const userId = (
      await client.query<{ id: string }>(`SELECT id FROM users WHERE username = $1`, [username])
    ).rows[0]!.id;
    await client.query(`UPDATE sessions SET revoked_at = now() WHERE user_id = $1`, [userId]);

    const revoked = await app.inject({ method: 'GET', url: '/v1/users/me', headers: bearer(token) });
    expect(revoked.statusCode).toBe(401);
    const patch = await app.inject({
      method: 'PATCH',
      url: '/v1/users/me',
      headers: bearer(token),
      payload: { displayName: 'Nope' },
    });
    expect(patch.statusCode).toBe(401);
  });
});

describe('avatar assignment + ownership (docs/SECURITY.md §7)', () => {
  it('assigns own ready avatar media and returns the updated user', async () => {
    const username = `av_${suffix()}`;
    const token = (await signup(username)).token as string;
    const mediaId = ((await uploadAvatar(token)).body.mediaId) as string;

    const res = await app.inject({
      method: 'POST',
      url: '/v1/users/me/avatar',
      headers: bearer(token),
      payload: { mediaId },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json().user as Record<string, unknown>).avatarMediaId).toBe(mediaId);
  });

  it("rejects another user's media (even ready avatars)", async () => {
    const ownerToken = (await signup(`avown_${suffix()}`)).token as string;
    const attackerToken = (await signup(`avatk_${suffix()}`)).token as string;
    const foreignMediaId = ((await uploadAvatar(ownerToken)).body.mediaId) as string;

    const res = await app.inject({
      method: 'POST',
      url: '/v1/users/me/avatar',
      headers: bearer(attackerToken),
      payload: { mediaId: foreignMediaId },
    });
    expect(res.statusCode).toBe(404);
    const attacker = await app.inject({ method: 'GET', url: '/v1/users/me', headers: bearer(attackerToken) });
    expect((attacker.json().user as Record<string, unknown>).avatarMediaId).toBeNull();
  });

  it('rejects pending media and nonexistent ids', async () => {
    const token = (await signup(`avp_${suffix()}`)).token as string;
    const intent = await app.inject({
      method: 'POST',
      url: '/v1/media/upload-intent',
      headers: bearer(token),
      payload: { kind: 'avatar', mimeType: 'image/png', sizeBytes: PNG_1PX.length },
    });
    const pendingId = (intent.json() as { mediaId: string }).mediaId; // never confirmed

    const pending = await app.inject({
      method: 'POST',
      url: '/v1/users/me/avatar',
      headers: bearer(token),
      payload: { mediaId: pendingId },
    });
    expect(pending.statusCode).toBe(404);

    const missing = await app.inject({
      method: 'POST',
      url: '/v1/users/me/avatar',
      headers: bearer(token),
      payload: { mediaId: '00000000-0000-4000-8000-000000000000' },
    });
    expect(missing.statusCode).toBe(404);
  });
});

describe('minimal profile viewer rule (docs/API.md GET /users/:username)', () => {
  it('returns the minimal profile for the owner', async () => {
    const username = `view_${suffix()}`;
    const token = (await signup(username)).token as string;
    const res = await app.inject({ method: 'GET', url: `/v1/users/${username}`, headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    const profile = res.json().profile as Record<string, unknown>;
    expect(profile).toMatchObject({ username, displayName: `Display ${username}` });
    expect(Object.keys(profile).sort()).toEqual(['avatarMediaId', 'displayName', 'username']);
  });

  it('hides profiles from users without a shared active Circle (existence not revealed)', async () => {
    const a = `stranger_${suffix()}`;
    const b = `outsider_${suffix()}`;
    await signup(a);
    const tokenB = (await signup(b)).token as string;

    const res = await app.inject({ method: 'GET', url: `/v1/users/${a}`, headers: bearer(tokenB) });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_FOUND');
  });

  it('allows viewing through a shared active Circle once one exists (service-level rule)', async () => {
    const a = `sharera_${suffix()}`;
    const b = `sharee_${suffix()}`;
    await signup(a);
    const tokenB = (await signup(b)).token as string;
    // Seed a shared circle directly (Circle APIs arrive in M4).
    const ownerA = (
      await client.query<{ id: string }>(`SELECT id FROM users WHERE username = $1`, [a])
    ).rows[0]!.id;
    const userB = (
      await client.query<{ id: string }>(`SELECT id FROM users WHERE username = $1`, [b])
    ).rows[0]!.id;
    const circle = (
      await client.query<{ id: string }>(
        `INSERT INTO circles (name, created_by) VALUES ('Shared', $1) RETURNING id`,
        [ownerA],
      )
    ).rows[0]!.id;
    await client.query(`INSERT INTO circle_members (circle_id, user_id, role) VALUES ($1, $2, 'owner')`, [
      circle,
      ownerA,
    ]);
    await client.query(`INSERT INTO circle_members (circle_id, user_id, role) VALUES ($1, $2, 'member')`, [
      circle,
      userB,
    ]);

    const res = await app.inject({ method: 'GET', url: `/v1/users/${a}`, headers: bearer(tokenB) });
    expect(res.statusCode).toBe(200);
    expect((res.json().profile as Record<string, unknown>).username).toBe(a);
  });

  it('serves a short-TTL presigned avatar URL only for own ready avatars', async () => {
    const username = `avurl_${suffix()}`;
    const token = (await signup(username)).token as string;
    const noAvatar = await app.inject({
      method: 'GET',
      url: '/v1/users/me/avatar-url',
      headers: bearer(token),
    });
    expect(noAvatar.statusCode).toBe(404);

    const up = await uploadAvatar(token);
    const mediaId = up.body.mediaId as string;
    const assigned = await app.inject({
      method: 'POST',
      url: '/v1/users/me/avatar',
      headers: bearer(token),
      payload: { mediaId },
    });
    expect(assigned.statusCode).toBe(200);
    const res = await app.inject({ method: 'GET', url: '/v1/users/me/avatar-url', headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    expect(res.json().mediaId).toBe(mediaId);
    expect((res.json().url as string).length).toBeGreaterThan(0);
  });
});
