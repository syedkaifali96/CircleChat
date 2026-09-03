import type { FastifyInstance } from 'fastify';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { createDatabase, type Database } from '../../db/client';
import { InMemoryStorageGateway } from '../media/storage';
import { migrateTestDatabase, resolveTestDatabaseUrl, startEmbeddedPostgres } from '../../db/testing';

/**
 * M4 Circles integration tests — real PostgreSQL, real HTTP flows. Covers the
 * docs/API.md circle contract, docs/DATABASE.md §1.2–1.4/§3 invite + capacity
 * semantics and docs/SECURITY.md §5 authorization rules, including the
 * concurrent-join proof that a Circle can never exceed 5 members.
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

async function createCircle(token: string, name = 'My Circle'): Promise<Record<string, unknown>> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/circles',
    headers: bearer(token),
    payload: { name },
  });
  return (res.json() as { circle: Record<string, unknown> }).circle;
}

async function createInvite(token: string, circleId: string, expiresInDays?: number): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: `/v1/circles/${circleId}/invite`,
    headers: bearer(token),
    payload: expiresInDays === undefined ? {} : { expiresInDays },
  });
  return (res.json() as { inviteCode: string }).inviteCode;
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

describe('create circle (docs/API.md POST /circles)', () => {
  it('creates the Circle with the creator as owner and count 1', async () => {
    const { token } = await signup(`cown_${suffix()}`);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/circles',
      headers: bearer(token),
      payload: { name: 'Night Owls', description: 'No sleep club' },
    });
    expect(res.statusCode).toBe(201);
    const circle = res.json().circle as Record<string, unknown>;
    expect(circle.name).toBe('Night Owls');
    expect(circle.membersCount).toBe(1);
    expect(circle.callerRole).toBe('owner');

    const rows = await client.query<{ role: string }>(
      `SELECT role FROM circle_members WHERE circle_id = $1`,
      [circle.id],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]!.role).toBe('owner');
    // Exactly one conversation and one settings row per Circle (§1.4, §1.5).
    const conv = await client.query<{ count: number }>(
      `SELECT count(*)::int FROM conversations WHERE circle_id = $1`,
      [circle.id],
    );
    expect(conv.rows[0]!.count).toBe(1);
    const settings = await client.query<{ count: number }>(
      `SELECT count(*)::int FROM circle_settings WHERE circle_id = $1`,
      [circle.id],
    );
    expect(settings.rows[0]!.count).toBe(1);
  });

  it('rejects unauthenticated creation and invalid names', async () => {
    const anon = await app.inject({ method: 'POST', url: '/v1/circles', payload: { name: 'X' } });
    expect(anon.statusCode).toBe(401);

    const { token } = await signup(`cbad_${suffix()}`);
    const empty = await app.inject({
      method: 'POST',
      url: '/v1/circles',
      headers: bearer(token),
      payload: { name: '   ' },
    });
    expect(empty.statusCode).toBe(400);
    expect(empty.json().code).toBe('VALIDATION_FAILED');
    const long = await app.inject({
      method: 'POST',
      url: '/v1/circles',
      headers: bearer(token),
      payload: { name: 'x'.repeat(41) },
    });
    expect(long.statusCode).toBe(400);
  });
});

describe('invite lifecycle (docs/DATABASE.md §1.2 invite semantics)', () => {
  it('returns the raw code exactly once and stores only a hash', async () => {
    const { token } = await signup(`inv_${suffix()}`);
    const circle = await createCircle(token);
    const code = await createInvite(token, circle.id as string);
    expect(code).toMatch(/^[1-9A-HJ-NP-Z]{4}-[1-9A-HJ-NP-Z]{4}-[1-9A-HJ-NP-Z]{4}$/);

    const row = await client.query<{ invite_code_hash: string | null }>(
      `SELECT invite_code_hash FROM circles WHERE id = $1`,
      [circle.id],
    );
    expect(row.rows[0]!.invite_code_hash).toMatch(/^[0-9a-f]{64}$/);
    const serialized = JSON.stringify(row.rows[0]);
    expect(serialized).not.toContain(code);

    // A second invite invalidates the previous code (single active invite).
    const second = await createInvite(token, circle.id as string);
    expect(second).not.toBe(code);
    const oldPreview = await app.inject({ method: 'GET', url: `/v1/circles/invite-preview?code=${code}` });
    expect(oldPreview.statusCode).toBe(404);
  });

  it('rejects invite creation and revocation for plain members', async () => {
    const owner = await signup(`ownr_${suffix()}`);
    const member = await signup(`memr_${suffix()}`);
    const circle = await createCircle(owner.token);
    const code = await createInvite(owner.token, circle.id as string);
    await app.inject({
      method: 'POST',
      url: '/v1/circles/join',
      headers: bearer(member.token),
      payload: { inviteCode: code },
    });

    const deniedCreate = await app.inject({
      method: 'POST',
      url: `/v1/circles/${circle.id}/invite`,
      headers: bearer(member.token),
      payload: {},
    });
    expect(deniedCreate.statusCode).toBe(404);

    const deniedRevoke = await app.inject({
      method: 'DELETE',
      url: `/v1/circles/${circle.id}/invite`,
      headers: bearer(member.token),
    });
    expect(deniedRevoke.statusCode).toBe(404);
  });

  it('revokes the active invite so join and preview both fail', async () => {
    const owner = await signup(`rvk_${suffix()}`);
    const joiner = await signup(`rvkj_${suffix()}`);
    const circle = await createCircle(owner.token);
    const code = await createInvite(owner.token, circle.id as string);

    const revoke = await app.inject({
      method: 'DELETE',
      url: `/v1/circles/${circle.id}/invite`,
      headers: bearer(owner.token),
    });
    expect(revoke.statusCode).toBe(200);

    const preview = await app.inject({ method: 'GET', url: `/v1/circles/invite-preview?code=${code}` });
    expect(preview.statusCode).toBe(404);
    const join = await app.inject({
      method: 'POST',
      url: '/v1/circles/join',
      headers: bearer(joiner.token),
      payload: { inviteCode: code },
    });
    expect(join.statusCode).toBe(404);
    expect(join.json().code).toBe('INVALID_INVITE');
  });
});

describe('join + preview (docs/API.md join/invite-preview)', () => {
  it('previews a valid invite without exposing members and joins successfully', async () => {
    const owner = await signup(`pvw_${suffix()}`);
    const joiner = await signup(`pvwj_${suffix()}`);
    const circle = await createCircle(owner.token, 'Preview Crew');
    const code = await createInvite(owner.token, circle.id as string);

    const preview = await app.inject({ method: 'GET', url: `/v1/circles/invite-preview?code=${code}` });
    expect(preview.statusCode).toBe(200);
    const body = preview.json().preview as Record<string, unknown>;
    expect(body.name).toBe('Preview Crew');
    expect(body.memberCount).toBe(1);
    expect(JSON.stringify(preview.body)).not.toContain('members');
    expect(preview.headers['cache-control']).toBe('no-store');

    const join = await app.inject({
      method: 'POST',
      url: '/v1/circles/join',
      headers: bearer(joiner.token),
      payload: { inviteCode: code.toLowerCase() }, // normalization: lower/whitespace ok
    });
    expect(join.statusCode).toBe(201);

    const detail = await app.inject({
      method: 'GET',
      url: `/v1/circles/${circle.id}`,
      headers: bearer(joiner.token),
    });
    expect(detail.statusCode).toBe(200);
    expect((detail.json().circle as Record<string, unknown>).membersCount).toBe(2);
  });

  it('rejects an invalid code, and an already-member re-join', async () => {
    const owner = await signup(`inval_${suffix()}`);
    const member = await signup(`invalm_${suffix()}`);
    const circle = await createCircle(owner.token);
    const code = await createInvite(owner.token, circle.id as string);
    await app.inject({
      method: 'POST',
      url: '/v1/circles/join',
      headers: bearer(member.token),
      payload: { inviteCode: code },
    });

    const rejoin = await app.inject({
      method: 'POST',
      url: '/v1/circles/join',
      headers: bearer(member.token),
      payload: { inviteCode: code },
    });
    expect(rejoin.statusCode).toBe(409);
    expect(rejoin.json().code).toBe('ALREADY_MEMBER');

    const bad = await app.inject({
      method: 'POST',
      url: '/v1/circles/join',
      headers: bearer(member.token),
      payload: { inviteCode: 'ZZZZ-ZZZZ-ZZZZ' },
    });
    expect(bad.statusCode).toBe(404);
    expect(bad.json().code).toBe('INVALID_INVITE');

    const malformed = await app.inject({
      method: 'POST',
      url: '/v1/circles/join',
      headers: bearer(member.token),
      payload: { inviteCode: 'short' },
    });
    expect(malformed.statusCode).toBe(400);
  });

  it('rejects an expired invite with INVITE_EXPIRED (410)', async () => {
    const owner = await signup(`exp_${suffix()}`);
    const joiner = await signup(`expj_${suffix()}`);
    const circle = await createCircle(owner.token);
    const code = await createInvite(owner.token, circle.id as string);
    await client.query(`UPDATE circles SET invite_expires_at = now() - interval '1 day' WHERE id = $1`, [
      circle.id,
    ]);

    const preview = await app.inject({ method: 'GET', url: `/v1/circles/invite-preview?code=${code}` });
    expect(preview.statusCode).toBe(404);
    const join = await app.inject({
      method: 'POST',
      url: '/v1/circles/join',
      headers: bearer(joiner.token),
      payload: { inviteCode: code },
    });
    expect(join.statusCode).toBe(410);
    expect(join.json().code).toBe('INVITE_EXPIRED');
  });

  it('enforces invite expiry bounds (1–30 days) on creation', async () => {
    const { token } = await signup(`expb_${suffix()}`);
    const circle = await createCircle(token);
    const zero = await app.inject({
      method: 'POST',
      url: `/v1/circles/${circle.id}/invite`,
      headers: bearer(token),
      payload: { expiresInDays: 0 },
    });
    expect(zero.statusCode).toBe(400);
    const big = await app.inject({
      method: 'POST',
      url: `/v1/circles/${circle.id}/invite`,
      headers: bearer(token),
      payload: { expiresInDays: 31 },
    });
    expect(big.statusCode).toBe(400);
  });
});

describe('5-member capacity (docs/DATABASE.md §1.3, §3)', () => {
  it('rejects the sixth join with CIRCLE_FULL (409)', async () => {
    const owner = await signup(`cap_${suffix()}`);
    const circle = await createCircle(owner.token);
    const code = await createInvite(owner.token, circle.id as string);
    const joiners = await Promise.all(
      Array.from({ length: 4 }, (_, i) => signup(`capj${i}_${suffix()}`)),
    );
    for (const joiner of joiners) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/circles/join',
        headers: bearer(joiner.token),
        payload: { inviteCode: code },
      });
      expect(res.statusCode).toBe(201);
    }
    const outsider = await signup(`capfull_${suffix()}`);
    const rejected = await app.inject({
      method: 'POST',
      url: '/v1/circles/join',
      headers: bearer(outsider.token),
      payload: { inviteCode: code },
    });
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json().code).toBe('CIRCLE_FULL');

    const row = await client.query<{ members_count: number }>(
      `SELECT members_count FROM circles WHERE id = $1`,
      [circle.id],
    );
    expect(row.rows[0]!.members_count).toBe(5);
  });

  it('never exceeds 5 members under concurrent joins racing one invite', async () => {
    const owner = await signup(`race_${suffix()}`);
    const circle = await createCircle(owner.token);
    const code = await createInvite(owner.token, circle.id as string);
    // More racers than capacity: at most 4 can succeed alongside the owner.
    const racers = await Promise.all(Array.from({ length: 10 }, (_, i) => signup(`racr${i}_${suffix()}`)));

    const results = await Promise.all(
      racers.map((racer) =>
        app.inject({
          method: 'POST',
          url: '/v1/circles/join',
          headers: bearer(racer.token),
          payload: { inviteCode: code },
        }),
      ),
    );
    const succeeded = results.filter((res) => res.statusCode === 201);
    expect(succeeded).toHaveLength(4);
    for (const res of results.filter((r) => r.statusCode !== 201)) {
      expect(res.json().code).toBe('CIRCLE_FULL');
    }

    const row = await client.query<{ members_count: number }>(
      `SELECT members_count FROM circles WHERE id = $1`,
      [circle.id],
    );
    const actual = await client.query<{ count: number }>(
      `SELECT count(*)::int FROM circle_members WHERE circle_id = $1`,
      [circle.id],
    );
    expect(row.rows[0]!.members_count).toBe(5);
    expect(actual.rows[0]!.count).toBe(5);
  });
});

describe('membership management (leave/remove/roles/transfer)', () => {
  it('blocks owner leave until ownership is transferred, then allows it', async () => {
    const owner = await signup(`lvown_${suffix()}`);
    const member = await signup(`lvmem_${suffix()}`);
    const circle = await createCircle(owner.token);
    const code = await createInvite(owner.token, circle.id as string);
    await app.inject({
      method: 'POST',
      url: '/v1/circles/join',
      headers: bearer(member.token),
      payload: { inviteCode: code },
    });

    const blocked = await app.inject({
      method: 'DELETE',
      url: `/v1/circles/${circle.id}/members/me`,
      headers: bearer(owner.token),
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe('OWNER_MUST_TRANSFER');

    const transfer = await app.inject({
      method: 'POST',
      url: `/v1/circles/${circle.id}/ownership-transfer`,
      headers: bearer(owner.token),
      payload: { newOwnerUserId: member.userId },
    });
    expect(transfer.statusCode).toBe(200);

    const leave = await app.inject({
      method: 'DELETE',
      url: `/v1/circles/${circle.id}/members/me`,
      headers: bearer(owner.token),
    });
    expect(leave.statusCode).toBe(200);

    const roles = await client.query<{ role: string; user_id: string }>(
      `SELECT role, user_id::text FROM circle_members WHERE circle_id = $1`,
      [circle.id],
    );
    expect(roles.rows).toHaveLength(1);
    expect(roles.rows[0]).toEqual({ role: 'owner', user_id: member.userId });
  });

  it('removes a member as owner, forbids removing the owner, and rejects non-admin removers', async () => {
    const owner = await signup(`rmown_${suffix()}`);
    const admin = await signup(`rmadm_${suffix()}`);
    const member = await signup(`rmmem_${suffix()}`);
    const circle = await createCircle(owner.token);
    const code = await createInvite(owner.token, circle.id as string);
    for (const u of [admin, member]) {
      await app.inject({
        method: 'POST',
        url: '/v1/circles/join',
        headers: bearer(u.token),
        payload: { inviteCode: code },
      });
    }
    // Promote member→admin for the admin-removal case.
    await app.inject({
      method: 'PATCH',
      url: `/v1/circles/${circle.id}/members/${admin.userId}`,
      headers: bearer(owner.token),
      payload: { role: 'admin' },
    });

    // Plain member cannot remove anyone.
    const denied = await app.inject({
      method: 'DELETE',
      url: `/v1/circles/${circle.id}/members/${admin.userId}`,
      headers: bearer(member.token),
    });
    expect(denied.statusCode).toBe(404);

    // Admin removes the plain member.
    const removed = await app.inject({
      method: 'DELETE',
      url: `/v1/circles/${circle.id}/members/${member.userId}`,
      headers: bearer(admin.token),
    });
    expect(removed.statusCode).toBe(200);

    // Neither admin nor anyone can remove the owner.
    const ownerRemoved = await app.inject({
      method: 'DELETE',
      url: `/v1/circles/${circle.id}/members/${owner.userId}`,
      headers: bearer(admin.token),
    });
    expect(ownerRemoved.statusCode).toBe(409);
    expect(ownerRemoved.json().code).toBe('CANNOT_REMOVE_OWNER');
  });

  it('changes roles owner-only and keeps exactly one owner', async () => {
    const owner = await signup(`role_${suffix()}`);
    const member = await signup(`rolem_${suffix()}`);
    const circle = await createCircle(owner.token);
    const code = await createInvite(owner.token, circle.id as string);
    await app.inject({
      method: 'POST',
      url: '/v1/circles/join',
      headers: bearer(member.token),
      payload: { inviteCode: code },
    });

    const denied = await app.inject({
      method: 'PATCH',
      url: `/v1/circles/${circle.id}/members/${owner.userId}`,
      headers: bearer(member.token),
      payload: { role: 'admin' },
    });
    expect(denied.statusCode).toBe(404);

    const promote = await app.inject({
      method: 'PATCH',
      url: `/v1/circles/${circle.id}/members/${member.userId}`,
      headers: bearer(owner.token),
      payload: { role: 'admin' },
    });
    expect(promote.statusCode).toBe(200);

    // Owner role cannot be assigned through the role endpoint.
    const ownerAssign = await app.inject({
      method: 'PATCH',
      url: `/v1/circles/${circle.id}/members/${member.userId}`,
      headers: bearer(owner.token),
      payload: { role: 'owner' },
    });
    expect(ownerAssign.statusCode).toBe(400);

    // Owner cannot be demoted through this endpoint.
    const demoteOwner = await app.inject({
      method: 'PATCH',
      url: `/v1/circles/${circle.id}/members/${owner.userId}`,
      headers: bearer(owner.token),
      payload: { role: 'member' },
    });
    expect(demoteOwner.statusCode).toBe(409);
    expect(demoteOwner.json().code).toBe('CANNOT_MODIFY_OWNER');
  });

  it('transfers ownership atomically and rejects non-members/non-owners', async () => {
    const owner = await signup(`trnf_${suffix()}`);
    const member = await signup(`trnfm_${suffix()}`);
    const stranger = await signup(`trnfs_${suffix()}`);
    const circle = await createCircle(owner.token);
    const code = await createInvite(owner.token, circle.id as string);
    await app.inject({
      method: 'POST',
      url: '/v1/circles/join',
      headers: bearer(member.token),
      payload: { inviteCode: code },
    });

    const strangerTry = await app.inject({
      method: 'POST',
      url: `/v1/circles/${circle.id}/ownership-transfer`,
      headers: bearer(stranger.token),
      payload: { newOwnerUserId: member.userId },
    });
    expect(strangerTry.statusCode).toBe(404);

    const notMember = await app.inject({
      method: 'POST',
      url: `/v1/circles/${circle.id}/ownership-transfer`,
      headers: bearer(owner.token),
      payload: { newOwnerUserId: stranger.userId },
    });
    expect(notMember.statusCode).toBe(404);
    expect(notMember.json().code).toBe('NOT_A_MEMBER');

    const transfer = await app.inject({
      method: 'POST',
      url: `/v1/circles/${circle.id}/ownership-transfer`,
      headers: bearer(owner.token),
      payload: { newOwnerUserId: member.userId },
    });
    expect(transfer.statusCode).toBe(200);

    const owners = await client.query<{ count: number }>(
      `SELECT count(*)::int FROM circle_members WHERE circle_id = $1 AND role = 'owner'`,
      [circle.id],
    );
    expect(owners.rows[0]!.count).toBe(1);
  });
});

describe('authorization + cross-circle access (docs/SECURITY.md §5)', () => {
  it('hides Circle details from non-members and unauthenticated callers', async () => {
    const owner = await signup(`hid_${suffix()}`);
    const outsider = await signup(`hido_${suffix()}`);
    const circle = await createCircle(owner.token);

    const denied = await app.inject({
      method: 'GET',
      url: `/v1/circles/${circle.id}`,
      headers: bearer(outsider.token),
    });
    expect(denied.statusCode).toBe(404);
    expect(denied.json().code).toBe('NOT_FOUND');

    const anon = await app.inject({ method: 'GET', url: `/v1/circles/${circle.id}` });
    expect(anon.statusCode).toBe(401);

    const anonLeave = await app.inject({ method: 'DELETE', url: `/v1/circles/${circle.id}/members/me` });
    expect(anonLeave.statusCode).toBe(401);
  });

  it('lists only the caller Circles with unreadCount present', async () => {
    const a = await signup(`lista_${suffix()}`);
    const b = await signup(`listb_${suffix()}`);
    const circleA = await createCircle(a.token, 'A only');
    const circleB = await createCircle(b.token, 'B only');

    const listA = await app.inject({ method: 'GET', url: '/v1/circles', headers: bearer(a.token) });
    const circlesA = listA.json().circles as Array<Record<string, unknown>>;
    expect(circlesA.map((c) => c.id)).toEqual([circleA.id]);
    expect(circlesA[0]!.unreadCount).toBe(0);

    const listB = await app.inject({ method: 'GET', url: '/v1/circles', headers: bearer(b.token) });
    const circlesB = listB.json().circles as Array<Record<string, unknown>>;
    expect(circlesB.map((c) => c.id)).toEqual([circleB.id]);
  });

  it('rejects cross-circle member removal and settings updates', async () => {
    const ownerA = await signup(`xowna_${suffix()}`);
    const ownerB = await signup(`xownb_${suffix()}`);
    const memberB = await signup(`xmemmb_${suffix()}`);
    // Owner A runs their own Circle but must stay locked out of B's entirely.
    await createCircle(ownerA.token);
    const circleB = await createCircle(ownerB.token);
    const codeB = await createInvite(ownerB.token, circleB.id as string);
    await app.inject({
      method: 'POST',
      url: '/v1/circles/join',
      headers: bearer(memberB.token),
      payload: { inviteCode: codeB },
    });

    // Owner A cannot remove B's member, patch B's circle, or read B's settings.
    const crossRemove = await app.inject({
      method: 'DELETE',
      url: `/v1/circles/${circleB.id}/members/${memberB.userId}`,
      headers: bearer(ownerA.token),
    });
    expect(crossRemove.statusCode).toBe(404);

    const crossPatch = await app.inject({
      method: 'PATCH',
      url: `/v1/circles/${circleB.id}`,
      headers: bearer(ownerA.token),
      payload: { name: 'Hacked' },
    });
    expect(crossPatch.statusCode).toBe(404);

    const crossSettings = await app.inject({
      method: 'GET',
      url: `/v1/circles/${circleB.id}/settings`,
      headers: bearer(ownerA.token),
    });
    expect(crossSettings.statusCode).toBe(404);
  });

  it('rejects revoked-session callers on circle endpoints', async () => {
    const owner = await signup(`revo_${suffix()}`);
    const circle = await createCircle(owner.token);
    await client.query(`UPDATE sessions SET revoked_at = now() WHERE user_id = $1`, [owner.userId]);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/circles/${circle.id}`,
      headers: bearer(owner.token),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('AUTH_REQUIRED');
  });
});

describe('settings + home + delete (docs/API.md)', () => {
  it('reads defaults, patches settings as admin, and rejects plain members', async () => {
    const owner = await signup(`set_${suffix()}`);
    const member = await signup(`setm_${suffix()}`);
    const circle = await createCircle(owner.token);
    const code = await createInvite(owner.token, circle.id as string);
    await app.inject({
      method: 'POST',
      url: '/v1/circles/join',
      headers: bearer(member.token),
      payload: { inviteCode: code },
    });

    const defaults = await app.inject({
      method: 'GET',
      url: `/v1/circles/${circle.id}/settings`,
      headers: bearer(member.token),
    });
    expect(defaults.statusCode).toBe(200);
    expect(defaults.json().settings).toEqual({
      themePreset: 'dark_purple',
      accentColor: null,
      backgroundKey: null,
    });

    const denied = await app.inject({
      method: 'PATCH',
      url: `/v1/circles/${circle.id}/settings`,
      headers: bearer(member.token),
      payload: { themePreset: 'midnight' },
    });
    expect(denied.statusCode).toBe(404);

    const patch = await app.inject({
      method: 'PATCH',
      url: `/v1/circles/${circle.id}/settings`,
      headers: bearer(owner.token),
      payload: { themePreset: 'midnight', accentColor: '#A78BFA' },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().settings.themePreset).toBe('midnight');

    const badColor = await app.inject({
      method: 'PATCH',
      url: `/v1/circles/${circle.id}/settings`,
      headers: bearer(owner.token),
      payload: { accentColor: 'purple' },
    });
    expect(badColor.statusCode).toBe(400);
  });

  it('returns the Circle Home payload for members with empty M4 sections', async () => {
    const owner = await signup(`home_${suffix()}`);
    const circle = await createCircle(owner.token, 'Home Base');
    const res = await app.inject({
      method: 'GET',
      url: `/v1/circles/${circle.id}/home`,
      headers: bearer(owner.token),
    });
    expect(res.statusCode).toBe(200);
    const home = res.json().home as Record<string, unknown>;
    expect(home.name).toBe('Home Base');
    expect(home.activePolls).toEqual([]);
    expect(home.pinnedItems).toEqual([]);
  });

  it('renames/describes as admin, rejects invalid input, and soft-deletes owner-only', async () => {
    const owner = await signup(`del_${suffix()}`);
    const member = await signup(`delm_${suffix()}`);
    const circle = await createCircle(owner.token);
    const code = await createInvite(owner.token, circle.id as string);
    await app.inject({
      method: 'POST',
      url: '/v1/circles/join',
      headers: bearer(member.token),
      payload: { inviteCode: code },
    });

    const patch = await app.inject({
      method: 'PATCH',
      url: `/v1/circles/${circle.id}`,
      headers: bearer(owner.token),
      payload: { name: 'Renamed', description: null },
    });
    expect(patch.statusCode).toBe(200);
    const patched = patch.json().circle as Record<string, unknown>;
    expect(patched.name).toBe('Renamed');
    expect(patched.description).toBeNull();
    expect(patched.callerRole).toBe('owner');

    const nothing = await app.inject({
      method: 'PATCH',
      url: `/v1/circles/${circle.id}`,
      headers: bearer(owner.token),
      payload: {},
    });
    expect(nothing.statusCode).toBe(400);

    const deniedDelete = await app.inject({
      method: 'DELETE',
      url: `/v1/circles/${circle.id}`,
      headers: bearer(member.token),
    });
    expect(deniedDelete.statusCode).toBe(404);

    const del = await app.inject({
      method: 'DELETE',
      url: `/v1/circles/${circle.id}`,
      headers: bearer(owner.token),
    });
    expect(del.statusCode).toBe(200);

    const row = await client.query<{ deleted_at: Date | null; invite_code_hash: string | null }>(
      `SELECT deleted_at, invite_code_hash FROM circles WHERE id = $1`,
      [circle.id],
    );
    expect(row.rows[0]!.deleted_at).not.toBeNull();
    expect(row.rows[0]!.invite_code_hash).toBeNull();

    const gone = await app.inject({
      method: 'GET',
      url: `/v1/circles/${circle.id}`,
      headers: bearer(owner.token),
    });
    expect(gone.statusCode).toBe(404);
  });
});
