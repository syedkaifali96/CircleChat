import type { FastifyInstance } from 'fastify';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { createDatabase, type Database } from '../../db/client';
import { InMemoryStorageGateway } from '../media/storage';
import { migrateTestDatabase, resolveTestDatabaseUrl, startEmbeddedPostgres } from '../../db/testing';

/**
 * M5 messaging integration tests — real PostgreSQL, real HTTP flows.
 * Covers docs/API.md conversation + message contracts: direct find-or-create
 * (D1 shared-Circle rule), idempotent sends, keyset pagination, 24h sender
 * edit, sender/admin tombstone delete, reactions, read state/unread counts,
 * notification prefs and authorization/existence-hiding rules.
 */

let client: Client;
let stopEmbedded: (() => Promise<void>) | undefined;
let db: Database;
let app: FastifyInstance;
let storage: InMemoryStorageGateway;

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

/** Creates a Circle owned by ownerToken and joins all given users to it. */
async function formCircle(
  ownerToken: string,
  members: Array<{ token: string }>,
): Promise<string> {
  const created = await app.inject({
    method: 'POST',
    url: '/v1/circles',
    headers: bearer(ownerToken),
    payload: { name: `Circle ${suffix()}` },
  });
  const circleId = (created.json() as { circle: { id: string } }).circle.id;
  const invite = await app.inject({
    method: 'POST',
    url: `/v1/circles/${circleId}/invite`,
    headers: bearer(ownerToken),
    payload: {},
  });
  const code = (invite.json() as { inviteCode: string }).inviteCode;
  for (const member of members) {
    await app.inject({
      method: 'POST',
      url: '/v1/circles/join',
      headers: bearer(member.token),
      payload: { inviteCode: code },
    });
  }
  return circleId;
}

async function createDirect(token: string, username: string): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/conversations/direct',
    headers: bearer(token),
    payload: { username },
  });
  return { statusCode: res.statusCode, body: res.json() as Record<string, unknown> };
}

async function send(
  token: string,
  conversationId: string,
  payload: Record<string, unknown>,
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  const res = await app.inject({
    method: 'POST',
    url: `/v1/conversations/${conversationId}/messages`,
    headers: bearer(token),
    payload: { type: 'text', clientMessageId: `cmi_${suffix()}`, ...payload },
  });
  return { statusCode: res.statusCode, body: res.json() as Record<string, unknown> };
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

describe('direct conversations (D1 shared-Circle rule, docs/API.md)', () => {
  it('creates a direct conversation for users sharing an active Circle', async () => {
    const a = await signup(`dma_${suffix()}`);
    const b = await signup(`dmb_${suffix()}`);
    await formCircle(a.token, [b]);

    const first = await createDirect(a.token, (await client.query<{ username: string }>(
      `SELECT username FROM users WHERE id = $1`,
      [b.userId],
    )).rows[0]!.username);
    expect(first.statusCode).toBe(201);
    expect(first.body.created).toBe(true);
    const conversationId = first.body.conversationId as string;

    // Exactly two participants in one transaction-inserted set.
    const rows = await client.query<{ user_id: string }>(
      `SELECT user_id::text FROM conversation_participants WHERE conversation_id = $1 ORDER BY user_id`,
      [conversationId],
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.map((r) => r.user_id).sort()).toEqual([a.userId, b.userId].sort());
  });

  it('is idempotent: duplicate creation returns the same conversation (200)', async () => {
    const a = await signup(`dmd_${suffix()}`);
    const b = await signup(`dme_${suffix()}`);
    await formCircle(a.token, [b]);
    const username = (await client.query<{ username: string }>(`SELECT username FROM users WHERE id = $1`, [b.userId])).rows[0]!.username;

    const first = await createDirect(a.token, username);
    const second = await createDirect(a.token, username);
    expect(second.statusCode).toBe(200);
    expect(second.body.created).toBe(false);
    expect(second.body.conversationId).toBe(first.body.conversationId);

    const count = await client.query<{ count: number }>(
      `SELECT count(*)::int FROM conversations WHERE type = 'direct' AND id = $1`,
      [first.body.conversationId],
    );
    expect(count.rows[0]!.count).toBe(1);
  });

  it('rejects creation without a shared active Circle and hides existence', async () => {
    const a = await signup(`dmf_${suffix()}`);
    const stranger = await signup(`dmg_${suffix()}`);
    const strangerName = (await client.query<{ username: string }>(`SELECT username FROM users WHERE id = $1`, [stranger.userId])).rows[0]!.username;

    const res = await createDirect(a.token, strangerName);
    expect(res.statusCode).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('rejects self-targeting and unknown usernames with the same 404', async () => {
    const a = await signup(`dmh_${suffix()}`);
    const ownName = (await client.query<{ username: string }>(`SELECT username FROM users WHERE id = $1`, [a.userId])).rows[0]!.username;
    const self = await createDirect(a.token, ownName);
    expect(self.statusCode).toBe(404);

    const ghost = await createDirect(a.token, `ghost_${suffix()}`);
    expect(ghost.statusCode).toBe(404);
  });

  it('hides the direct conversation from non-participants', async () => {
    const a = await signup(`dmi_${suffix()}`);
    const b = await signup(`dmj_${suffix()}`);
    const outsider = await signup(`dmk_${suffix()}`);
    await formCircle(a.token, [b]);
    const username = (await client.query<{ username: string }>(`SELECT username FROM users WHERE id = $1`, [b.userId])).rows[0]!.username;
    const { body } = await createDirect(a.token, username);
    const conversationId = body.conversationId as string;

    const denied = await app.inject({
      method: 'GET',
      url: `/v1/conversations/${conversationId}/messages`,
      headers: bearer(outsider.token),
    });
    expect(denied.statusCode).toBe(404);
    expect(denied.json().code).toBe('NOT_FOUND');

    const deniedSend = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${conversationId}/messages`,
      headers: bearer(outsider.token),
      payload: { type: 'text', body: 'sneak', clientMessageId: 'x1' },
    });
    expect(deniedSend.statusCode).toBe(404);
  });
});

describe('message send + idempotency (docs/API.md)', () => {
  it('sends a text message in a circle conversation', async () => {
    const owner = await signup(`snd_${suffix()}`);
    const circleId = await formCircle(owner.token, []);
    const list = await app.inject({ method: 'GET', url: '/v1/conversations', headers: bearer(owner.token) });
    const conv = (list.json() as { conversations: Array<{ id: string; circleId: string | null }> }).conversations.find((c) => c.circleId === circleId)!;

    const sent = await send(owner.token, conv.id, { body: 'Hello Circle!' });
    expect(sent.statusCode).toBe(201);
    const message = sent.body.message as Record<string, unknown>;
    expect(message.body).toBe('Hello Circle!');
    expect(message.type).toBe('text');
    expect(message.deleted).toBe(false);
    expect(message.senderId).toBe(owner.userId);

    const row = await client.query<{ count: number; last_message_at: Date | null }>(
      `SELECT (SELECT count(*)::int FROM messages WHERE conversation_id = $1) AS count,
              (SELECT last_message_at IS NOT NULL FROM conversations WHERE id = $1) AS last_message_at`,
      [conv.id],
    );
    expect(row.rows[0]!.count).toBe(1);
    expect(row.rows[0]!.last_message_at).toBe(true);
  });

  it('rejects invalid bodies (empty, >4000) and invalid reply targets', async () => {
    const owner = await signup(`bad_${suffix()}`);
    const circleId = await formCircle(owner.token, []);
    const list = await app.inject({ method: 'GET', url: '/v1/conversations', headers: bearer(owner.token) });
    const conv = (list.json() as { conversations: Array<{ id: string; circleId: string | null }> }).conversations.find((c) => c.circleId === circleId)!;

    const empty = await send(owner.token, conv.id, { body: '   ' });
    expect(empty.statusCode).toBe(400);

    const long = await send(owner.token, conv.id, { body: 'x'.repeat(4001) });
    expect(long.statusCode).toBe(400);

    const badReply = await send(owner.token, conv.id, {
      body: 'reply to nothing',
      replyToId: '00000000-0000-4000-8000-000000000000',
    });
    expect(badReply.statusCode).toBe(400);
    expect(badReply.body.code).toBe('INVALID_REPLY_TARGET');
  });

  it('is idempotent: same clientMessageId returns the same message, no duplicate', async () => {
    const owner = await signup(`idem_${suffix()}`);
    const circleId = await formCircle(owner.token, []);
    const list = await app.inject({ method: 'GET', url: '/v1/conversations', headers: bearer(owner.token) });
    const conv = (list.json() as { conversations: Array<{ id: string; circleId: string | null }> }).conversations.find((c) => c.circleId === circleId)!;

    const cmi = `idem_${suffix()}`;
    const first = await send(owner.token, conv.id, { body: 'once', clientMessageId: cmi });
    expect(first.statusCode).toBe(201);
    const retry = await send(owner.token, conv.id, { body: 'once', clientMessageId: cmi });
    expect(retry.statusCode).toBe(200);
    expect(retry.body.created).toBe(false);
    expect((retry.body.message as { id: string }).id).toBe((first.body.message as { id: string }).id);

    const count = await client.query<{ count: number }>(
      `SELECT count(*)::int FROM messages WHERE conversation_id = $1`,
      [conv.id],
    );
    expect(count.rows[0]!.count).toBe(1);
  });

  it('handles concurrent duplicate sends: exactly one row wins', async () => {
    const owner = await signup(`race_${suffix()}`);
    const circleId = await formCircle(owner.token, []);
    const list = await app.inject({ method: 'GET', url: '/v1/conversations', headers: bearer(owner.token) });
    const conv = (list.json() as { conversations: Array<{ id: string; circleId: string | null }> }).conversations.find((c) => c.circleId === circleId)!;

    const cmi = `race_${suffix()}`;
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        app.inject({
          method: 'POST',
          url: `/v1/conversations/${conv.id}/messages`,
          headers: bearer(owner.token),
          payload: { type: 'text', body: 'same', clientMessageId: cmi },
        }),
      ),
    );
    const created = results.filter((r) => r.statusCode === 201);
    const reused = results.filter((r) => r.statusCode === 200);
    expect(created.length + reused.length).toBe(5);
    expect(created).toHaveLength(1);

    const count = await client.query<{ count: number }>(
      `SELECT count(*)::int FROM messages WHERE conversation_id = $1 AND client_message_id = $2`,
      [conv.id, cmi],
    );
    expect(count.rows[0]!.count).toBe(1);
  });

  it('validates reply targets within the same conversation only', async () => {
    const owner = await signup(`rpl_${suffix()}`);
    const circleA = await formCircle(owner.token, []);
    const circleB = await formCircle(owner.token, []);
    const list = await app.inject({ method: 'GET', url: '/v1/conversations', headers: bearer(owner.token) });
    const conversations = (list.json() as { conversations: Array<{ id: string; circleId: string | null }> }).conversations;
    const convA = conversations.find((c) => c.circleId === circleA)!.id;
    const convB = conversations.find((c) => c.circleId === circleB)!.id;

    const base = await send(owner.token, convA, { body: 'root' });
    const baseId = (base.body.message as { id: string }).id;

    const ok = await send(owner.token, convA, { body: 'reply', replyToId: baseId });
    expect(ok.statusCode).toBe(201);
    const message = ok.body.message as { replyToId: string; replyPreview: { body: string } | null };
    expect(message.replyToId).toBe(baseId);
    expect(message.replyPreview?.body).toBe('root');

    const cross = await send(owner.token, convB, { body: 'cross-reply', replyToId: baseId });
    expect(cross.statusCode).toBe(400);
    expect(cross.body.code).toBe('INVALID_REPLY_TARGET');
  });
});

describe('message history + keyset pagination (docs/API.md)', () => {
  it('returns deterministic newest-first pages with no duplicates across pages', async () => {
    const owner = await signup(`pg_${suffix()}`);
    const circleId = await formCircle(owner.token, []);
    const list = await app.inject({ method: 'GET', url: '/v1/conversations', headers: bearer(owner.token) });
    const conv = (list.json() as { conversations: Array<{ id: string; circleId: string | null }> }).conversations.find((c) => c.circleId === circleId)!;

    for (let i = 0; i < 12; i++) {
      const res = await send(owner.token, conv.id, { body: `msg ${i}` });
      expect(res.statusCode).toBe(201);
    }

    const page1 = await app.inject({
      method: 'GET',
      url: `/v1/conversations/${conv.id}/messages?limit=5`,
      headers: bearer(owner.token),
    });
    const body1 = page1.json() as { messages: Array<{ id: string; body: string }>; nextBeforeCursor: string | null };
    expect(body1.messages).toHaveLength(5);
    expect(body1.messages[0]!.body).toBe('msg 11'); // newest first

    const page2 = await app.inject({
      method: 'GET',
      url: `/v1/conversations/${conv.id}/messages?limit=5&before=${body1.nextBeforeCursor}`,
      headers: bearer(owner.token),
    });
    const body2 = page2.json() as { messages: Array<{ id: string; body: string }>; nextBeforeCursor: string | null };
    expect(body2.messages).toHaveLength(5);

    const page3 = await app.inject({
      method: 'GET',
      url: `/v1/conversations/${conv.id}/messages?limit=5&before=${body2.nextBeforeCursor}`,
      headers: bearer(owner.token),
    });
    const body3 = page3.json() as { messages: Array<{ id: string; body: string }>; nextBeforeCursor: string | null };
    expect(body3.messages).toHaveLength(2);
    expect(body3.nextBeforeCursor).toBeNull();

    const all = [...body1.messages, ...body2.messages, ...body3.messages];
    const ids = new Set(all.map((m) => m.id));
    expect(ids.size).toBe(12); // duplicate-free
    // Newest-first by insertion sequence (msg 11 … msg 0).
    expect(all.map((m) => m.body)).toEqual(
      Array.from({ length: 12 }, (_, i) => `msg ${11 - i}`),
    );
  });

  it('enforces the server-side page cap and rejects invalid cursors', async () => {
    const owner = await signup(`pgc_${suffix()}`);
    const circleId = await formCircle(owner.token, []);
    const list = await app.inject({ method: 'GET', url: '/v1/conversations', headers: bearer(owner.token) });
    const conv = (list.json() as { conversations: Array<{ id: string; circleId: string | null }> }).conversations.find((c) => c.circleId === circleId)!;

    const over = await app.inject({
      method: 'GET',
      url: `/v1/conversations/${conv.id}/messages?limit=500`,
      headers: bearer(owner.token),
    });
    expect(over.statusCode).toBe(400);

    const badCursor = await app.inject({
      method: 'GET',
      url: `/v1/conversations/${conv.id}/messages?before=00000000-0000-4000-8000-000000000000`,
      headers: bearer(owner.token),
    });
    expect(badCursor.statusCode).toBe(400);
    expect(badCursor.json().code).toBe('INVALID_CURSOR');
  });

  it('returns an empty page for a conversation with no messages', async () => {
    const owner = await signup(`pge_${suffix()}`);
    const circleId = await formCircle(owner.token, []);
    const list = await app.inject({ method: 'GET', url: '/v1/conversations', headers: bearer(owner.token) });
    const conv = (list.json() as { conversations: Array<{ id: string; circleId: string | null }> }).conversations.find((c) => c.circleId === circleId)!;

    const res = await app.inject({
      method: 'GET',
      url: `/v1/conversations/${conv.id}/messages`,
      headers: bearer(owner.token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().messages).toEqual([]);
    expect(res.json().nextBeforeCursor).toBeNull();
  });
});

describe('edit (sender-only, 24h window, docs/API.md D2)', () => {
  it('lets the sender edit within the window and marks editedAt', async () => {
    const owner = await signup(`edt_${suffix()}`);
    const circleId = await formCircle(owner.token, []);
    const list = await app.inject({ method: 'GET', url: '/v1/conversations', headers: bearer(owner.token) });
    const conv = (list.json() as { conversations: Array<{ id: string; circleId: string | null }> }).conversations.find((c) => c.circleId === circleId)!;
    const sent = await send(owner.token, conv.id, { body: 'original' });
    const messageId = (sent.body.message as { id: string }).id;

    const edited = await app.inject({
      method: 'PATCH',
      url: `/v1/messages/${messageId}`,
      headers: bearer(owner.token),
      payload: { body: 'edited text' },
    });
    expect(edited.statusCode).toBe(200);
    const message = edited.json().message as { body: string; editedAt: string | null };
    expect(message.body).toBe('edited text');
    expect(message.editedAt).not.toBeNull();
  });

  it('rejects non-sender edits, including circle admins/owner', async () => {
    const owner = await signup(`edto_${suffix()}`);
    const admin = await signup(`edta_${suffix()}`);
    const member = await signup(`edtm_${suffix()}`);
    const circleId = await formCircle(owner.token, [admin, member]);
    const list = await app.inject({ method: 'GET', url: '/v1/conversations', headers: bearer(member.token) });
    const conv = (list.json() as { conversations: Array<{ id: string; circleId: string | null }> }).conversations.find((c) => c.circleId === circleId)!;
    const sent = await send(member.token, conv.id, { body: 'mine' });
    const messageId = (sent.body.message as { id: string }).id;

    // Owner (admin tier) attempts to edit the member's message.
    const ownerEdit = await app.inject({
      method: 'PATCH',
      url: `/v1/messages/${messageId}`,
      headers: bearer(owner.token),
      payload: { body: 'hijacked' },
    });
    expect(ownerEdit.statusCode).toBe(403);
    expect(ownerEdit.json().code).toBe('FORBIDDEN');
    void admin;
  });

  it('rejects edits after the 24h window and on tombstoned messages', async () => {
    const owner = await signup(`edtw_${suffix()}`);
    const circleId = await formCircle(owner.token, []);
    const list = await app.inject({ method: 'GET', url: '/v1/conversations', headers: bearer(owner.token) });
    const conv = (list.json() as { conversations: Array<{ id: string; circleId: string | null }> }).conversations.find((c) => c.circleId === circleId)!;
    const sent = await send(owner.token, conv.id, { body: 'old' });
    const messageId = (sent.body.message as { id: string }).id;

    await client.query(`UPDATE messages SET created_at = now() - interval '25 hours' WHERE id = $1`, [messageId]);
    const late = await app.inject({
      method: 'PATCH',
      url: `/v1/messages/${messageId}`,
      headers: bearer(owner.token),
      payload: { body: 'too late' },
    });
    expect(late.statusCode).toBe(409);
    expect(late.json().code).toBe('EDIT_WINDOW_EXPIRED');

    // Tombstone then attempt edit.
    await app.inject({ method: 'DELETE', url: `/v1/messages/${messageId}`, headers: bearer(owner.token) });
    const tombstoned = await app.inject({
      method: 'PATCH',
      url: `/v1/messages/${messageId}`,
      headers: bearer(owner.token),
      payload: { body: 'zombie' },
    });
    expect(tombstoned.statusCode).toBe(404);
  });
});

describe('delete/tombstone (sender + circle admin, docs/API.md D3)', () => {
  it('sender deletes own message; body is never exposed again', async () => {
    const owner = await signup(`del_${suffix()}`);
    const circleId = await formCircle(owner.token, []);
    const list = await app.inject({ method: 'GET', url: '/v1/conversations', headers: bearer(owner.token) });
    const conv = (list.json() as { conversations: Array<{ id: string; circleId: string | null }> }).conversations.find((c) => c.circleId === circleId)!;
    const sent = await send(owner.token, conv.id, { body: 'vanish me' });
    const messageId = (sent.body.message as { id: string }).id;

    const deleted = await app.inject({ method: 'DELETE', url: `/v1/messages/${messageId}`, headers: bearer(owner.token) });
    expect(deleted.statusCode).toBe(200);
    const message = deleted.json().message as { deleted: boolean; body: string | null };
    expect(message.deleted).toBe(true);
    expect(message.body).toBeNull();

    const row = await client.query<{ deleted_at: Date | null; body: string | null }>(
      `SELECT deleted_at, body FROM messages WHERE id = $1`,
      [messageId],
    );
    expect(row.rows[0]!.deleted_at).not.toBeNull(); // tombstone, not physical delete
    expect(row.rows[0]!.body).toBeNull();
  });

  it('circle admin can delete a member message; direct non-sender cannot', async () => {
    const owner = await signup(`dla_${suffix()}`);
    const member = await signup(`dlm_${suffix()}`);
    const partner = await signup(`dlp_${suffix()}`);
    const circleId = await formCircle(owner.token, [member]);
    const list = await app.inject({ method: 'GET', url: '/v1/conversations', headers: bearer(member.token) });
    const conv = (list.json() as { conversations: Array<{ id: string; circleId: string | null }> }).conversations.find((c) => c.circleId === circleId)!;
    const sent = await send(member.token, conv.id, { body: 'member voice' });
    const messageId = (sent.body.message as { id: string }).id;

    // Circle owner (admin tier) deletes the member's message.
    const adminDelete = await app.inject({ method: 'DELETE', url: `/v1/messages/${messageId}`, headers: bearer(owner.token) });
    expect(adminDelete.statusCode).toBe(200);
    expect((adminDelete.json().message as { deleted: boolean }).deleted).toBe(true);

    // Direct: partner cannot delete the sender's message.
    await formCircle(member.token, [partner]);
    const partnerName = (await client.query<{ username: string }>(`SELECT username FROM users WHERE id = $1`, [partner.userId])).rows[0]!.username;
    const direct = await createDirect(member.token, partnerName);
    const directConv = (direct.body.conversationId as string);
    const directMsg = await send(member.token, directConv, { body: 'private note' });
    const directMessageId = (directMsg.body.message as { id: string }).id;
    const partnerDelete = await app.inject({ method: 'DELETE', url: `/v1/messages/${directMessageId}`, headers: bearer(partner.token) });
    expect(partnerDelete.statusCode).toBe(403);
    expect(partnerDelete.json().code).toBe('FORBIDDEN');
  });
});

describe('reactions (docs/DATABASE.md §1.8, design.md §15)', () => {
  async function setupMessage() {
    const owner = await signup(`rct_${suffix()}`);
    const outsider = await signup(`rcto_${suffix()}`);
    const circleId = await formCircle(owner.token, []);
    const list = await app.inject({ method: 'GET', url: '/v1/conversations', headers: bearer(owner.token) });
    const conv = (list.json() as { conversations: Array<{ id: string; circleId: string | null }> }).conversations.find((c) => c.circleId === circleId)!;
    const sent = await send(owner.token, conv.id, { body: 'react to me' });
    return { owner, outsider, conversationId: conv.id, messageId: (sent.body.message as { id: string }).id };
  }

  it('adds, deduplicates and removes reactions from the allowed set', async () => {
    const { owner, conversationId, messageId } = await setupMessage();

    const add = await app.inject({
      method: 'PUT',
      url: `/v1/messages/${messageId}/reactions`,
      headers: bearer(owner.token),
      payload: { emoji: '❤️' },
    });
    expect(add.statusCode).toBe(200);
    let reactions = (add.json().message as { reactions: Array<{ emoji: string }> }).reactions;
    expect(reactions).toHaveLength(1);

    // Duplicate add is idempotent — still one row.
    await app.inject({
      method: 'PUT',
      url: `/v1/messages/${messageId}/reactions`,
      headers: bearer(owner.token),
      payload: { emoji: '❤️' },
    });
    const reread = await app.inject({
      method: 'GET',
      url: `/v1/conversations/${conversationId}/messages?limit=1`,
      headers: bearer(owner.token),
    });
    reactions = (reread.json().messages[0] as { reactions: Array<{ emoji: string }> }).reactions;
    expect(reactions).toHaveLength(1);

    const remove = await app.inject({
      method: 'DELETE',
      url: `/v1/messages/${messageId}/reactions/${encodeURIComponent('❤️')}`,
      headers: bearer(owner.token),
    });
    expect(remove.statusCode).toBe(200);
    reactions = (remove.json().message as { reactions: Array<{ emoji: string }> }).reactions;
    expect(reactions).toHaveLength(0);
  });

  it('rejects invalid emoji and unauthorized reactors', async () => {
    const { outsider, messageId } = await setupMessage();

    const invalid = await app.inject({
      method: 'PUT',
      url: `/v1/messages/${messageId}/reactions`,
      headers: bearer(outsider.token),
      payload: { emoji: '🤠' },
    });
    expect(invalid.statusCode).toBe(400);

    const unauthorized = await app.inject({
      method: 'PUT',
      url: `/v1/messages/${messageId}/reactions`,
      headers: bearer(outsider.token),
      payload: { emoji: '🔥' },
    });
    expect(unauthorized.statusCode).toBe(404); // existence hidden
  });
});

describe('read state + unread counts (docs/API.md)', () => {
  it('tracks read pointers and computes unread server-side', async () => {
    const owner = await signup(`rd_${suffix()}`);
    const member = await signup(`rdm_${suffix()}`);
    const circleId = await formCircle(owner.token, [member]);
    const listM = await app.inject({ method: 'GET', url: '/v1/conversations', headers: bearer(member.token) });
    const conv = (listM.json() as { conversations: Array<{ id: string; circleId: string | null }> }).conversations.find((c) => c.circleId === circleId)!;

    // Owner sends 3 messages; member has 3 unread.
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await send(owner.token, conv.id, { body: `n${i}` });
      ids.push((res.body.message as { id: string }).id);
    }

    let listRow = (await app.inject({ method: 'GET', url: '/v1/conversations', headers: bearer(member.token) }))
      .json().conversations.find((c: { id: string }) => c.id === conv.id);
    expect(listRow.unreadCount).toBe(3);

    // Member reads the second message.
    const read = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${conv.id}/read`,
      headers: bearer(member.token),
      payload: { lastReadMessageId: ids[1] },
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().unreadCount).toBe(1);

    listRow = (await app.inject({ method: 'GET', url: '/v1/conversations', headers: bearer(member.token) }))
      .json().conversations.find((c: { id: string }) => c.id === conv.id);
    expect(listRow.unreadCount).toBe(1);

    // Stale pointer (older message) never regresses the read marker.
    const stale = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${conv.id}/read`,
      headers: bearer(member.token),
      payload: { lastReadMessageId: ids[0] },
    });
    expect(stale.json().unreadCount).toBe(1);
  });

  it('rejects read pointers from other conversations and non-members', async () => {
    const owner = await signup(`rdx_${suffix()}`);
    const circleA = await formCircle(owner.token, []);
    const circleB = await formCircle(owner.token, []);
    const list = await app.inject({ method: 'GET', url: '/v1/conversations', headers: bearer(owner.token) });
    const conversations = (list.json() as { conversations: Array<{ id: string; circleId: string | null }> }).conversations;
    const convA = conversations.find((c) => c.circleId === circleA)!.id;
    const convB = conversations.find((c) => c.circleId === circleB)!.id;

    const msg = await send(owner.token, convB, { body: 'belong elsewhere' });
    const messageId = (msg.body.message as { id: string }).id;

    const mismatch = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${convA}/read`,
      headers: bearer(owner.token),
      payload: { lastReadMessageId: messageId },
    });
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.json().code).toBe('INVALID_READ_POINTER');

    const outsider = await signup(`rdxo_${suffix()}`);
    const denied = await app.inject({
      method: 'POST',
      url: `/v1/conversations/${convA}/read`,
      headers: bearer(outsider.token),
      payload: { lastReadMessageId: messageId },
    });
    expect(denied.statusCode).toBe(404);
  });
});

describe('notification prefs (docs/API.md, docs/DATABASE.md §1.11)', () => {
  it('updates only the caller preference with upsert semantics', async () => {
    const owner = await signup(`pref_${suffix()}`);
    const member = await signup(`prefm_${suffix()}`);
    const circleId = await formCircle(owner.token, [member]);
    const list = await app.inject({ method: 'GET', url: '/v1/conversations', headers: bearer(member.token) });
    const conv = (list.json() as { conversations: Array<{ id: string; circleId: string | null }> }).conversations.find((c) => c.circleId === circleId)!;

    const patch = await app.inject({
      method: 'PATCH',
      url: `/v1/conversations/${conv.id}/notification-pref`,
      headers: bearer(member.token),
      payload: { muted: true, preview: false },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().pref).toEqual({ enabled: true, muted: true, mentions: true, preview: false });

    // Owner's pref is untouched.
    const ownerRows = await client.query<{ count: number }>(
      `SELECT count(*)::int FROM conversation_notification_prefs WHERE conversation_id = $1 AND user_id = $2`,
      [conv.id, owner.userId],
    );
    expect(ownerRows.rows[0]!.count).toBe(0);

    // Upsert: second patch merges.
    const second = await app.inject({
      method: 'PATCH',
      url: `/v1/conversations/${conv.id}/notification-pref`,
      headers: bearer(member.token),
      payload: { enabled: false },
    });
    expect(second.json().pref).toEqual({ enabled: false, muted: true, mentions: true, preview: false });

    const empty = await app.inject({
      method: 'PATCH',
      url: `/v1/conversations/${conv.id}/notification-pref`,
      headers: bearer(member.token),
      payload: {},
    });
    expect(empty.statusCode).toBe(400);
  });
});

describe('conversation list metadata (docs/API.md)', () => {
  it('lists circle + direct conversations with last message and ordering', async () => {
    const a = await signup(`lst_${suffix()}`);
    const b = await signup(`lstb_${suffix()}`);
    const circleId = await formCircle(a.token, [b]);
    const usernameB = (await client.query<{ username: string }>(`SELECT username FROM users WHERE id = $1`, [b.userId])).rows[0]!.username;
    const direct = await createDirect(a.token, usernameB);
    const directConvId = direct.body.conversationId as string;

    const listA = await app.inject({ method: 'GET', url: '/v1/conversations', headers: bearer(a.token) });
    const conversations = listA.json().conversations as Array<Record<string, unknown>>;
    const circleEntry = conversations.find((c) => c.circleId === circleId)!;
    const directEntry = conversations.find((c) => c.id === directConvId)!;

    expect(circleEntry.type).toBe('circle');
    expect(directEntry.type).toBe('direct');
    expect(directEntry.partnerUsername).toBe(usernameB);
    expect(circleEntry.unreadCount).toBe(0);
    expect(circleEntry.lastMessagePreview).toBeNull(); // no messages yet

    // Sending updates lastMessageAt/preview and ordering puts it first.
    await send(a.token, directConvId, { body: 'latest ping' });
    const listB = await app.inject({ method: 'GET', url: '/v1/conversations', headers: bearer(b.token) });
    const forB = (listB.json().conversations as Array<Record<string, unknown>>).find((c) => c.id === directConvId)!;
    expect(forB.lastMessagePreview).toBe('latest ping');
    expect(forB.unreadCount).toBe(1);

    // B's list: direct (just messaged) sorts before the circle conversation.
    const ordered = listB.json().conversations as Array<{ id: string; lastMessageAt: string | null }>;
    expect(ordered[0]!.id).toBe(directConvId);
  });

  it('rejects unauthenticated list access and revoked sessions', async () => {
    const anon = await app.inject({ method: 'GET', url: '/v1/conversations' });
    expect(anon.statusCode).toBe(401);

    const user = await signup(`rev_${suffix()}`);
    await client.query(`UPDATE sessions SET revoked_at = now() WHERE user_id = $1`, [user.userId]);
    const revoked = await app.inject({ method: 'GET', url: '/v1/conversations', headers: bearer(user.token) });
    expect(revoked.statusCode).toBe(401);
  });
});
