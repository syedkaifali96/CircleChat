import type { FastifyInstance } from 'fastify';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { createDatabase, type Database } from '../../db/client';
import { migrateTestDatabase, resolveTestDatabaseUrl, startEmbeddedPostgres } from '../../db/testing';

/**
 * M2 authentication integration tests — real PostgreSQL + real HTTP flows via
 * fastify.inject. Covers signup/login/logout, session lifecycle, password
 * change, recovery reset, rate limiting and secret-leak prevention
 * (docs/SECURITY.md, docs/API.md).
 */

let client: Client;
let stopEmbedded: (() => Promise<void>) | undefined;
let db: Database;
let app: FastifyInstance;

const suffix = () => Math.random().toString(36).slice(2, 10);

async function signup(username: string, password = 'super-secret-password'): Promise<{
  status: number;
  body: Record<string, unknown>;
}> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/signup',
    payload: { username, displayName: `Display ${username}`, password },
  });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
}

async function login(username: string, password: string): Promise<{
  status: number;
  body: Record<string, unknown>;
}> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    payload: { username, password },
  });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
}

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function get(body: Record<string, unknown>, key: string): unknown {
  return body[key];
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
}, 300_000);

afterAll(async () => {
  // Close the drizzle pool BEFORE stopping the embedded server so teardown
  // cannot surface ECONNRESET as an unhandled error.
  await db.$client.end();
  await client?.end();
  await stopEmbedded?.();
});

describe('signup (docs/API.md)', () => {
  it('creates an account, returns a token, a one-time recovery code and the user', async () => {
    const username = `su_${suffix()}`;
    const { status, body } = await signup(username);

    expect(status).toBe(201);
    expect(typeof get(body, 'token')).toBe('string');
    expect(get(body, 'token')).not.toBe('');
    const recoveryCode = get(body, 'recoveryCode') as string;
    expect(recoveryCode).toMatch(/^[1-9A-HJ-NP-Z]{4}-[1-9A-HJ-NP-Z]{4}-[1-9A-HJ-NP-Z]{4}$/);
    const user = get(body, 'user') as Record<string, unknown>;
    expect(user).toMatchObject({
      username,
      displayName: `Display ${username}`,
      bio: null,
      avatarMediaId: null,
    });
    expect(typeof user['createdAt']).toBe('string');
    // No secret material in the response beyond the single-show recovery code.
    expect(JSON.stringify(body)).not.toContain('$argon2id$');
  });

  it('rejects invalid usernames, short passwords and username-containing passwords', async () => {
    const cases: Array<Record<string, string>> = [
      { username: 'Bad Name!', displayName: 'x', password: 'long-enough-password' },
      { username: 'ab', displayName: 'x', password: 'long-enough-password' },
      { username: `ok_${suffix()}`, displayName: 'x', password: 'short' },
      { username: 'selfref', displayName: 'x', password: 'password-selfref-inside' },
    ];
    for (const payload of cases) {
      const res = await app.inject({ method: 'POST', url: '/v1/auth/signup', payload });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('VALIDATION_FAILED');
    }
  });

  it('rejects duplicate usernames with USERNAME_TAKEN (409)', async () => {
    const username = `dup_${suffix()}`;
    await signup(username);
    const { status, body } = await signup(username);
    expect(status).toBe(409);
    expect(body.code).toBe('USERNAME_TAKEN');
  });

  it('reports username availability for the signup flow', async () => {
    const username = `avail_${suffix()}`;
    const free = await app.inject({ method: 'GET', url: `/v1/users/username-available?u=${username}` });
    expect(free.statusCode).toBe(200);
    expect(free.json()).toEqual({ available: true });

    await signup(username);
    const taken = await app.inject({ method: 'GET', url: `/v1/users/username-available?u=${username}` });
    expect(taken.json()).toEqual({ available: false });

    const malformed = await app.inject({ method: 'GET', url: '/v1/users/username-available?u=NO' });
    expect(malformed.json()).toEqual({ available: false });
  });
});

describe('login + session lifecycle (docs/API.md, docs/SECURITY.md §3)', () => {
  it('logs in with valid credentials and rejects wrong/unknown ones identically', async () => {
    const username = `login_${suffix()}`;
    const password = 'super-secret-password';
    await signup(username, password);

    const ok = await login(username, password);
    expect(ok.status).toBe(200);
    expect(typeof get(ok.body, 'token')).toBe('string');
    expect(JSON.stringify(ok.body)).not.toContain('recoveryCode');
    expect(JSON.stringify(ok.body)).not.toContain('$argon2id$');

    const wrong = await login(username, 'totally-wrong-password');
    expect(wrong.status).toBe(401);
    expect(get(wrong.body, 'code')).toBe('INVALID_CREDENTIALS');

    const unknown = await login(`nouser_${suffix()}`, password);
    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body); // identical generic response

    const malformed = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: {} });
    expect(malformed.statusCode).toBe(401);
    expect(malformed.json().code).toBe('INVALID_CREDENTIALS');
  });

  it('returns the authenticated user for a valid token only', async () => {
    const username = `me_${suffix()}`;
    const token = get((await signup(username)).body, 'token') as string;

    const unauth = await app.inject({ method: 'GET', url: '/v1/users/me' });
    expect(unauth.statusCode).toBe(401);
    expect(unauth.json().code).toBe('AUTH_REQUIRED');

    const garbage = await app.inject({
      method: 'GET',
      url: '/v1/users/me',
      headers: bearer('not-a-real-token'),
    });
    expect(garbage.statusCode).toBe(401);

    const ok = await app.inject({ method: 'GET', url: '/v1/users/me', headers: bearer(token) });
    expect(ok.statusCode).toBe(200);
    const user = ok.json().user as Record<string, unknown>;
    expect(user.username).toBe(username);
    expect(JSON.stringify(ok.body)).not.toContain('$argon2id$');
  });

  it('logs out and the token stops working immediately', async () => {
    const username = `out_${suffix()}`;
    const token = get((await signup(username)).body, 'token') as string;

    const before = await app.inject({ method: 'GET', url: '/v1/users/me', headers: bearer(token) });
    expect(before.statusCode).toBe(200);

    const logout = await app.inject({ method: 'POST', url: '/v1/auth/logout', headers: bearer(token) });
    expect(logout.statusCode).toBe(200);

    const after = await app.inject({ method: 'GET', url: '/v1/users/me', headers: bearer(token) });
    expect(after.statusCode).toBe(401);
  });

  it('lists sessions and marks the current one', async () => {
    const username = `sess_${suffix()}`;
    const t1 = get((await signup(username)).body, 'token') as string;
    const t2 = get((await login(username, 'super-secret-password')).body, 'token') as string;

    const list1 = await app.inject({ method: 'GET', url: '/v1/auth/sessions', headers: bearer(t1) });
    expect(list1.statusCode).toBe(200);
    const sessions1 = list1.json().sessions as Array<Record<string, unknown>>;
    expect(sessions1).toHaveLength(2);
    const current = sessions1.filter((s) => s.current === true);
    expect(current).toHaveLength(1);
    expect(current[0]!['deviceName']).toBe('Unknown device');
    expect(JSON.stringify(list1.body)).not.toContain('token_hash');

    await app.inject({ method: 'DELETE', url: '/v1/auth/sessions', headers: bearer(t1) });
    // t2 revoked, t1 still valid.
    const revokedCheck = await app.inject({ method: 'GET', url: '/v1/users/me', headers: bearer(t2) });
    expect(revokedCheck.statusCode).toBe(401);
    const stillValid = await app.inject({ method: 'GET', url: '/v1/users/me', headers: bearer(t1) });
    expect(stillValid.statusCode).toBe(200);
  });

  it('revokes a single own session by id and hides foreign sessions', async () => {
    const username = `revoke_${suffix()}`;
    const otherUserToken = get((await signup(`other_${suffix()}`)).body, 'token') as string;
    const token = get((await signup(username)).body, 'token') as string;
    const secondToken = get((await login(username, 'super-secret-password')).body, 'token') as string;

    const list = await app.inject({ method: 'GET', url: '/v1/auth/sessions', headers: bearer(token) });
    const sessions = list.json().sessions as Array<Record<string, unknown>>;
    const other = sessions.find((s) => s.current !== true) as { id: string };

    const foreign = await app.inject({
      method: 'DELETE',
      url: `/v1/auth/sessions/${(await app.inject({ method: 'GET', url: '/v1/auth/sessions', headers: bearer(otherUserToken) })).json().sessions[0].id}`,
      headers: bearer(token),
    });
    expect(foreign.statusCode).toBe(404);

    const ok = await app.inject({
      method: 'DELETE',
      url: `/v1/auth/sessions/${other.id}`,
      headers: bearer(token),
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().ok).toBe(true);

    const revokedSession = await app.inject({
      method: 'GET',
      url: '/v1/users/me',
      headers: bearer(secondToken),
    });
    expect(revokedSession.statusCode).toBe(401);
    const currentSession = await app.inject({
      method: 'GET',
      url: '/v1/users/me',
      headers: bearer(token),
    });
    expect(currentSession.statusCode).toBe(200);
  });

  it('rejects sessions expired past their TTL', async () => {
    const username = `exp_${suffix()}`;
    const token = get((await signup(username)).body, 'token') as string;
    const userId = (await client.query<{ id: string }>(`SELECT id FROM users WHERE username = $1`, [username]))
      .rows[0]!.id;
    await client.query(
      `UPDATE sessions SET expires_at = now() - interval '1 hour' WHERE user_id = $1`,
      [userId],
    );
    const res = await app.inject({ method: 'GET', url: '/v1/users/me', headers: bearer(token) });
    expect(res.statusCode).toBe(401);
  });
});

describe('password change + recovery reset (docs/SECURITY.md §4.3–4.4)', () => {
  it('changes the password, revokes other sessions and keeps the current one', async () => {
    const username = `pw_${suffix()}`;
    const oldPassword = 'super-secret-password';
    const newPassword = 'brand-new-password-42';
    const currentToken = get((await signup(username, oldPassword)).body, 'token') as string;
    const otherToken = get((await login(username, oldPassword)).body, 'token') as string;

    const wrong = await app.inject({
      method: 'POST',
      url: '/v1/auth/change-password',
      headers: bearer(currentToken),
      payload: { currentPassword: 'not-the-current-password', newPassword },
    });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().code).toBe('INVALID_CREDENTIALS');

    const weak = await app.inject({
      method: 'POST',
      url: '/v1/auth/change-password',
      headers: bearer(currentToken),
      payload: { currentPassword: oldPassword, newPassword: 'short' },
    });
    expect(weak.statusCode).toBe(400);

    const ok = await app.inject({
      method: 'POST',
      url: '/v1/auth/change-password',
      headers: bearer(currentToken),
      payload: { currentPassword: oldPassword, newPassword },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ ok: true, revokedSessions: 1 });

    const otherAfter = await app.inject({ method: 'GET', url: '/v1/users/me', headers: bearer(otherToken) });
    expect(otherAfter.statusCode).toBe(401);
    const currentAfter = await app.inject({ method: 'GET', url: '/v1/users/me', headers: bearer(currentToken) });
    expect(currentAfter.statusCode).toBe(200);

    const oldLogin = await login(username, oldPassword);
    expect(oldLogin.status).toBe(401);
    const newLogin = await login(username, newPassword);
    expect(newLogin.status).toBe(200);
  });

  it('resets the password with the recovery code, rotates it and revokes all sessions', async () => {
    const username = `rec_${suffix()}`;
    const oldPassword = 'super-secret-password';
    const newPassword = 'recovered-password-99';
    const signupBody = (await signup(username, oldPassword)).body;
    const token = get(signupBody, 'token') as string;
    const originalRecoveryCode = get(signupBody, 'recoveryCode') as string;

    const wrong = await app.inject({
      method: 'POST',
      url: '/v1/auth/recovery-reset',
      payload: { username, recoveryCode: 'ZZZZ-ZZZZ-ZZZZ', newPassword },
    });
    expect(wrong.statusCode).toBe(401);
    expect((wrong.json() as Record<string, unknown>).code).toBe('INVALID_CREDENTIALS');

    const ok = await app.inject({
      method: 'POST',
      url: '/v1/auth/recovery-reset',
      payload: { username, recoveryCode: originalRecoveryCode.toLowerCase(), newPassword },
    });
    expect(ok.statusCode).toBe(200);
    const newRecoveryCode = get(ok.json() as Record<string, unknown>, 'recoveryCode') as string;
    expect(newRecoveryCode).toMatch(/^[1-9A-HJ-NP-Z]{4}-[1-9A-HJ-NP-Z]{4}-[1-9A-HJ-NP-Z]{4}$/);
    expect(get(ok.json() as Record<string, unknown>, 'revokedSessions')).toBe(1);

    // All sessions were revoked by the reset.
    const oldToken = await app.inject({ method: 'GET', url: '/v1/users/me', headers: bearer(token) });
    expect(oldToken.statusCode).toBe(401);
    // Login works with the new password only.
    expect((await login(username, oldPassword)).status).toBe(401);
    expect((await login(username, newPassword)).status).toBe(200);
    // The old recovery code no longer works; the new one does.
    const oldCode = await app.inject({
      method: 'POST',
      url: '/v1/auth/recovery-reset',
      payload: { username, recoveryCode: originalRecoveryCode, newPassword: 'another-password-11' },
    });
    expect(oldCode.statusCode).toBe(401);
    const secondReset = await app.inject({
      method: 'POST',
      url: '/v1/auth/recovery-reset',
      payload: { username, recoveryCode: newRecoveryCode, newPassword: 'another-password-11' },
    });
    expect(secondReset.statusCode).toBe(200);
  });
});

describe('rate limiting (docs/SECURITY.md §6)', () => {
  it('returns 429 RATE_LIMITED after the documented login burst', async () => {
    const limited = await buildApp({ db, rateLimit: true });
    const username = `rl_${suffix()}`;
    let saw429 = false;
    for (let i = 0; i < 12; i++) {
      const res = await limited.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: { username, password: 'whatever-password' },
      });
      if (res.statusCode === 429) {
        saw429 = true;
        expect(res.json().code).toBe('RATE_LIMITED');
        break;
      }
    }
    expect(saw429).toBe(true);
    await limited.close();
  });
});
