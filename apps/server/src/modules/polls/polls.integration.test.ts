import type { FastifyInstance } from 'fastify';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { createDatabase, type Database } from '../../db/client';
import { migrateTestDatabase, resolveTestDatabaseUrl, startEmbeddedPostgres } from '../../db/testing';

/**
 * M11 Polls integration tests — real PostgreSQL, real HTTP flows. Covers the
 * docs/API.md poll contract and docs/DATABASE.md §1.13–1.14 semantics:
 * single-choice voting with one vote per user (PK-enforced), Circle-only
 * creation, generic-404 authorization, closed-poll behavior and Circle Home
 * `activePolls` integration (the M9 placeholder becomes real data).
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
  return { token: body.token, userId: body.user.id, username: body.user.username };
}

async function createCircle(token: string, name = 'My Circle'): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/circles',
    headers: bearer(token),
    payload: { name },
  });
  return (res.json() as { circle: { id: string } }).circle.id;
}

/** Owner mints the invite; the JOINING member uses it (invite creation is
 * admin-only, so both tokens are required). */
async function joinViaInvite(ownerToken: string, memberToken: string, circleId: string): Promise<number> {
  const invite = await app.inject({
    method: 'POST',
    url: `/v1/circles/${circleId}/invite`,
    headers: bearer(ownerToken),
    payload: {},
  });
  const code = (invite.json() as { inviteCode: string }).inviteCode;
  const joined = await app.inject({
    method: 'POST',
    url: '/v1/circles/join',
    headers: bearer(memberToken),
    payload: { inviteCode: code },
  });
  return joined.statusCode;
}

async function conversationIdForCircle(token: string, circleId: string): Promise<string> {
  const home = await app.inject({
    method: 'GET',
    url: `/v1/circles/${circleId}/home`,
    headers: bearer(token),
  });
  return (home.json() as { home: { conversationId: string } }).home.conversationId;
}

interface CreatedPoll {
  id: string;
  question: string;
  options: string[];
  votes: number[];
  totalVotes: number;
  myVote: number | null;
  closed: boolean;
  createdBy: { userId: string; username: string };
}

async function createPoll(
  token: string,
  conversationId: string,
  body: Record<string, unknown> = {},
): Promise<{ status: number; poll: CreatedPoll | undefined }> {
  const res = await app.inject({
    method: 'POST',
    url: `/v1/conversations/${conversationId}/polls`,
    headers: bearer(token),
    payload: { question: 'Lunch?', options: ['Pizza', 'Biryani'], ...body },
  });
  return { status: res.statusCode, poll: res.json().poll as CreatedPoll | undefined };
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
  // The auth signup limiter (5/hour/IP) would cascade-429 this file's many
  // signups; realtime-specific limiter coverage lives in its own suite.
  app = await buildApp({ db, logger: { level: 'warn' } });
}, 300_000);

afterAll(async () => {
  await db.$client.end();
  await client?.end();
  await stopEmbedded?.();
}, 60_000);

describe('poll creation (M11, docs/API.md POST /conversations/:id/polls)', () => {
  it('creates a poll on a Circle conversation with server-derived identity', async () => {
    const owner = await signup(`m11_ow_${suffix()}`);
    const circleId = await createCircle(owner.token);
    const conversationId = await conversationIdForCircle(owner.token, circleId);

    const { status, poll } = await createPoll(owner.token, conversationId, {
      options: ['Pizza', 'Biryani', 'Karahi'],
      question: 'Lunch plan?',
    });
    expect(status).toBe(201);
    expect(poll!.question).toBe('Lunch plan?');
    expect(poll!.options).toEqual(['Pizza', 'Biryani', 'Karahi']);
    expect(poll!.votes).toEqual([0, 0, 0]);
    expect(poll!.totalVotes).toBe(0);
    expect(poll!.myVote).toBeNull();
    expect(poll!.closed).toBe(false);
    expect(poll!.createdBy.username).toBe(owner.username);
    expect(poll!.createdBy.userId).toBe(owner.userId);
    expect(poll!.id).toEqual(expect.any(String));
  });

  it('rejects malformed payloads (validation, option bounds, duplicates, past deadline)', async () => {
    const owner = await signup(`m11_cv_${suffix()}`);
    const circleId = await createCircle(owner.token);
    const conversationId = await conversationIdForCircle(owner.token, circleId);

    const emptyQuestion = await createPoll(owner.token, conversationId, { question: '   ' });
    expect(emptyQuestion.status).toBe(400);

    const oneOption = await createPoll(owner.token, conversationId, { options: ['Only'] });
    expect(oneOption.status).toBe(400);

    const sevenOptions = await createPoll(owner.token, conversationId, {
      options: ['1', '2', '3', '4', '5', '6', '7'],
    });
    expect(sevenOptions.status).toBe(400);

    const duplicateOptions = await createPoll(owner.token, conversationId, {
      options: ['Pizza', 'Pizza'],
    });
    expect(duplicateOptions.status).toBe(400);

    const emptyOption = await createPoll(owner.token, conversationId, { options: ['Pizza', '   '] });
    expect(emptyOption.status).toBe(400);

    const pastDeadline = await createPoll(owner.token, conversationId, {
      closesAt: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(pastDeadline.status).toBe(400);
  });

  it('refuses poll creation on a direct conversation (polls are Circle-only)', async () => {
    const a = await signup(`m11_dm_${suffix()}`);
    const b = await signup(`m11_dmb_${suffix()}`);
    // Both must share a Circle before a direct conversation can exist (D1).
    const circleId = await createCircle(a.token);
    await joinViaInvite(a.token, b.token, circleId);
    const direct = await app.inject({
      method: 'POST',
      url: '/v1/conversations/direct',
      headers: bearer(a.token),
      payload: { username: b.username },
    });
    const dmConversationId = (direct.json() as { conversationId: string }).conversationId;

    const { status } = await createPoll(a.token, dmConversationId);
    expect(status).toBe(403);
  });

  it('answers non-members with the generic 404', async () => {
    const owner = await signup(`m11_nm_${suffix()}`);
    const outsider = await signup(`m11_nmo_${suffix()}`);
    const circleId = await createCircle(owner.token);
    const conversationId = await conversationIdForCircle(owner.token, circleId);

    const { status } = await createPoll(outsider.token, conversationId);
    expect(status).toBe(404);
  });
});

describe('poll listing (M11, docs/API.md GET /conversations/:id/polls)', () => {
  it('lists polls newest-first with vote state for the caller', async () => {
    const owner = await signup(`m11_li_${suffix()}`);
    const circleId = await createCircle(owner.token);
    const conversationId = await conversationIdForCircle(owner.token, circleId);
    await createPoll(owner.token, conversationId, { question: 'First?' });
    const second = await createPoll(owner.token, conversationId, { question: 'Second?' });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/conversations/${conversationId}/polls`,
      headers: bearer(owner.token),
    });
    expect(res.statusCode).toBe(200);
    const polls = res.json().polls as Array<{ question: string; id: string }>;
    expect(polls.map((p) => p.question)).toEqual(['Second?', 'First?']);
    expect(polls[0]!.id).toBe(second.poll!.id);
  });

  it('denies non-members, removed members, revoked sessions and deleted Circles', async () => {
    const owner = await signup(`m11_ld_${suffix()}`);
    const member = await signup(`m11_ldm_${suffix()}`);
    const outsider = await signup(`m11_ldo_${suffix()}`);
    const circleId = await createCircle(owner.token);
    await joinViaInvite(owner.token, member.token, circleId);
    const conversationId = await conversationIdForCircle(owner.token, circleId);
    await createPoll(owner.token, conversationId);

    const outsiderRes = await app.inject({
      method: 'GET',
      url: `/v1/conversations/${conversationId}/polls`,
      headers: bearer(outsider.token),
    });
    expect(outsiderRes.statusCode).toBe(404);

    // Remove the member, then their listing must also 404.
    await app.inject({
      method: 'DELETE',
      url: `/v1/circles/${circleId}/members/${member.userId}`,
      headers: bearer(owner.token),
    });
    const removedRes = await app.inject({
      method: 'GET',
      url: `/v1/conversations/${conversationId}/polls`,
      headers: bearer(member.token),
    });
    expect(removedRes.statusCode).toBe(404);

    // Revoked session → 401.
    await app.inject({ method: 'POST', url: '/v1/auth/logout', headers: bearer(owner.token) });
    const revokedRes = await app.inject({
      method: 'GET',
      url: `/v1/conversations/${conversationId}/polls`,
      headers: bearer(owner.token),
    });
    expect(revokedRes.statusCode).toBe(401);
  });
});

describe('voting (M11, docs/API.md POST+DELETE /polls/:id/vote)', () => {
  it('records a vote, exposes counts and the caller selection, and rejects duplicates', async () => {
    const owner = await signup(`m11_vt_${suffix()}`);
    const member = await signup(`m11_vtm_${suffix()}`);
    const circleId = await createCircle(owner.token);
    await joinViaInvite(owner.token, member.token, circleId);
    const conversationId = await conversationIdForCircle(owner.token, circleId);
    const { poll } = await createPoll(owner.token, conversationId, { options: ['A', 'B', 'C'] });
    const pollId = poll!.id as string;

    const vote = await app.inject({
      method: 'POST',
      url: `/v1/polls/${pollId}/vote`,
      headers: bearer(member.token),
      payload: { optionIndex: 1 },
    });
    expect(vote.statusCode).toBe(200);
    const voted = vote.json().poll as { votes: number[]; totalVotes: number; myVote: number | null };
    expect(voted.votes).toEqual([0, 1, 0]);
    expect(voted.totalVotes).toBe(1);
    expect(voted.myVote).toBe(1);

    const duplicate = await app.inject({
      method: 'POST',
      url: `/v1/polls/${pollId}/vote`,
      headers: bearer(member.token),
      payload: { optionIndex: 0 },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().code).toBe('VOTE_EXISTS');
    // The error body carries only the stable error code — no poll payload.
    expect(duplicate.json().poll).toBeUndefined();

    // A second member voting shows aggregate counts.
    await app.inject({
      method: 'POST',
      url: `/v1/polls/${pollId}/vote`,
      headers: bearer(owner.token),
      payload: { optionIndex: 0 },
    });
    const ownerView = await app.inject({
      method: 'GET',
      url: `/v1/conversations/${conversationId}/polls`,
      headers: bearer(owner.token),
    });
    const mine = (ownerView.json().polls as Array<{ id: string; votes: number[]; myVote: number | null }>).find(
      (p) => p.id === pollId,
    )!;
    expect(mine.votes).toEqual([1, 1, 0]);
    expect(mine.myVote).toBe(0);
  });

  it('rejects out-of-range option indexes', async () => {
    const owner = await signup(`m11_vr_${suffix()}`);
    const circleId = await createCircle(owner.token);
    const conversationId = await conversationIdForCircle(owner.token, circleId);
    const { poll } = await createPoll(owner.token, conversationId, { options: ['A', 'B'] });

    const outOfRange = await app.inject({
      method: 'POST',
      url: `/v1/polls/${poll!.id}/vote`,
      headers: bearer(owner.token),
      payload: { optionIndex: 2 }, // valid smallint but beyond this poll's options
    });
    expect(outOfRange.statusCode).toBe(400);
  });

  it('rejects votes on a closed poll (closed early and closed by deadline)', async () => {
    const owner = await signup(`m11_vc_${suffix()}`);
    const member = await signup(`m11_vcm_${suffix()}`);
    const circleId = await createCircle(owner.token);
    await joinViaInvite(owner.token, member.token, circleId);
    const conversationId = await conversationIdForCircle(owner.token, circleId);
    const { poll } = await createPoll(owner.token, conversationId, { options: ['A', 'B'] });
    const pollId = poll!.id as string;

    // Creator closes early.
    const closed = await app.inject({
      method: 'POST',
      url: `/v1/polls/${pollId}/close`,
      headers: bearer(owner.token),
    });
    expect(closed.statusCode).toBe(200);
    expect(closed.json().poll.closed).toBe(true);

    const lateVote = await app.inject({
      method: 'POST',
      url: `/v1/polls/${pollId}/vote`,
      headers: bearer(member.token),
      payload: { optionIndex: 0 },
    });
    expect(lateVote.statusCode).toBe(409);
    expect(lateVote.json().code).toBe('POLL_CLOSED');

    // A deadline-only poll (never closed early) is also closed once past.
    const deadlinePoll = await createPoll(owner.token, conversationId, {
      options: ['A', 'B'],
      closesAt: new Date(Date.now() + 500).toISOString(),
    });
    await new Promise((resolve) => setTimeout(resolve, 700));
    const deadlineVote = await app.inject({
      method: 'POST',
      url: `/v1/polls/${deadlinePoll.poll!.id}/vote`,
      headers: bearer(member.token),
      payload: { optionIndex: 0 },
    });
    expect(deadlineVote.statusCode).toBe(409);
    expect(deadlineVote.json().code).toBe('POLL_CLOSED');
  });

  it('supports changing the vote (delete + re-vote while open)', async () => {
    const owner = await signup(`m11_ch_${suffix()}`);
    const circleId = await createCircle(owner.token);
    const conversationId = await conversationIdForCircle(owner.token, circleId);
    const { poll } = await createPoll(owner.token, conversationId, { options: ['A', 'B'] });
    const pollId = poll!.id as string;
    await app.inject({
      method: 'POST',
      url: `/v1/polls/${pollId}/vote`,
      headers: bearer(owner.token),
      payload: { optionIndex: 0 },
    });

    const removed = await app.inject({
      method: 'DELETE',
      url: `/v1/polls/${pollId}/vote`,
      headers: bearer(owner.token),
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json().poll.myVote).toBeNull();
    expect(removed.json().poll.totalVotes).toBe(0);

    const revote = await app.inject({
      method: 'POST',
      url: `/v1/polls/${pollId}/vote`,
      headers: bearer(owner.token),
      payload: { optionIndex: 1 },
    });
    expect(revote.json().poll.myVote).toBe(1);
  });

  it('isolates votes across polls — an index from another poll is just a range check', async () => {
    const owner = await signup(`m11_xp_${suffix()}`);
    const outsider = await signup(`m11_xpo_${suffix()}`);
    const circleA = await createCircle(owner.token, 'Circle A');
    const circleB = await createCircle(outsider.token, 'Circle B');
    const convA = await conversationIdForCircle(owner.token, circleA);
    const convB = await conversationIdForCircle(outsider.token, circleB);
    const pollA = await createPoll(owner.token, convA, { options: ['A1', 'A2'] });
    const pollB = await createPoll(outsider.token, convB, { options: ['B1', 'B2'] });

    // A non-member of Circle A cannot even vote on Circle A's poll.
    const foreign = await app.inject({
      method: 'POST',
      url: `/v1/polls/${pollA.poll!.id}/vote`,
      headers: bearer(outsider.token),
      payload: { optionIndex: 0 },
    });
    expect(foreign.statusCode).toBe(404);
    // …and cannot read the listing either.
    const foreignList = await app.inject({
      method: 'GET',
      url: `/v1/conversations/${convA}/polls`,
      headers: bearer(outsider.token),
    });
    expect(foreignList.statusCode).toBe(404);

    // Cross-Circle poll ids stay isolated: B's member votes only on B's poll.
    const ownVote = await app.inject({
      method: 'POST',
      url: `/v1/polls/${pollB.poll!.id}/vote`,
      headers: bearer(outsider.token),
      payload: { optionIndex: 1 },
    });
    expect(ownVote.statusCode).toBe(200);
    expect(pollA.poll!.totalVotes).toBe(0);
  });

  it('collapses concurrent duplicate votes into one row (PK enforcement)', async () => {
    const owner = await signup(`m11_cc_${suffix()}`);
    const circleId = await createCircle(owner.token);
    const conversationId = await conversationIdForCircle(owner.token, circleId);
    const { poll } = await createPoll(owner.token, conversationId, { options: ['A', 'B'] });
    const pollId = poll!.id as string;

    const results = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/v1/polls/${pollId}/vote`,
        headers: bearer(owner.token),
        payload: { optionIndex: 0 },
      }),
      app.inject({
        method: 'POST',
        url: `/v1/polls/${pollId}/vote`,
        headers: bearer(owner.token),
        payload: { optionIndex: 0 },
      }),
    ]);
    const statuses = results.map((res) => res.statusCode).sort();
    expect(statuses).toEqual([200, 409]); // exactly one vote lands

    const rows = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM poll_votes WHERE poll_id = $1 AND user_id = $2`,
      [pollId, owner.userId],
    );
    expect(rows.rows[0]!.count).toBe(1);
  });
});

describe('closing polls (M11, docs/API.md POST /polls/:id/close)', () => {
  it('allows the creator and Circle owner/admin, refuses plain members', async () => {
    const owner = await signup(`m11_cl_${suffix()}`);
    const member = await signup(`m11_clm_${suffix()}`);
    const circleId = await createCircle(owner.token);
    await joinViaInvite(owner.token, member.token, circleId);
    const conversationId = await conversationIdForCircle(owner.token, circleId);
    const creatorPoll = await createPoll(member.token, conversationId, { options: ['A', 'B'] });
    const ownerPoll = await createPoll(owner.token, conversationId, { options: ['A', 'B'] });

    // A plain member cannot close someone else's poll…
    const denied = await app.inject({
      method: 'POST',
      url: `/v1/polls/${ownerPoll.poll!.id}/close`,
      headers: bearer(member.token),
    });
    expect(denied.statusCode).toBe(403);

    // …but can close their own.
    const ownClose = await app.inject({
      method: 'POST',
      url: `/v1/polls/${creatorPoll.poll!.id}/close`,
      headers: bearer(member.token),
    });
    expect(ownClose.statusCode).toBe(200);
    expect(ownClose.json().poll.closed).toBe(true);

    // Circle owner/admin can close any poll.
    const ownerClose = await app.inject({
      method: 'POST',
      url: `/v1/polls/${creatorPoll.poll!.id}/close`,
      headers: bearer(owner.token),
    });
    expect(ownerClose.statusCode).toBe(409); // already closed by the creator
    const ownerClosesOwn = await app.inject({
      method: 'POST',
      url: `/v1/polls/${ownerPoll.poll!.id}/close`,
      headers: bearer(owner.token),
    });
    expect(ownerClosesOwn.statusCode).toBe(200);
  });
});

describe('circle home polls (M11, replaces the activePolls placeholder)', () => {
  it('surfaces active polls with live results and hides closed ones', async () => {
    const owner = await signup(`m11_hm_${suffix()}`);
    const member = await signup(`m11_hmm_${suffix()}`);
    const circleId = await createCircle(owner.token);
    await joinViaInvite(owner.token, member.token, circleId);
    const conversationId = await conversationIdForCircle(owner.token, circleId);

    // Empty state first.
    let home = await app.inject({
      method: 'GET',
      url: `/v1/circles/${circleId}/home`,
      headers: bearer(owner.token),
    });
    expect(home.json().home.activePolls).toEqual([]);
    expect(home.json().home.activePollsCount).toBe(0);

    const open = await createPoll(owner.token, conversationId, { options: ['A', 'B'] });
    await app.inject({
      method: 'POST',
      url: `/v1/polls/${open.poll!.id}/vote`,
      headers: bearer(member.token),
      payload: { optionIndex: 1 },
    });
    const closedPoll = await createPoll(owner.token, conversationId, { options: ['C', 'D'] });
    await app.inject({
      method: 'POST',
      url: `/v1/polls/${closedPoll.poll!.id}/close`,
      headers: bearer(owner.token),
    });

    home = await app.inject({
      method: 'GET',
      url: `/v1/circles/${circleId}/home`,
      headers: bearer(owner.token),
    });
    const payload = home.json().home as {
      activePolls: Array<{ id: string; votes: number[]; myVote: number | null }>;
      activePollsCount: number;
    };
    expect(payload.activePollsCount).toBe(1);
    expect(payload.activePolls).toHaveLength(1);
    expect(payload.activePolls[0]!.id).toBe(open.poll!.id);
    expect(payload.activePolls[0]!.votes).toEqual([0, 1]);
  });
});
