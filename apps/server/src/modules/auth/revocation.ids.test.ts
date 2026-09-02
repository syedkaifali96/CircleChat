import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { createDatabase, type Database } from '../../db/client';
import { migrateTestDatabase, resolveTestDatabaseUrl, startEmbeddedPostgres } from '../../db/testing';

/**
 * Route-level proof that the EXACT revoked session IDs are passed to
 * revokeSessionSockets on each revocation path, and that the current session
 * is never among them for change-password / revoke-all-others.
 */

let client: Client;
let stopEmbedded: (() => Promise<void>) | undefined;
let db: Database;
let app: FastifyInstance;
let disconnectedIds: string[];

const suffix = () => Math.random().toString(36).slice(2, 10);

function tokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

async function sessionIdByToken(token: string): Promise<string> {
  const res = await client.query<{ id: string }>(`SELECT id FROM sessions WHERE token_hash = $1`, [
    tokenHash(token),
  ]);
  return res.rows[0]!.id;
}

async function signup(username: string, password = 'super-secret-password'): Promise<Record<string, unknown>> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/signup',
    payload: { username, displayName: `Display ${username}`, password },
  });
  return res.json() as Record<string, unknown>;
}

async function login(username: string, password: string): Promise<Record<string, unknown>> {
  const res = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { username, password } });
  return res.json() as Record<string, unknown>;
}

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
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
  disconnectedIds = [];
  app = await buildApp({ db });
  app.decorate('revokeSessionSockets', (sessionId: string) => {
    disconnectedIds.push(sessionId);
  });
}, 300_000);

afterAll(async () => {
  await db.$client.end();
  await client?.end();
  await stopEmbedded?.();
}, 60_000);

describe('revoked session IDs reach revokeSessionSockets', () => {
  it('change-password disconnects exactly the OTHER session ids, never the current one', async () => {
    const username = `ids_cp_${suffix()}`;
    const tokenA = (await signup(username)).token as string;
    const tokenB = (await login(username, 'super-secret-password')).token as string;
    const tokenC = (await login(username, 'super-secret-password')).token as string;
    disconnectedIds = [];

    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/change-password',
      headers: bearer(tokenA),
      payload: { currentPassword: 'super-secret-password', newPassword: 'brand-new-password-42' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().revokedSessions).toBe(2);
    expect(disconnectedIds).toHaveLength(2);
    expect(disconnectedIds).not.toContain(await sessionIdByToken(tokenA));
    expect(disconnectedIds.sort()).toEqual(
      [await sessionIdByToken(tokenB), await sessionIdByToken(tokenC)].sort(),
    );
  });

  it('revoke-all-other-sessions disconnects exactly the other ids', async () => {
    const username = `ids_ro_${suffix()}`;
    const tokenA = (await signup(username)).token as string;
    const tokenB = (await login(username, 'super-secret-password')).token as string;
    disconnectedIds = [];

    const res = await app.inject({ method: 'DELETE', url: '/v1/auth/sessions', headers: bearer(tokenA) });
    expect(res.statusCode).toBe(200);
    expect(res.json().revokedSessions).toBe(1);
    expect(disconnectedIds).toEqual([await sessionIdByToken(tokenB)]);
  });

  it("recovery-reset disconnects ALL session ids including the requester's", async () => {
    const username = `ids_rr_${suffix()}`;
    const signupBody = await signup(username);
    const recoveryCode = signupBody.recoveryCode as string;
    const tokenA = signupBody.token as string;
    const tokenB = (await login(username, 'super-secret-password')).token as string;
    disconnectedIds = [];

    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/recovery-reset',
      payload: { username, recoveryCode, newPassword: 'recovered-password-99' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().revokedSessions).toBe(2);
    expect(disconnectedIds.sort()).toEqual(
      [await sessionIdByToken(tokenA), await sessionIdByToken(tokenB)].sort(),
    );
  });
});
