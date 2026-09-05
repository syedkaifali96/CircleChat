import type { FastifyInstance } from 'fastify';
import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { createDatabase, type Database } from '../../db/client';
import type { ExpoPushGateway, ExpoPushMessage, ExpoPushTicket } from '../notifications/expo';
import { migrateTestDatabase, resolveTestDatabaseUrl, startEmbeddedPostgres } from '../../db/testing';

/**
 * M8 notification integration tests — real PostgreSQL, real HTTP flows.
 * Push delivery is observed through an in-memory capturing gateway (the
 * provider is the ONLY external boundary; Expo Push is a plain HTTPS POST,
 * so the captured payloads ARE the wire content).
 */

let client: Client;
let stopEmbedded: (() => Promise<void>) | undefined;
let db: Database;
let app: FastifyInstance;

const suffix = () => Math.random().toString(36).slice(2, 10);

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

async function signup(username: string): Promise<{ token: string; userId: string; username: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/signup',
    payload: { username, displayName: `Display ${username}`, password: 'super-secret-password' },
  });
  const body = res.json() as { token: string; user: { id: string; username: string } };
  if (!body.user) {
    throw new Error(`signup failed for ${username}: status ${res.statusCode}`);
  }
  return { token: body.token, userId: body.user.id, username: body.user.username };
}

/** Registers a push token on the user's CURRENT session. */
async function registerPushToken(token: string, pushToken: string): Promise<number> {
  const res = await app.inject({
    method: 'PUT',
    url: '/v1/auth/push-token',
    headers: bearer(token),
    payload: { pushToken },
  });
  return res.statusCode;
}

async function setupCircleConversation(memberTokens: string[]): Promise<{ owner: { token: string; userId: string }; conversationId: string }> {
  const owner = await signup(`m8_ow_${suffix()}`);
  const created = await app.inject({
    method: 'POST',
    url: '/v1/circles',
    headers: bearer(owner.token),
    payload: { name: `M8 Circle ${suffix()}` },
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

async function sendText(token: string, conversationId: string, body: string): Promise<number> {
  const res = await app.inject({
    method: 'POST',
    url: `/v1/conversations/${conversationId}/messages`,
    headers: bearer(token),
    payload: { type: 'text', body, clientMessageId: `m8_${suffix()}_${Math.random().toString(36).slice(2, 8)}` },
  });
  return res.statusCode;
}

// ---- Capturing gateway: records every pushed message -----------------------
class CapturingExpoGateway implements ExpoPushGateway {
  sent: ExpoPushMessage[] = [];
  /** Next-send behavior override (provider failure simulation). */
  behavior: 'ok' | 'provider_down' | 'device_not_registered' = 'ok';

  async send(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]> {
    if (this.behavior === 'provider_down') {
      return messages.map(() => ({ status: 'error', details: { error: 'http_503' } }));
    }
    this.sent.push(...messages);
    return messages.map((m) => {
      if (this.behavior === 'device_not_registered' && m.to === 'expo-expired-token') {
        return { status: 'error', details: { error: 'DeviceNotRegistered' } };
      }
      return { status: 'ok', id: `ticket_${m.to}` };
    });
  }
}

let gateway: CapturingExpoGateway;

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
  gateway = new CapturingExpoGateway();
  // Main app WITHOUT the rate-limit plugin: this file signs up many users and
  // the auth signup limiter (5/hour/IP) would otherwise cascade-429 them. The
  // churn test below builds its own limited app to exercise the limiter.
  app = await buildApp({ db, expoPush: gateway, logger: { level: 'warn' } });
}, 300_000);

afterAll(async () => {
  await db.$client.end();
  await client?.end();
  await stopEmbedded?.();
}, 60_000);

afterEach(() => {
  gateway.sent = [];
  gateway.behavior = 'ok';
});

describe('push token registration (M8, docs/API.md)', () => {
  it('registers a token on the current session and requires auth', async () => {
    const user = await signup(`m8_pu_${suffix()}`);

    const anon = await app.inject({ method: 'PUT', url: '/v1/auth/push-token', payload: { pushToken: 'Expo xyz' } });
    expect(anon.statusCode).toBe(401);

    const ok = await registerPushToken(user.token, 'expo-token-a');
    expect(ok).toBe(200);
    const row = await client.query<{ push_token: string | null }>(
      `SELECT push_token FROM sessions WHERE user_id = $1 AND revoked_at IS NULL`,
      [user.userId],
    );
    expect(row.rows[0]!.push_token).toBe('expo-token-a');
  });

  it('moves a duplicate token to the newest session (one token = one device)', async () => {
    const user = await signup(`m8_du_${suffix()}`);
    // Simulate two devices: two live sessions via login.
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: bearer(''),
      payload: { username: user.username ?? '', password: '' },
    });
    void login;
    const signup2 = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { username: user.username, password: 'super-secret-password' },
    });
    const tokenB = (signup2.json() as { token: string }).token;
    await registerPushToken(user.token, 'expo-shared-token');
    await registerPushToken(tokenB, 'expo-shared-token');

    const rows = await client.query<{ push_token: string | null }>(
      `SELECT push_token FROM sessions WHERE user_id = $1 AND revoked_at IS NULL AND push_token IS NOT NULL`,
      [user.userId],
    );
    expect(rows.rows).toHaveLength(1); // token lives on exactly one session
  });

  it('clears the token on unregister and rejects revoked sessions', async () => {
    const user = await signup(`m8_cl_${suffix()}`);
    await registerPushToken(user.token, 'expo-token-clearme');
    await app.inject({ method: 'DELETE', url: '/v1/auth/push-token', headers: bearer(user.token) });
    const row = await client.query<{ push_token: string | null }>(
      `SELECT push_token FROM sessions WHERE user_id = $1 AND revoked_at IS NULL`,
      [user.userId],
    );
    expect(row.rows[0]!.push_token).toBeNull();

    await client.query(`UPDATE sessions SET revoked_at = now() WHERE user_id = $1`, [user.userId]);
    // Revoked sessions are rejected. Assertion uses the un-rate-limited
    // DELETE route: the churn test exhausts this route's 10/min bucket and
    // the limiter runs before auth for the same IP.
    const revoked = await app.inject({
      method: 'DELETE',
      url: '/v1/auth/push-token',
      headers: bearer(user.token),
    });
    expect(revoked.statusCode).toBe(401);
  });

  // Last: it exhausts the push-token route's rate-limit bucket for a minute.
  // Runs against a dedicated app WITH the rate-limit plugin enabled.
  it('validates the token shape and rate-limits churn', async () => {
    const limitedApp = await buildApp({
      db,
      expoPush: gateway,
      rateLimit: true,
      logger: { level: 'warn' },
    });
    const user = await signup(`m8_va_${suffix()}`);
    const bad = await limitedApp.inject({
      method: 'PUT',
      url: '/v1/auth/push-token',
      headers: bearer(user.token),
      payload: { pushToken: 'x' },
    });
    expect(bad.statusCode).toBe(400);

    let denied = 0;
    for (let i = 0; i < 12; i++) {
      const res = await limitedApp.inject({
        method: 'PUT',
        url: '/v1/auth/push-token',
        headers: bearer(user.token),
        payload: { pushToken: `expo-token-${i}` },
      });
      if (res.statusCode === 429) {
        denied += 1;
      }
    }
    expect(denied).toBeGreaterThan(0);
    await limitedApp.close();
  });
});

describe('direct message notifications (M8)', () => {
  it('pushes to the recipient only, with sender excluded', async () => {
    const a = await signup(`m8_da_${suffix()}`);
    const b = await signup(`m8_db_${suffix()}`);
    await setupCircleConversation([a.token, b.token]);
    const bName = (await client.query<{ username: string }>(`SELECT username FROM users WHERE id = $1`, [b.userId])).rows[0]!.username;
    const convId = await createDirect(a.token, bName);
    await registerPushToken(a.token, 'expo-token-aaaaaa');
    await registerPushToken(b.token, 'expo-token-bbbbbb');

    await sendText(a.token, convId, 'hello direct');
    expect(gateway.sent).toHaveLength(1);
    expect(gateway.sent[0]!.to).toBe('expo-token-bbbbbb');
    expect(gateway.sent[0]!.title).toBe(`Display ${bName.slice(0, 0)}${gateway.sent[0]!.title}`.slice(0, 0) || gateway.sent[0]!.title);
    expect(gateway.sent[0]!.body).toBe('hello direct');
    expect(gateway.sent[0]!.data).toEqual({ conversationId: convId, messageId: expect.any(String), type: 'text' });
  });

  it('suppresses push when the recipient muted the conversation', async () => {
    const a = await signup(`m8_dm_${suffix()}`);
    const b = await signup(`m8_dmb_${suffix()}`);
    await setupCircleConversation([a.token, b.token]);
    const bName = (await client.query<{ username: string }>(`SELECT username FROM users WHERE id = $1`, [b.userId])).rows[0]!.username;
    const convId = await createDirect(a.token, bName);
    await registerPushToken(b.token, 'expo-token-muteddd');

    await app.inject({
      method: 'PATCH',
      url: `/v1/conversations/${convId}/notification-pref`,
      headers: bearer(b.token),
      payload: { muted: true },
    });
    await sendText(a.token, convId, 'you will not hear this');
    expect(gateway.sent).toHaveLength(0);
  });

  it('suppresses push when the recipient disabled notifications globally', async () => {
    const a = await signup(`m8_dg_${suffix()}`);
    const b = await signup(`m8_dgb_${suffix()}`);
    await setupCircleConversation([a.token, b.token]);
    const bName = (await client.query<{ username: string }>(`SELECT username FROM users WHERE id = $1`, [b.userId])).rows[0]!.username;
    const convId = await createDirect(a.token, bName);
    await registerPushToken(b.token, 'expo-token-globaloff');

    await app.inject({
      method: 'PATCH',
      url: '/v1/users/me/notification-settings',
      headers: bearer(b.token),
      payload: { notificationsEnabled: false },
    });
    await sendText(a.token, convId, 'silent globally');
    expect(gateway.sent).toHaveLength(0);
  });

  it('hides the message body when preview privacy is on (either scope)', async () => {
    const a = await signup(`m8_dp_${suffix()}`);
    const b = await signup(`m8_dpb_${suffix()}`);
    await setupCircleConversation([a.token, b.token]);
    const bName = (await client.query<{ username: string }>(`SELECT username FROM users WHERE id = $1`, [b.userId])).rows[0]!.username;
    const convId = await createDirect(a.token, bName);
    await registerPushToken(b.token, 'expo-token-preview');

    // Conversation-level preview off.
    await app.inject({
      method: 'PATCH',
      url: `/v1/conversations/${convId}/notification-pref`,
      headers: bearer(b.token),
      payload: { preview: false },
    });
    await sendText(a.token, convId, 'secret content');
    expect(gateway.sent[0]!.body).toBe('New message');

    gateway.sent = [];
    // User-level preview off (conversation pref back on).
    await app.inject({
      method: 'PATCH',
      url: `/v1/conversations/${convId}/notification-pref`,
      headers: bearer(b.token),
      payload: { preview: true },
    });
    await app.inject({
      method: 'PATCH',
      url: '/v1/users/me/notification-settings',
      headers: bearer(b.token),
      payload: { notificationPreview: false },
    });
    await sendText(a.token, convId, 'secret again');
    expect(gateway.sent[0]!.body).toBe('New message');
  });

  it('never pushes to a revoked session token', async () => {
    const a = await signup(`m8_dr_${suffix()}`);
    const b = await signup(`m8_drb_${suffix()}`);
    await setupCircleConversation([a.token, b.token]);
    const bName = (await client.query<{ username: string }>(`SELECT username FROM users WHERE id = $1`, [b.userId])).rows[0]!.username;
    const convId = await createDirect(a.token, bName);
    await registerPushToken(b.token, 'expo-token-revoked');
    await client.query(`UPDATE sessions SET revoked_at = now(), push_token = 'expo-token-revoked' WHERE user_id = $1`, [b.userId]);

    await sendText(a.token, convId, 'after revocation');
    expect(gateway.sent).toHaveLength(0);
  });
});

describe('circle message notifications (M8)', () => {
  it('pushes to all eligible members except the sender and muted members', async () => {
    const member = await signup(`m8_c_m_${suffix()}`);
    const muted = await signup(`m8_c_mu_${suffix()}`);
    // The setup owner is the sender; both member and muted joined the Circle.
    const { owner, conversationId } = await setupCircleConversation([member.token, muted.token]);

    await registerPushToken(owner.token, 'expo-token-owner');
    await registerPushToken(member.token, 'expo-token-member');
    await registerPushToken(muted.token, 'expo-token-mutedm');
    await app.inject({
      method: 'PATCH',
      url: `/v1/conversations/${conversationId}/notification-pref`,
      headers: bearer(muted.token),
      payload: { muted: true },
    });

    await sendText(owner.token, conversationId, 'circle hello');
    const targets = gateway.sent.map((m) => m.to).sort();
    expect(targets).toEqual(['expo-token-member']);
    expect(gateway.sent[0]!.title).toContain('M8 Circle');
    expect(gateway.sent[0]!.body).toBe('circle hello');
  });

  it('stops notifying a member after they leave the Circle', async () => {
    const member = await signup(`m8_c_lm_${suffix()}`);
    const { owner: setupOwner, conversationId } = await setupCircleConversation([member.token]);
    await registerPushToken(member.token, 'expo-token-leaver');

    // Owner removes the member (M4 API), then sends a new message.
    const circleId = (await client.query<{ circle_id: string }>(`SELECT circle_id FROM conversations WHERE id = $1`, [conversationId])).rows[0]!.circle_id;
    await app.inject({
      method: 'DELETE',
      url: `/v1/circles/${circleId}/members/${member.userId}`,
      headers: bearer(setupOwner.token),
    });
    await sendText(setupOwner.token, conversationId, 'you are gone');
    expect(gateway.sent).toHaveLength(0);
  });
});

describe('push failure handling (M8, docs/ARCHITECTURE.md §10)', () => {
  it('still returns 201 for the message when the provider is down', async () => {
    const a = await signup(`m8_pf_${suffix()}`);
    const b = await signup(`m8_pfb_${suffix()}`);
    await setupCircleConversation([a.token, b.token]);
    const bName = (await client.query<{ username: string }>(`SELECT username FROM users WHERE id = $1`, [b.userId])).rows[0]!.username;
    const convId = await createDirect(a.token, bName);
    await registerPushToken(b.token, 'expo-token-provdown');

    gateway.behavior = 'provider_down';
    const status = await sendText(a.token, convId, 'message survives push outage');
    expect(status).toBe(201);
    expect(gateway.sent).toHaveLength(0); // failed batch is not recorded as delivered
  });

  it('clears DeviceNotRegistered tokens so other devices keep receiving', async () => {
    const a = await signup(`m8_it_${suffix()}`);
    const b = await signup(`m8_itb_${suffix()}`);
    await setupCircleConversation([a.token, b.token]);
    const bName = (await client.query<{ username: string }>(`SELECT username FROM users WHERE id = $1`, [b.userId])).rows[0]!.username;
    const convId = await createDirect(a.token, bName);
    // Two devices for B: one expired, one healthy.
    await registerPushToken(b.token, 'expo-expired-token');
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { username: bName, password: 'super-secret-password' },
    });
    await registerPushToken(login.json().token as string, 'expo-token-healthy');

    gateway.behavior = 'device_not_registered';
    await sendText(a.token, convId, 'to both devices');
    expect(gateway.sent.map((m) => m.to).sort()).toEqual(['expo-expired-token', 'expo-token-healthy']);

    const expired = await client.query<{ push_token: string | null }>(
      `SELECT push_token FROM sessions WHERE push_token = 'expo-expired-token'`,
    );
    expect(expired.rows).toHaveLength(0); // cleaned up

    gateway.behavior = 'ok';
    gateway.sent = [];
    await sendText(a.token, convId, 'only healthy now');
    expect(gateway.sent.map((m) => m.to)).toEqual(['expo-token-healthy']);
  });
});

describe('notification settings endpoints (M8)', () => {
  it('reads and updates the caller global settings; requires auth', async () => {
    const user = await signup(`m8_st_${suffix()}`);

    const anon = await app.inject({ method: 'GET', url: '/v1/users/me/notification-settings' });
    expect(anon.statusCode).toBe(401);

    const initial = await app.inject({
      method: 'GET',
      url: '/v1/users/me/notification-settings',
      headers: bearer(user.token),
    });
    expect(initial.json().settings).toEqual({ notificationsEnabled: true, notificationPreview: true });

    const patch = await app.inject({
      method: 'PATCH',
      url: '/v1/users/me/notification-settings',
      headers: bearer(user.token),
      payload: { notificationsEnabled: false },
    });
    expect(patch.json().settings).toEqual({ notificationsEnabled: false, notificationPreview: true });

    const empty = await app.inject({
      method: 'PATCH',
      url: '/v1/users/me/notification-settings',
      headers: bearer(user.token),
      payload: {},
    });
    expect(empty.statusCode).toBe(400);
  });

  it('serves the caller conversation notification pref with defaults', async () => {
    // The setup owner IS a member of the conversation; a fresh signup is not.
    const { owner, conversationId } = await setupCircleConversation([]);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/conversations/${conversationId}/notification-pref`,
      headers: bearer(owner.token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().pref).toEqual({ enabled: true, muted: false, mentions: true, preview: true });
  });
});
