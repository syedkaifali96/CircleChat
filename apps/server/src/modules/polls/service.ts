import { and, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Database } from '../../db/client';
import {
  circleMembers,
  circles,
  conversations,
  pollVotes,
  polls,
  users,
} from '../../db/schema';
import { AppError, forbidden, notFound, validationFailed } from '../../errors';
import { requireConversationAccess } from '../conversations/service';

/**
 * Polls (M11) — docs/DATABASE.md §1.13–1.14, docs/API.md. Polls are
 * Circle-scoped: they live on the Circle's conversation and direct
 * conversations can never have one. MVP polls are single-choice —
 * `polls.allow_multiple` was intentionally removed from the design and MUST
 * NOT be reintroduced. One vote per user per poll is guaranteed by the
 * `poll_votes` composite primary key, so concurrent duplicate votes collapse
 * at the database level, not just in application code.
 *
 * A poll is CLOSED when `closes_at` is set and in the past. `closesAt` may
 * also be a future deadline supplied at creation; closing early writes
 * `now()` into the same column, so one field carries both semantics.
 */

export interface SerializedPoll {
  id: string;
  conversationId: string;
  question: string;
  /** Option labels in deterministic (insertion) order. */
  options: string[];
  /** Vote count per option index — same ordering as `options`. */
  votes: number[];
  totalVotes: number;
  /** The caller's option index, or null when they have not voted. */
  myVote: number | null;
  closed: boolean;
  closesAt: string | null;
  createdAt: string;
  createdBy: { userId: string; username: string; displayName: string };
}

interface PollRow {
  id: string;
  conversationId: string;
  createdBy: string;
  question: string;
  options: unknown;
  closesAt: Date | null;
  createdAt: Date;
}

export function isClosed(poll: { closesAt: Date | null }): boolean {
  return poll.closesAt !== null && poll.closesAt.getTime() <= Date.now();
}

/** Resolves a poll with its Circle membership check — a poll of another
 * Circle (or a deleted Circle) is indistinguishable from a missing one. */
async function pollForCaller(
  db: Database,
  pollId: string,
  callerId: string,
): Promise<{ poll: PollRow; circleId: string; role: string | undefined }> {
  const rows = await db
    .select({
      id: polls.id,
      conversationId: polls.conversationId,
      createdBy: polls.createdBy,
      question: polls.question,
      options: polls.options,
      closesAt: polls.closesAt,
      createdAt: polls.createdAt,
      circleId: conversations.circleId,
      type: conversations.type,
    })
    .from(polls)
    .innerJoin(conversations, eq(conversations.id, polls.conversationId))
    .where(eq(polls.id, pollId))
    .limit(1);
  const row = rows[0];
  if (!row || row.type !== 'circle' || !row.circleId) {
    throw notFound('Poll not found.');
  }
  const membership = await db
    .select({ role: circleMembers.role })
    .from(circleMembers)
    .innerJoin(circles, eq(circles.id, circleMembers.circleId))
    .where(
      and(
        eq(circleMembers.circleId, row.circleId),
        eq(circleMembers.userId, callerId),
        isNull(circles.deletedAt),
      ),
    )
    .limit(1);
  if (membership.length === 0) {
    throw notFound('Poll not found.');
  }
  return {
    poll: {
      id: row.id,
      conversationId: row.conversationId,
      createdBy: row.createdBy,
      question: row.question,
      options: row.options,
      closesAt: row.closesAt,
      createdAt: row.createdAt,
    },
    circleId: row.circleId,
    role: membership[0]!.role,
  };
}

/** Option vote counts + the caller's vote for the given poll ids, in one
 * query. Vote counts land on the option index (a sparse array the caller
 * normalizes against the poll's options). */
async function voteTalliesFor(
  db: Database,
  pollIds: string[],
  callerId: string,
): Promise<Map<string, { counts: number[]; myVote: number | null }>> {
  const tally = new Map<string, { counts: number[]; myVote: number | null }>();
  if (pollIds.length === 0) {
    return tally;
  }
  const rows = await db
    .select({
      pollId: pollVotes.pollId,
      optionIndex: pollVotes.optionIndex,
      userId: pollVotes.userId,
    })
    .from(pollVotes)
    .where(inArray(pollVotes.pollId, pollIds));
  for (const row of rows) {
    let entry = tally.get(row.pollId);
    if (!entry) {
      entry = { counts: [], myVote: null };
      tally.set(row.pollId, entry);
    }
    entry.counts[row.optionIndex] = (entry.counts[row.optionIndex] ?? 0) + 1;
    if (row.userId === callerId) {
      entry.myVote = row.optionIndex;
    }
  }
  return tally;
}

function buildStats(
  options: string[],
  tally: { counts: number[]; myVote: number | null } | undefined,
): { votes: number[]; totalVotes: number; myVote: number | null } {
  const counts = tally?.counts ?? [];
  const votes = options.map((_, index) => counts[index] ?? 0);
  return {
    votes,
    totalVotes: votes.reduce((sum, count) => sum + count, 0),
    myVote: tally?.myVote ?? null,
  };
}

export async function serializePoll(
  db: Database,
  poll: PollRow,
  callerId: string,
): Promise<SerializedPoll> {
  const options = poll.options as string[];
  const [tallies, creatorRows] = await Promise.all([
    voteTalliesFor(db, [poll.id], callerId),
    db
      .select({ userId: users.id, username: users.username, displayName: users.displayName })
      .from(users)
      .where(eq(users.id, poll.createdBy))
      .limit(1),
  ]);
  const { votes, totalVotes, myVote } = buildStats(options, tallies.get(poll.id));
  return {
    id: poll.id,
    conversationId: poll.conversationId,
    question: poll.question,
    options,
    votes,
    totalVotes,
    myVote,
    closed: isClosed(poll),
    closesAt: poll.closesAt ? poll.closesAt.toISOString() : null,
    createdAt: poll.createdAt.toISOString(),
    createdBy: creatorRows[0]!,
  };
}

export async function createPoll(
  db: Database,
  input: {
    conversationId: string;
    callerId: string;
    question: string;
    options: string[];
    closesAt?: string;
  },
): Promise<SerializedPoll> {
  const { conversation } = await requireConversationAccess(
    db,
    input.conversationId,
    input.callerId,
  );
  if (conversation.type !== 'circle') {
    // Polls are a Circle feature; direct conversations can never have one.
    throw forbidden('Polls are only available in Circles.');
  }
  let closesAt: Date | undefined;
  if (input.closesAt !== undefined) {
    const parsed = new Date(input.closesAt);
    if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
      throw validationFailed();
    }
    closesAt = parsed;
  }
  const inserted = await db
    .insert(polls)
    .values({
      conversationId: input.conversationId,
      createdBy: input.callerId,
      question: input.question,
      // jsonb array of labels; DB CHECK bounds 2–6 entries (docs/DATABASE.md §1.13).
      options: input.options,
      closesAt: closesAt ?? null,
    })
    .returning();
  const poll = inserted[0]!;
  return serializePoll(db, poll, input.callerId);
}

export async function listPolls(
  db: Database,
  conversationId: string,
  callerId: string,
): Promise<SerializedPoll[]> {
  await requireConversationAccess(db, conversationId, callerId);
  const rows = await db
    .select()
    .from(polls)
    .where(eq(polls.conversationId, conversationId))
    .orderBy(desc(polls.createdAt));
  return Promise.all(rows.map((poll) => serializePoll(db, poll, callerId)));
}

/** Active (not closed) polls of one conversation, newest first — Circle Home
 * preview plus the total active count for the View-all affordance. */
export async function activePollsForHome(
  db: Database,
  conversationId: string,
  callerId: string,
  limit = 3,
): Promise<{ activePolls: SerializedPoll[]; activePollsCount: number }> {
  const where = and(
    eq(polls.conversationId, conversationId),
    or(isNull(polls.closesAt), gt(polls.closesAt, sql`now()`)),
  );
  const [rows, countRows] = await Promise.all([
    db.select().from(polls).where(where).orderBy(desc(polls.createdAt)).limit(limit),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(polls)
      .where(where),
  ]);
  const activePolls = await Promise.all(rows.map((poll) => serializePoll(db, poll, callerId)));
  return { activePolls, activePollsCount: countRows[0]?.count ?? 0 };
}

export async function votePoll(
  db: Database,
  input: { pollId: string; callerId: string; optionIndex: number },
): Promise<SerializedPoll> {
  const { poll } = await pollForCaller(db, input.pollId, input.callerId);
  const options = poll.options as string[];
  if (input.optionIndex >= options.length) {
    throw validationFailed();
  }
  if (isClosed(poll)) {
    throw new AppError('POLL_CLOSED', 409, 'This poll is closed.');
  }
  // The composite PK (poll_id, user_id) makes concurrent duplicate votes
  // collapse at the database level; the conflict surfaces as VOTE_EXISTS.
  const inserted = await db
    .insert(pollVotes)
    .values({ pollId: poll.id, userId: input.callerId, optionIndex: input.optionIndex })
    .onConflictDoNothing()
    .returning({ pollId: pollVotes.pollId });
  if (!inserted[0]) {
    throw new AppError('VOTE_EXISTS', 409, 'You have already voted on this poll.');
  }
  return serializePoll(db, poll, input.callerId);
}

/** Vote change is a delete+insert while the poll is open (docs/DATABASE.md
 * §1.14). Removing a non-existent vote is idempotent. */
export async function removeVote(
  db: Database,
  input: { pollId: string; callerId: string },
): Promise<SerializedPoll> {
  const { poll } = await pollForCaller(db, input.pollId, input.callerId);
  if (isClosed(poll)) {
    throw new AppError('POLL_CLOSED', 409, 'This poll is closed.');
  }
  await db
    .delete(pollVotes)
    .where(and(eq(pollVotes.pollId, poll.id), eq(pollVotes.userId, input.callerId)));
  return serializePoll(db, poll, input.callerId);
}

/** Closes a poll early. Per docs/API.md: creator or Circle owner/admin. */
export async function closePoll(
  db: Database,
  input: { pollId: string; callerId: string },
): Promise<SerializedPoll> {
  const { poll, role } = await pollForCaller(db, input.pollId, input.callerId);
  const isCreator = poll.createdBy === input.callerId;
  const isManager = role === 'owner' || role === 'admin';
  if (!isCreator && !isManager) {
    throw forbidden('Only the poll creator or a Circle owner/admin can close a poll.');
  }
  if (isClosed(poll)) {
    throw new AppError('POLL_CLOSED', 409, 'This poll is already closed.');
  }
  const updated = await db
    .update(polls)
    .set({ closesAt: new Date() })
    .where(eq(polls.id, poll.id))
    .returning();
  return serializePoll(db, updated[0]!, input.callerId);
}
