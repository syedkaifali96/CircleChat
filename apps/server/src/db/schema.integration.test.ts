import { eq } from 'drizzle-orm';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from './index';
import { circles } from './schema';
import {
  migrateTestDatabase,
  resetTestDatabase,
  resolveTestDatabaseUrl,
  startEmbeddedPostgres,
} from './testing';

/**
 * M1 PostgreSQL integration tests — these run against a REAL PostgreSQL
 * (the CI service container via DATABASE_URL, or an ephemeral embedded
 * instance locally) and exercise actual constraint/trigger behavior from
 * docs/DATABASE.md, not Drizzle object shapes.
 */

let client: Client;
let stopEmbedded: (() => Promise<void>) | undefined;
let testDbUrl: string;

beforeAll(async () => {
  let url = resolveTestDatabaseUrl();
  if (!url) {
    const embedded = await startEmbeddedPostgres();
    stopEmbedded = embedded.stop;
    url = embedded.url;
  }
  testDbUrl = url;
  client = new Client({ connectionString: url });
  await client.connect();
  // Apply the real committed migrations (0000 schema + 0001 invariants).
  await migrateTestDatabase(client);
}, 300_000);

afterAll(async () => {
  await client?.end();
  await stopEmbedded?.();
});

beforeEach(async () => {
  await resetTestDatabase(client);
});

/* ------------------------------------------------------------- helpers */

async function insertUser(username: string): Promise<string> {
  const res = await client.query<{ id: string }>(
    `INSERT INTO users (username, display_name, password_hash, recovery_code_hash)
     VALUES ($1, $1, 'phc-test-password-hash', 'phc-test-recovery-hash') RETURNING id`,
    [username],
  );
  return res.rows[0]!.id;
}

async function insertCircle(name = 'Test Circle', ownerId?: string): Promise<{ id: string; ownerId: string }> {
  const owner = ownerId ?? (await insertUser(`owner_${Math.random().toString(36).slice(2, 10)}`));
  const res = await client.query<{ id: string }>(
    `INSERT INTO circles (name, created_by) VALUES ($1, $2) RETURNING id`,
    [name, owner],
  );
  // Service-layer creation pattern: the owner is the first member row.
  await client.query(
    `INSERT INTO circle_members (circle_id, user_id, role) VALUES ($1, $2, 'owner')`,
    [res.rows[0]!.id, owner],
  );
  return { id: res.rows[0]!.id, ownerId: owner };
}

async function addMember(circleId: string, userId: string, role = 'member'): Promise<void> {
  await client.query(
    `INSERT INTO circle_members (circle_id, user_id, role) VALUES ($1, $2, $3)`,
    [circleId, userId, role],
  );
}

async function insertCircleConversation(circleId: string): Promise<string> {
  const res = await client.query<{ id: string }>(
    `INSERT INTO conversations (type, circle_id) VALUES ('circle', $1) RETURNING id`,
    [circleId],
  );
  return res.rows[0]!.id;
}

async function insertDirectConversation(userA: string, userB: string): Promise<string> {
  const res = await client.query<{ id: string }>(
    `INSERT INTO conversations (type, direct_key) VALUES ('direct', $1) RETURNING id`,
    [`dm:${[userA, userB].sort().join(':')}`],
  );
  const conversationId = res.rows[0]!.id;
  await client.query(
    `INSERT INTO conversation_participants (conversation_id, user_id) VALUES ($1, $2), ($1, $3)`,
    [conversationId, userA, userB],
  );
  return conversationId;
}

async function insertMedia(ownerId: string, storageKey?: string): Promise<string> {
  const res = await client.query<{ id: string }>(
    `INSERT INTO media (owner_id, kind, mime_type, size_bytes, storage_key, status)
     VALUES ($1, 'image', 'image/png', 1024, $2, 'ready') RETURNING id`,
    [ownerId, storageKey ?? `media/${Math.random().toString(36).slice(2)}/img.png`],
  );
  return res.rows[0]!.id;
}

type PgError = { code?: string; message?: string };

async function expectPgError(fn: () => Promise<unknown>, pgCode: string, messagePart?: string): Promise<void> {
  let caught: PgError | undefined;
  try {
    await fn();
  } catch (err) {
    caught = err as PgError;
  }
  if (!caught) {
    throw new Error(`Expected query to fail with ${pgCode}, but it succeeded`);
  }
  expect(caught.code).toBe(pgCode);
  if (messagePart) {
    expect(caught.message).toContain(messagePart);
  }
}

const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';
const FOREIGN_KEY_VIOLATION = '23503';
const RAISE_EXCEPTION = 'P0001';

/* ---------------------------------------------------------------- tests */

describe('users (docs/DATABASE.md §1.1)', () => {
  it('enforces case-insensitive username uniqueness', async () => {
    await insertUser('kaif');
    // Documented storage format is lowercase-only, so uppercase variants are
    // rejected by the format CHECK before uniqueness is even evaluated.
    await expectPgError(() => insertUser('KAIF'), CHECK_VIOLATION);
    // The lower(username) unique index is defense in depth against any path
    // that could store an uppercase variant; plain duplicates collide on both.
    await expectPgError(() => insertUser('kaif'), UNIQUE_VIOLATION);
    await insertUser('kaif_alt'); // distinct username still fine
  });

  it('enforces the documented username format at the database level', async () => {
    await expectPgError(() => insertUser('Bad Name!'), CHECK_VIOLATION);
    await expectPgError(() => insertUser('ab'), CHECK_VIOLATION); // < 3 chars
    await expectPgError(() => insertUser('a'.repeat(21)), CHECK_VIOLATION); // > 20 chars
    await insertUser('ok_name_123'); // valid 3–20 [a-z0-9_]
  });

  it('applies documented defaults and NOT NULL requirements', async () => {
    const id = await insertUser('defaults_user');
    const res = await client.query(
      `SELECT notifications_enabled, notification_preview, created_at FROM users WHERE id = $1`,
      [id],
    );
    expect(res.rows[0]).toMatchObject({
      notifications_enabled: true,
      notification_preview: true,
    });
    expect(res.rows[0]!['created_at']).toBeInstanceOf(Date);
    await expectPgError(
      () =>
        client.query(
          `INSERT INTO users (display_name, password_hash, recovery_code_hash) VALUES ('x', 'h', 'h')`,
        ),
      '23502', // username is NOT NULL
    );
  }, 20_000);

  it('rejects display names outside 1–40 characters', async () => {
    const username = 'display_len';
    await expectPgError(
      () =>
        client.query(
          `INSERT INTO users (username, display_name, password_hash, recovery_code_hash) VALUES ($1, $2, 'h', 'h')`,
          [username, 'x'.repeat(41)],
        ),
      CHECK_VIOLATION,
    );
    await expectPgError(
      () =>
        client.query(
          `INSERT INTO users (username, display_name, password_hash, recovery_code_hash) VALUES ($1, '', 'h', 'h')`,
          [`${username}_2`],
        ),
      CHECK_VIOLATION,
    );
  });
});

describe('circles + circle_members: 5-member invariant (docs/DATABASE.md §1.2–1.3)', () => {
  it('maintains the denormalized members_count via trigger', async () => {
    const circle = await insertCircle();
    await addMember(circle.id, await insertUser('member_a'));
    const res = await client.query<{ members_count: number }>(
      `SELECT members_count FROM circles WHERE id = $1`,
      [circle.id],
    );
    expect(res.rows[0]!.members_count).toBe(2);
  });

  it('rejects a sixth member with CIRCLE_FULL and keeps state consistent', async () => {
    const circle = await insertCircle();
    for (let i = 0; i < 4; i++) {
      await addMember(circle.id, await insertUser(`member_${i}`));
    }
    const sixth = await insertUser('member_six');
    await expectPgError(() => addMember(circle.id, sixth), RAISE_EXCEPTION, 'CIRCLE_FULL');

    const res = await client.query<{ members_count: number; actual: number }>(
      `SELECT c.members_count, (SELECT count(*)::int FROM circle_members m WHERE m.circle_id = c.id) AS actual
       FROM circles c WHERE c.id = $1`,
      [circle.id],
    );
    expect(res.rows[0]).toEqual({ members_count: 5, actual: 5 });
  });

  it('enforces CHECK (members_count <= 5) declaratively', async () => {
    const circle = await insertCircle();
    await expectPgError(
      () => client.query(`UPDATE circles SET members_count = 6 WHERE id = $1`, [circle.id]),
      CHECK_VIOLATION,
    );
  });

  it('prevents duplicate membership via composite primary key', async () => {
    const circle = await insertCircle();
    const member = await insertUser('dup_member');
    await addMember(circle.id, member);
    await expectPgError(() => addMember(circle.id, member), UNIQUE_VIOLATION);
  });

  it('restricts roles to owner/admin/member', async () => {
    const circle = await insertCircle();
    const user = await insertUser('role_check');
    await expectPgError(() => addMember(circle.id, user, 'moderator'), CHECK_VIOLATION);
  });

  it('enforces exactly one owner per circle (partial unique index)', async () => {
    const circle = await insertCircle();
    const second = await insertUser('second_owner');
    await expectPgError(() => addMember(circle.id, second, 'owner'), UNIQUE_VIOLATION);
  });

  it('supports atomic ownership transfer (demote + promote in one transaction)', async () => {
    const circle = await insertCircle();
    const next = await insertUser('next_owner');
    await addMember(circle.id, next);
    // Documented M4 pattern (docs/DATABASE.md section 3): lock the circle,
    // demote the old owner, promote the target - one transaction, never two
    // simultaneous owners, no outside observer sees the intermediate state.
    await client.query('BEGIN');
    try {
      await client.query(`SELECT id FROM circles WHERE id = $1 FOR UPDATE`, [circle.id]);
      await client.query(
        `UPDATE circle_members SET role = 'member' WHERE circle_id = $1 AND user_id = $2`,
        [circle.id, circle.ownerId],
      );
      await client.query(
        `UPDATE circle_members SET role = 'owner' WHERE circle_id = $1 AND user_id = $2`,
        [circle.id, next],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
    const owners = await client.query<{ username: string }>(
      `SELECT u.username FROM circle_members m JOIN users u ON u.id = m.user_id
       WHERE m.circle_id = $1 AND m.role = 'owner'`,
      [circle.id],
    );
    expect(owners.rows).toHaveLength(1);
    expect(owners.rows[0]!.username).toBe('next_owner');
  });

  it('cascades membership removal on user deletion and updates the counter', async () => {
    const circle = await insertCircle();
    const temp = await insertUser('leaving_member');
    await addMember(circle.id, temp);
    await client.query(`DELETE FROM users WHERE id = $1`, [temp]);
    const res = await client.query<{ members_count: number; actual: number }>(
      `SELECT c.members_count, (SELECT count(*)::int FROM circle_members m WHERE m.circle_id = c.id) AS actual
       FROM circles c WHERE c.id = $1`,
      [circle.id],
    );
    expect(res.rows[0]).toEqual({ members_count: 1, actual: 1 });
  });

  it('rejects membership rows referencing missing users/circles (FK)', async () => {
    const circle = await insertCircle();
    await expectPgError(
      () =>
        client.query(
          `INSERT INTO circle_members (circle_id, user_id, role) VALUES ($1, gen_random_uuid(), 'member')`,
          [circle.id],
        ),
      FOREIGN_KEY_VIOLATION,
    );
    await expectPgError(
      () =>
        client.query(
          `INSERT INTO circle_members (circle_id, user_id, role) VALUES (gen_random_uuid(), gen_random_uuid(), 'member')`,
        ),
      FOREIGN_KEY_VIOLATION,
    );
  });
});

describe('conversations + participants (docs/DATABASE.md §1.5–1.6)', () => {
  it('allows one conversation per circle and enforces the type/shape CHECK', async () => {
    const circle = await insertCircle();
    await insertCircleConversation(circle.id);
    await expectPgError(() => insertCircleConversation(circle.id), UNIQUE_VIOLATION);

    // direct must not carry a circle_id; circle must not carry a direct_key
    await expectPgError(
      () =>
        client.query(
          `INSERT INTO conversations (type, direct_key, circle_id) VALUES ('direct', 'k1', gen_random_uuid())`,
        ),
      CHECK_VIOLATION,
    );
    await expectPgError(
      () => client.query(`INSERT INTO conversations (type) VALUES ('circle')`),
      CHECK_VIOLATION,
    );
    await expectPgError(
      () =>
        client.query(
          `INSERT INTO conversations (type, circle_id, direct_key) VALUES ('circle', $1, 'leak')`,
          [circle.id],
        ),
      CHECK_VIOLATION,
    );
  });

  it('keeps direct_key unique as a duplicate-prevention helper only', async () => {
    const a = await insertUser('dm_a');
    const b = await insertUser('dm_b');
    const c = await insertUser('dm_c');
    await insertDirectConversation(a, b);
    // Same pair via a different user pair path: direct_key collision rejected…
    await expectPgError(
      () =>
        client.query(
          `INSERT INTO conversations (type, direct_key) VALUES ('direct', $1)`,
          [`dm:${[a, b].sort().join(':')}`],
        ),
      UNIQUE_VIOLATION,
    );
    // …while a different pair gets its own conversation.
    await insertDirectConversation(a, c);
  });

  it('caps direct conversations at exactly two participants', async () => {
    const a = await insertUser('p_a');
    const b = await insertUser('p_b');
    const c = await insertUser('p_c');
    const conversationId = await insertDirectConversation(a, b);
    await expectPgError(
      () =>
        client.query(
          `INSERT INTO conversation_participants (conversation_id, user_id) VALUES ($1, $2)`,
          [conversationId, c],
        ),
      RAISE_EXCEPTION,
      'DIRECT_PARTICIPANT_LIMIT',
    );
  });

  it('prevents removing a participant from a live direct conversation', async () => {
    const a = await insertUser('p_d');
    const b = await insertUser('p_e');
    const conversationId = await insertDirectConversation(a, b);
    await expectPgError(
      () =>
        client.query(
          `DELETE FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2`,
          [conversationId, a],
        ),
      RAISE_EXCEPTION,
      'DIRECT_PARTICIPANT_MINIMUM',
    );
  });

  it('allows the conversation cascade to remove participants without breaking', async () => {
    const a = await insertUser('p_f');
    const b = await insertUser('p_g');
    const conversationId = await insertDirectConversation(a, b);
    await client.query(`DELETE FROM conversations WHERE id = $1`, [conversationId]);
    const res = await client.query<{ count: string }>(
      `SELECT count(*)::int FROM conversation_participants WHERE conversation_id = $1`,
      [conversationId],
    );
    expect(res.rows[0]!.count).toBe(0);
  });

  it('authorizes direct chats through conversation_participants rows', async () => {
    const a = await insertUser('p_h');
    const b = await insertUser('p_i');
    const conversationId = await insertDirectConversation(a, b);
    const res = await client.query<{ user_id: string }>(
      `SELECT user_id FROM conversation_participants WHERE conversation_id = $1 ORDER BY user_id`,
      [conversationId],
    );
    expect(res.rows.map((r) => r.user_id).sort()).toEqual([a, b].sort());
  });
});

describe('messages: idempotency + integrity (docs/DATABASE.md §1.7)', () => {
  let circleId: string;
  let conversationId: string;
  let sender: string;
  let otherSender: string;
  let mediaId: string;

  beforeEach(async () => {
    const circle = await insertCircle();
    circleId = circle.id;
    conversationId = await insertCircleConversation(circleId);
    sender = await insertUser('msg_sender');
    otherSender = await insertUser('msg_sender_2');
    await addMember(circleId, sender);
    await addMember(circleId, otherSender);
    mediaId = await insertMedia(sender);
  });

  it('makes client retries idempotent via (conversation, sender, client_message_id)', async () => {
    await client.query(
      `INSERT INTO messages (conversation_id, sender_id, client_message_id, type, body)
       VALUES ($1, $2, 'client-1', 'text', 'hello')`,
      [conversationId, sender],
    );
    // Same key from the same sender → retry, not a new message.
    await expectPgError(
      () =>
        client.query(
          `INSERT INTO messages (conversation_id, sender_id, client_message_id, type, body)
           VALUES ($1, $2, 'client-1', 'text', 'hello again')`,
          [conversationId, sender],
        ),
      UNIQUE_VIOLATION,
    );
    // Same client key from a different sender is a different message.
    await client.query(
      `INSERT INTO messages (conversation_id, sender_id, client_message_id, type, body)
       VALUES ($1, $2, 'client-1', 'text', 'hi')`,
      [conversationId, otherSender],
    );
  });

  it('enforces the media/type pairing and body length CHECKs', async () => {
    await expectPgError(
      () =>
        client.query(
          `INSERT INTO messages (conversation_id, sender_id, client_message_id, type)
           VALUES ($1, $2, 'm1', 'image')`,
          [conversationId, sender],
        ),
      CHECK_VIOLATION,
    ); // media type without media_id
    await expectPgError(
      () =>
        client.query(
          `INSERT INTO messages (conversation_id, sender_id, client_message_id, type, body, media_id)
           VALUES ($1, $2, 'm2', 'text', 'oops', $3)`,
          [conversationId, sender, mediaId],
        ),
      CHECK_VIOLATION,
    ); // text with media
    await expectPgError(
      () =>
        client.query(
          `INSERT INTO messages (conversation_id, sender_id, client_message_id, type, body)
           VALUES ($1, $2, 'm3', 'text', $3)`,
          [conversationId, sender, 'x'.repeat(4001)],
        ),
      CHECK_VIOLATION,
    );
    // Valid image message with attached media:
    await client.query(
      `INSERT INTO messages (conversation_id, sender_id, client_message_id, type, media_id)
       VALUES ($1, $2, 'm4', 'image', $3)`,
      [conversationId, sender, mediaId],
    );
  });

  it('uses ON DELETE SET NULL for replies and CASCADE for conversation deletion', async () => {
    const first = await client.query<{ id: string }>(
      `INSERT INTO messages (conversation_id, sender_id, client_message_id, type, body)
       VALUES ($1, $2, 'r1', 'text', 'root') RETURNING id`,
      [conversationId, sender],
    );
    const rootId = first.rows[0]!.id;
    const reply = await client.query<{ id: string }>(
      `INSERT INTO messages (conversation_id, sender_id, client_message_id, type, body, reply_to_id)
       VALUES ($1, $2, 'r2', 'text', 'reply', $3) RETURNING id`,
      [conversationId, otherSender, rootId],
    );
    await client.query(`DELETE FROM messages WHERE id = $1`, [rootId]);
    const after = await client.query<{ reply_to_id: string | null }>(
      `SELECT reply_to_id FROM messages WHERE id = $1`,
      [reply.rows[0]!.id],
    );
    expect(after.rows[0]!.reply_to_id).toBeNull();

    // Conversation deletion cascades to messages.
    await client.query(`DELETE FROM conversations WHERE id = $1`, [conversationId]);
    const remaining = await client.query<{ count: string }>(
      `SELECT count(*)::int FROM messages WHERE conversation_id = $1`,
      [conversationId],
    );
    expect(remaining.rows[0]!.count).toBe(0);
  });

  it('supports the transactional rollback pattern for capacity-guarded writes', async () => {
    // Simulates the M4 conditional-join service pattern: a failed guarded write
    // inside a transaction must leave no partial state behind.
    await client.query('BEGIN');
    try {
      await client.query(`UPDATE circles SET members_count = 5 WHERE id = $1`, [circleId]);
      throw new Error('rollback-now');
    } catch {
      await client.query('ROLLBACK');
    }
    const res = await client.query<{ members_count: number }>(
      `SELECT members_count FROM circles WHERE id = $1`,
      [circleId],
    );
    expect(res.rows[0]!.members_count).toBe(3); // owner + 2 members, unchanged by rollback
  });
});

describe('message_reactions (docs/DATABASE.md §1.8)', () => {
  it('allows multiple distinct emoji per user but never the same one twice', async () => {
    const circle = await insertCircle();
    const conversationId = await insertCircleConversation(circle.id);
    const user = await insertUser('reactor');
    const messageId = (
      await client.query<{ id: string }>(
        `INSERT INTO messages (conversation_id, sender_id, client_message_id, type, body)
         VALUES ($1, $2, 'rc1', 'text', 'hi') RETURNING id`,
        [conversationId, user],
      )
    ).rows[0]!.id;

    await client.query(
      `INSERT INTO message_reactions (message_id, user_id, emoji) VALUES ($1, $2, '🔥')`,
      [messageId, user],
    );
    await client.query(
      `INSERT INTO message_reactions (message_id, user_id, emoji) VALUES ($1, $2, '❤️')`,
      [messageId, user],
    );
    await expectPgError(
      () =>
        client.query(
          `INSERT INTO message_reactions (message_id, user_id, emoji) VALUES ($1, $2, '🔥')`,
          [messageId, user],
        ),
      UNIQUE_VIOLATION,
    );
  });
});

describe('media (docs/DATABASE.md §1.9)', () => {
  it('enforces kind/status CHECKs, positive size and unique storage keys', async () => {
    const owner = await insertUser('media_owner');
    const key = `media/${Math.random().toString(36).slice(2)}/v.mp4`;
    await expectPgError(
      () =>
        client.query(
          `INSERT INTO media (owner_id, kind, mime_type, size_bytes, storage_key, status)
           VALUES ($1, 'hologram', 'video/mp4', 10, $2, 'ready')`,
          [owner, key],
        ),
      CHECK_VIOLATION,
    );
    await expectPgError(
      () =>
        client.query(
          `INSERT INTO media (owner_id, kind, mime_type, size_bytes, storage_key, status)
           VALUES ($1, 'video', 'video/mp4', 0, $2, 'ready')`,
          [owner, key],
        ),
      CHECK_VIOLATION,
    );
    await expectPgError(
      () =>
        client.query(
          `INSERT INTO media (owner_id, kind, mime_type, size_bytes, storage_key, status)
           VALUES ($1, 'video', 'video/mp4', 10, $2, 'vibing')`,
          [owner, key],
        ),
      CHECK_VIOLATION,
    );
    await insertMedia(owner, key);
    await expectPgError(() => insertMedia(owner, key), UNIQUE_VIOLATION);
  });

  it('clears avatar references when the media row is deleted (avatar FK)', async () => {
    const user = await insertUser('avatar_user');
    const mediaId = await insertMedia(user);
    await client.query(`UPDATE users SET avatar_media_id = $1 WHERE id = $2`, [mediaId, user]);
    await client.query(`DELETE FROM media WHERE id = $1`, [mediaId]);
    const res = await client.query<{ avatar_media_id: string | null }>(
      `SELECT avatar_media_id FROM users WHERE id = $1`,
      [user],
    );
    expect(res.rows[0]!.avatar_media_id).toBeNull();
  });
});

describe('sessions (docs/DATABASE.md §1.10)', () => {
  it('enforces unique token hashes, platform CHECK and user cascade', async () => {
    const user = await insertUser('session_user');
    const insert = (hash: string, platform = 'android') =>
      client.query(
        `INSERT INTO sessions (user_id, token_hash, device_name, platform, expires_at)
         VALUES ($1, $2, 'Test Phone', $3, now() + interval '30 days')`,
        [user, hash, platform],
      );
    await insert('hash-aaa');
    await expectPgError(() => insert('hash-aaa'), UNIQUE_VIOLATION);
    await expectPgError(() => insert('hash-bbb', 'symbian'), CHECK_VIOLATION);
    await insert('hash-ccc', 'ios');

    await client.query(`DELETE FROM users WHERE id = $1`, [user]);
    const remaining = await client.query<{ count: string }>(
      `SELECT count(*)::int FROM sessions WHERE user_id = $1`,
      [user],
    );
    expect(remaining.rows[0]!.count).toBe(0);
  });
});

describe('polls + votes (docs/DATABASE.md §1.13–1.14)', () => {
  it('rejects polls on direct conversations (trigger)', async () => {
    const a = await insertUser('poll_dm_a');
    const b = await insertUser('poll_dm_b');
    const directId = await insertDirectConversation(a, b);
    await expectPgError(
      () =>
        client.query(
          `INSERT INTO polls (conversation_id, created_by, question, options)
           VALUES ($1, $2, 'Direct poll?', $3::jsonb)`,
          [directId, a, JSON.stringify(['yes', 'no'])],
        ),
      RAISE_EXCEPTION,
      'POLLS_CIRCLE_ONLY',
    );
  });

  it('enforces the 2–6 options CHECK', async () => {
    const circle = await insertCircle();
    const conversationId = await insertCircleConversation(circle.id);
    const owner = circle.ownerId;
    await expectPgError(
      () =>
        client.query(
          `INSERT INTO polls (conversation_id, created_by, question, options)
           VALUES ($1, $2, 'One option?', $3::jsonb)`,
          [conversationId, owner, JSON.stringify(['only'])],
        ),
      CHECK_VIOLATION,
    );
    await expectPgError(
      () =>
        client.query(
          `INSERT INTO polls (conversation_id, created_by, question, options)
           VALUES ($1, $2, 'Seven?', $3::jsonb)`,
          [conversationId, owner, JSON.stringify(['1', '2', '3', '4', '5', '6', '7'])],
        ),
      CHECK_VIOLATION,
    );
  });

  it('guarantees one vote per user and validates the option index against the poll', async () => {
    const circle = await insertCircle();
    const conversationId = await insertCircleConversation(circle.id);
    const voter = circle.ownerId;
    const pollId = (
      await client.query<{ id: string }>(
        `INSERT INTO polls (conversation_id, created_by, question, options)
         VALUES ($1, $2, 'Where?', $3::jsonb) RETURNING id`,
        [conversationId, voter, JSON.stringify(['beach', 'cinema'])],
      )
    ).rows[0]!.id;

    await client.query(
      `INSERT INTO poll_votes (poll_id, user_id, option_index) VALUES ($1, $2, 1)`,
      [pollId, voter],
    );
    await expectPgError(
      () =>
        client.query(
          `INSERT INTO poll_votes (poll_id, user_id, option_index) VALUES ($1, $2, 0)`,
          [pollId, voter],
        ),
      UNIQUE_VIOLATION,
    ); // one vote per user
    await expectPgError(
      () =>
        client.query(
          `INSERT INTO poll_votes (poll_id, user_id, option_index) VALUES ($1, gen_random_uuid(), 2)`,
          [pollId],
        ),
      RAISE_EXCEPTION,
      'POLL_OPTION_INVALID',
    ); // trigger: beyond the 2-option array
    await expectPgError(
      () =>
        client.query(
          `INSERT INTO poll_votes (poll_id, user_id, option_index) VALUES ($1, gen_random_uuid(), -1)`,
          [pollId],
        ),
      CHECK_VIOLATION,
    ); // negative index passes the trigger, fails the 0..5 CHECK
  });

  it('blocks options updates that would invalidate existing votes', async () => {
    const circle = await insertCircle();
    const conversationId = await insertCircleConversation(circle.id);
    const pollId = (
      await client.query<{ id: string }>(
        `INSERT INTO polls (conversation_id, created_by, question, options)
         VALUES ($1, $2, 'Where?', $3::jsonb) RETURNING id`,
        [conversationId, circle.ownerId, JSON.stringify(['beach', 'cinema', 'park'])],
      )
    ).rows[0]!.id;
    await client.query(
      `INSERT INTO poll_votes (poll_id, user_id, option_index) VALUES ($1, $2, 2)`,
      [pollId, circle.ownerId],
    );

    // Shrinking options would leave the index-2 vote pointing past the array.
    await expectPgError(
      () =>
        client.query(
          `UPDATE polls SET options = $2::jsonb WHERE id = $1`,
          [pollId, JSON.stringify(['beach', 'cinema'])],
        ),
      RAISE_EXCEPTION,
      'POLL_OPTIONS_INVALIDATE_VOTES',
    );
    const unchanged = await client.query<{ options: string[] }>(
      `SELECT options FROM polls WHERE id = $1`,
      [pollId],
    );
    expect(unchanged.rows[0]!.options).toEqual(['beach', 'cinema', 'park']);

    // Options updates that keep every existing vote valid remain allowed.
    await client.query(
      `UPDATE polls SET options = $2::jsonb WHERE id = $1`,
      [pollId, JSON.stringify(['beach', 'cinema', 'museum'])],
    );
    // question / closes_at updates are unaffected by the guard.
    await client.query(
      `UPDATE polls SET question = $2, closes_at = now() + interval '2 days' WHERE id = $1`,
      [pollId, 'Where to go?'],
    );
  });

  it('allows shrinking options while no votes exist', async () => {
    const circle = await insertCircle();
    const conversationId = await insertCircleConversation(circle.id);
    const pollId = (
      await client.query<{ id: string }>(
        `INSERT INTO polls (conversation_id, created_by, question, options)
         VALUES ($1, $2, 'Flexible?', $3::jsonb) RETURNING id`,
        [conversationId, circle.ownerId, JSON.stringify(['a', 'b', 'c'])],
      )
    ).rows[0]!.id;
    await client.query(
      `UPDATE polls SET options = $2::jsonb WHERE id = $1`,
      [pollId, JSON.stringify(['a', 'b'])],
    );
    const res = await client.query<{ options: string[] }>(
      `SELECT options FROM polls WHERE id = $1`,
      [pollId],
    );
    expect(res.rows[0]!.options).toEqual(['a', 'b']);
  });
});

describe('pinboard, notifications, prefs (docs/DATABASE.md §1.11–1.12, §1.15)', () => {
  it('cascades pinboard items with the circle and bounds content length', async () => {
    const circle = await insertCircle();
    await client.query(
      `INSERT INTO pinboard_items (circle_id, created_by, content) VALUES ($1, $2, 'trip plan')`,
      [circle.id, circle.ownerId],
    );
    await expectPgError(
      () =>
        client.query(
          `INSERT INTO pinboard_items (circle_id, created_by, content) VALUES ($1, $2, $3)`,
          [circle.id, circle.ownerId, 'x'.repeat(1001)],
        ),
      CHECK_VIOLATION,
    );
    await client.query(`DELETE FROM circles WHERE id = $1`, [circle.id]);
    const remaining = await client.query<{ count: string }>(
      `SELECT count(*)::int FROM pinboard_items WHERE circle_id = $1`,
      [circle.id],
    );
    expect(remaining.rows[0]!.count).toBe(0);
  });

  it('keeps one notification preference per user per conversation with defaults', async () => {
    const circle = await insertCircle();
    const conversationId = await insertCircleConversation(circle.id);
    const user = circle.ownerId;
    await client.query(
      `INSERT INTO conversation_notification_prefs (conversation_id, user_id, muted) VALUES ($1, $2, true)`,
      [conversationId, user],
    );
    await expectPgError(
      () =>
        client.query(
          `INSERT INTO conversation_notification_prefs (conversation_id, user_id) VALUES ($1, $2)`,
          [conversationId, user],
        ),
      UNIQUE_VIOLATION,
    );
    const res = await client.query(
      `SELECT enabled, muted, mentions, preview FROM conversation_notification_prefs
       WHERE conversation_id = $1 AND user_id = $2`,
      [conversationId, user],
    );
    expect(res.rows[0]).toEqual({ enabled: true, muted: true, mentions: true, preview: true });
  });

  it('cascades notifications from users and circles', async () => {
    const circle = await insertCircle();
    const user = circle.ownerId;
    await client.query(
      `INSERT INTO notifications (user_id, type, actor_id, circle_id, payload) VALUES ($1, 'poll_created', $1, $2, $3::jsonb)`,
      [user, circle.id, JSON.stringify({ question: 'Where?' })],
    );
    await client.query(`DELETE FROM circles WHERE id = $1`, [circle.id]);
    const remaining = await client.query<{ count: string }>(
      `SELECT count(*)::int FROM notifications WHERE circle_id = $1`,
      [circle.id],
    );
    expect(remaining.rows[0]!.count).toBe(0);
  });
});

describe('migration integrity', () => {
  it('has all critical invariants backed by real database indexes', async () => {
    const required = [
      'users_username_lower_uq',
      'circle_members_one_owner_uq',
      'circles_invite_code_hash_uq',
      'conversations_circle_id_uq',
      'conversations_direct_key_uq',
      'messages_sender_client_message_uq',
      'messages_history_idx',
      'messages_latest_idx',
      'notifications_unread_idx',
      'media_owner_status_idx',
      'sessions_user_id_idx',
    ];
    const res = await client.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`,
    );
    const present = new Set(res.rows.map((r) => r.indexname));
    for (const name of required) {
      expect(present.has(name), `missing index: ${name}`).toBe(true);
    }
  });

  it('prevents raw invite codes: only a hash column exists on circles', async () => {
    const res = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'circles'`,
    );
    const columns = res.rows.map((r) => r.column_name);
    expect(columns).toContain('invite_code_hash');
    expect(columns).not.toContain('invite_code');
    expect(columns).not.toContain('invite_code_encrypted');
  });
});

describe('drizzle runtime schema wiring (relations registered)', () => {
  let db: ReturnType<typeof createDatabase>;

  beforeAll(() => {
    db = createDatabase(testDbUrl);
  });

  afterAll(async () => {
    // Close the drizzle-managed pool before the embedded server is stopped,
    // otherwise teardown produces unhandled ECONNRESET errors.
    await db.$client.end();
  });

  it('supports relational queries through the configured schema object', async () => {
    const user = await insertUser('rel_user');
    await client.query(
      `INSERT INTO sessions (user_id, token_hash, device_name, platform, expires_at)
       VALUES ($1, 'hash-rel-1', 'Rel Phone', 'android', now() + interval '30 days')`,
      [user],
    );
    // `with` only works when relations are registered in the runtime schema.
    const rows = await db.query.users.findMany({ with: { sessions: true } });
    const row = rows.find((u) => u.username === 'rel_user');
    expect(row).toBeTruthy();
    expect(row!.sessions).toHaveLength(1);
    expect(row!.sessions[0]!.tokenHash).toBe('hash-rel-1');
  });

  it('traverses circles -> members relationally', async () => {
    const circle = await insertCircle();
    await addMember(circle.id, await insertUser('rel_member'));
    const row = await db.query.circles.findFirst({
      where: eq(circles.id, circle.id),
      with: { members: true },
    });
    expect(row).toBeTruthy();
    expect(row!.members).toHaveLength(2); // owner + added member
  });
});

describe('circle capacity concurrency (docs/DATABASE.md §1.3, §3)', () => {
  it('serializes competing joins through the circle-row lock (service pattern)', async () => {
    const circle = await insertCircle();
    await addMember(circle.id, await insertUser('cc_a'));
    await addMember(circle.id, await insertUser('cc_b'));
    await addMember(circle.id, await insertUser('cc_c')); // owner + 3 = 4, one slot left

    const t1 = new Client({ connectionString: testDbUrl });
    const t2 = new Client({ connectionString: testDbUrl });
    await t1.connect();
    await t2.connect();
    try {
      // Service worker 1: lock the circle row, insert the last member.
      await t1.query('BEGIN');
      await t1.query(`SELECT id FROM circles WHERE id = $1 FOR UPDATE`, [circle.id]);
      await t1.query(
        `INSERT INTO circle_members (circle_id, user_id, role) VALUES ($1, $2, 'member')`,
        [circle.id, await insertUser('cc_d')],
      );
      // Service worker 2 must block on the locked circle row — this proves the
      // FOR UPDATE lock (not the trigger) is the serialization mechanism.
      await t2.query('BEGIN');
      await t2.query(`SET LOCAL lock_timeout = '1500ms'`);
      await expectPgError(
        () => t2.query(`SELECT id FROM circles WHERE id = $1 FOR UPDATE`, [circle.id]),
        '55P03',
      );
      // The lock timeout aborted T2's transaction; start a clean one.
      await t2.query('ROLLBACK');
      await t1.query('COMMIT');
      // After T1 commits, T2 acquires the lock and observes a full circle, so
      // the documented conditional insert is skipped (clean path, no crash).
      await t2.query('BEGIN');
      await t2.query(`SELECT id FROM circles WHERE id = $1 FOR UPDATE`, [circle.id]);
      const seen = await t2.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM circle_members WHERE circle_id = $1`,
        [circle.id],
      );
      expect(seen.rows[0]!.n).toBe(5);
      await t2.query('ROLLBACK');
      const final = await client.query<{ members_count: number }>(
        `SELECT members_count FROM circles WHERE id = $1`,
        [circle.id],
      );
      expect(final.rows[0]!.members_count).toBe(5);
    } finally {
      await t1.end();
      await t2.end();
    }
  });

});
