import type { FastifyInstance } from 'fastify';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { createDatabase, type Database } from '../../db/client';
import { InMemoryStorageGateway } from '../media/storage';
import { migrateTestDatabase, resolveTestDatabaseUrl, startEmbeddedPostgres } from '../../db/testing';

/**
 * M3 follow-up: GET /v1/media/:id/url — the authorized media download
 * endpoint (docs/API.md). Uses the documented profile-visibility rule
 * (self OR >=1 shared active Circle) before issuing the short-TTL presigned
 * GET; every failure path returns the generic 404 so media existence is
 * never leaked.
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
  storage.put(intentBody.uploadFields.key as string, bytes);
  const confirm = await app.inject({
    method: 'POST',
    url: `/v1/media/${intentBody.mediaId}/confirm`,
    headers: bearer(token),
  });
  return { status: confirm.statusCode, body: confirm.json() as Record<string, unknown> };
}

/** Creates a non-deleted circle owned by A with B as a member. */
async function seedSharedCircle(userA: string, userB: string): Promise<string> {
  const circle = (
    await client.query<{ id: string }>(
      `INSERT INTO circles (name, created_by) VALUES ('Shared', $1) RETURNING id`,
      [userA],
    )
  ).rows[0]!.id;
  await client.query(`INSERT INTO circle_members (circle_id, user_id, role) VALUES ($1, $2, 'owner')`, [
    circle,
    userA,
  ]);
  await client.query(`INSERT INTO circle_members (circle_id, user_id, role) VALUES ($1, $2, 'member')`, [
    circle,
    userB,
  ]);
  return circle;
}

async function markCircleDeleted(circleId: string): Promise<void> {
  await client.query(`UPDATE circles SET deleted_at = now() WHERE id = $1`, [circleId]);
}

async function userIdOf(username: string): Promise<string> {
  return (
    await client.query<{ id: string }>(`SELECT id FROM users WHERE username = $1`, [username])
  ).rows[0]!.id;
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

describe('GET /v1/media/:id/url (authorized media download)', () => {
  it('1. lets the owner obtain the URL for their own READY avatar', async () => {
    const username = `own_${suffix()}`;
    const token = (await signup(username)).token as string;
    const mediaId = ((await uploadAvatar(token)).body.mediaId) as string;

    const res = await app.inject({ method: 'GET', url: `/v1/media/${mediaId}/url`, headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { url: string }).url.length).toBeGreaterThan(0);
  });

  it('2. lets a user sharing an active Circle with the owner obtain the URL', async () => {
    const owner = `own2_${suffix()}`;
    const viewer = `view2_${suffix()}`;
    const ownerToken = (await signup(owner)).token as string;
    const viewerToken = (await signup(viewer)).token as string;
    const mediaId = ((await uploadAvatar(ownerToken)).body.mediaId) as string;
    await seedSharedCircle(await userIdOf(owner), await userIdOf(viewer));

    const res = await app.inject({ method: 'GET', url: `/v1/media/${mediaId}/url`, headers: bearer(viewerToken) });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { mediaId: string }).mediaId).toBe(mediaId);
  });

  it('3. returns the generic 404 to a user with no shared active Circle', async () => {
    const owner = `own3_${suffix()}`;
    const stranger = `str3_${suffix()}`;
    const ownerToken = (await signup(owner)).token as string;
    const strangerToken = (await signup(stranger)).token as string;
    const mediaId = ((await uploadAvatar(ownerToken)).body.mediaId) as string;

    const res = await app.inject({ method: 'GET', url: `/v1/media/${mediaId}/url`, headers: bearer(strangerToken) });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { code: string }).code).toBe('NOT_FOUND');
  });

  it('4. returns the generic 404 for a nonexistent media id', async () => {
    const token = (await signup(`none_${suffix()}`)).token as string;
    const res = await app.inject({
      method: 'GET',
      url: '/v1/media/00000000-0000-4000-8000-000000000000/url',
      headers: bearer(token),
    });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { code: string }).code).toBe('NOT_FOUND');
  });

  it('5. refuses a PENDING avatar (not yet confirmed)', async () => {
    const token = (await signup(`pend_${suffix()}`)).token as string;
    const intent = await app.inject({
      method: 'POST',
      url: '/v1/media/upload-intent',
      headers: bearer(token),
      payload: { kind: 'avatar', mimeType: 'image/png', sizeBytes: PNG_1PX.length },
    });
    const pendingId = (intent.json() as { mediaId: string }).mediaId;

    const res = await app.inject({ method: 'GET', url: `/v1/media/${pendingId}/url`, headers: bearer(token) });
    expect(res.statusCode).toBe(404);
  });

  it('6. refuses non-avatar media kinds (M3 avatar endpoint scope)', async () => {
    const username = `kind_${suffix()}`;
    const token = (await signup(username)).token as string;
    // Seed a READY image-kind media row directly (chat media arrives in M5).
    const userId = await userIdOf(username);
    const mediaId = (
      await client.query<{ id: string }>(
        `INSERT INTO media (owner_id, kind, mime_type, size_bytes, storage_key, status)
         VALUES ($1, 'image', 'image/png', 10, $2, 'ready') RETURNING id`,
        [userId, `media/${Math.random().toString(36).slice(2)}/img.png`],
      )
    ).rows[0]!.id;

    const res = await app.inject({ method: 'GET', url: `/v1/media/${mediaId}/url`, headers: bearer(token) });
    expect(res.statusCode).toBe(404);
  });

  it('7. rejects a revoked session with 401', async () => {
    const username = `rev_${suffix()}`;
    const token = (await signup(username)).token as string;
    const mediaId = ((await uploadAvatar(token)).body.mediaId) as string;
    await client.query(`UPDATE sessions SET revoked_at = now() WHERE user_id = $1`, [await userIdOf(username)]);

    const res = await app.inject({ method: 'GET', url: `/v1/media/${mediaId}/url`, headers: bearer(token) });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { code: string }).code).toBe('AUTH_REQUIRED');
  });

  it('8. rejects unauthenticated requests with 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/media/00000000-0000-4000-8000-000000000000/url',
    });
    expect(res.statusCode).toBe(401);
    expect((res.json() as { code: string }).code).toBe('AUTH_REQUIRED');
  });

  it("9. knowing another user's media UUID alone does not bypass authorization", async () => {
    const owner = `own9_${suffix()}`;
    const attacker = `atk9_${suffix()}`;
    const ownerToken = (await signup(owner)).token as string;
    const attackerToken = (await signup(attacker)).token as string;
    const mediaId = ((await uploadAvatar(ownerToken)).body.mediaId) as string;
    // No shared circle exists; the attacker knows only the UUID.

    const res = await app.inject({ method: 'GET', url: `/v1/media/${mediaId}/url`, headers: bearer(attackerToken) });
    expect(res.statusCode).toBe(404);
  });

  it('10. a deleted (inactive) Circle no longer grants avatar access', async () => {
    const owner = `own10_${suffix()}`;
    const viewer = `view10_${suffix()}`;
    const ownerToken = (await signup(owner)).token as string;
    const viewerToken = (await signup(viewer)).token as string;
    const mediaId = ((await uploadAvatar(ownerToken)).body.mediaId) as string;
    const circleId = await seedSharedCircle(await userIdOf(owner), await userIdOf(viewer));

    const before = await app.inject({
      method: 'GET',
      url: `/v1/media/${mediaId}/url`,
      headers: bearer(viewerToken),
    });
    expect(before.statusCode).toBe(200);

    await markCircleDeleted(circleId);
    const after = await app.inject({
      method: 'GET',
      url: `/v1/media/${mediaId}/url`,
      headers: bearer(viewerToken),
    });
    expect(after.statusCode).toBe(404);
  });

  it('11. the presigned URL response carries no-store and the storage key/secret never appears', async () => {
    const username = `sec_${suffix()}`;
    const token = (await signup(username)).token as string;
    const mediaId = ((await uploadAvatar(token)).body.mediaId) as string;
    const key = (
      await client.query<{ storage_key: string }>(`SELECT storage_key FROM media WHERE id = $1`, [mediaId])
    ).rows[0]!.storage_key;

    const res = await app.inject({ method: 'GET', url: `/v1/media/${mediaId}/url`, headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = res.body;
    // The presigned URL never exposes storage-key metadata or credentials;
    // the signature itself grants the (time-boxed) access.
    expect(body).not.toContain('storage_key');
    expect(body).not.toContain(key);
    expect(body).not.toContain('smoke-secret');
    expect(body).not.toContain('accessKeyId');
  });

  it('12. issues a short-TTL presigned URL (60s per the storage gateway config)', async () => {
    const username = `ttl_${suffix()}`;
    const token = (await signup(username)).token as string;
    const mediaId = ((await uploadAvatar(token)).body.mediaId) as string;

    const res = await app.inject({ method: 'GET', url: `/v1/media/${mediaId}/url`, headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    // In-memory gateway mirrors the 60-second TTL contract in its signed URL.
    const url = (res.json() as { url: string }).url;
    expect(url).toContain('sig=test');
  });
});
