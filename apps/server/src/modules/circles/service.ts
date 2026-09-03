import { randomBytes } from 'node:crypto';
import { createHash } from 'node:crypto';
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import type { Database } from '../../db/client';
import {
  circleMembers,
  circleSettings,
  circles,
  conversations,
  users,
} from '../../db/schema';
import { AppError, notFound } from '../../errors';

/**
 * Circle service (M4) — docs/DATABASE.md §1.2–1.4, §3 and docs/API.md.
 *
 * Security invariants enforced here:
 * - The 5-member join runs in ONE transaction: SELECT ... FOR UPDATE locks the
 *   Circle row, then a conditional insert checks capacity. The database
 *   trigger and CHECK are additional layers; a trigger violation maps to
 *   CIRCLE_FULL.
 * - Raw invite codes are generated with CSPRNG, shown exactly once, and only
 *   their SHA-256 hash is stored (unique, partial where not null).
 * - Ownership transfer is one transaction that preserves exactly one owner.
 */

const INVITE_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export interface CircleRow {
  id: string;
  name: string;
  description: string | null;
  avatarMediaId: string | null;
  createdBy: string;
  membersCount: number;
  inviteCodeHash: string | null;
  inviteExpiresAt: Date | null;
  createdAt: Date;
  deletedAt: Date | null;
}

export async function findCircleById(db: Database, circleId: string): Promise<CircleRow | undefined> {
  const rows = await db.select().from(circles).where(eq(circles.id, circleId)).limit(1);
  return rows[0];
}

export async function getCallerRole(
  db: Pick<Database, 'select'>,
  circleId: string,
  userId: string,
): Promise<string | undefined> {
  const rows = await db
    .select({ role: circleMembers.role })
    .from(circleMembers)
    .where(and(eq(circleMembers.circleId, circleId), eq(circleMembers.userId, userId)))
    .limit(1);
  return rows[0]?.role;
}

export async function listMyCircles(db: Database, userId: string) {
  return db
    .select({
      id: circles.id,
      name: circles.name,
      description: circles.description,
      avatarMediaId: circles.avatarMediaId,
      membersCount: circles.membersCount,
      role: circleMembers.role,
    })
    .from(circleMembers)
    .innerJoin(circles, eq(circles.id, circleMembers.circleId))
    .where(and(eq(circleMembers.userId, userId), isNull(circles.deletedAt)))
    .orderBy(circles.createdAt);
}

export async function listMembers(db: Database, circleId: string) {
  return db
    .select({
      userId: users.id,
      username: users.username,
      displayName: users.displayName,
      role: circleMembers.role,
      joinedAt: circleMembers.joinedAt,
    })
    .from(circleMembers)
    .innerJoin(users, eq(users.id, circleMembers.userId))
    .where(eq(circleMembers.circleId, circleId))
    .orderBy(circleMembers.joinedAt);
}

export async function createCircle(
  db: Database,
  input: {
    ownerId: string;
    name: string;
    description?: string | null;
    avatarMediaId?: string;
  },
): Promise<CircleRow> {
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(circles)
      .values({
        name: input.name,
        description: input.description ?? null,
        avatarMediaId: input.avatarMediaId ?? null,
        createdBy: input.ownerId,
        membersCount: 1,
      })
      .returning();
    const circle = inserted[0]!;
    await tx.insert(circleMembers).values({
      circleId: circle.id,
      userId: input.ownerId,
      role: 'owner',
    });
    await tx.insert(circleSettings).values({ circleId: circle.id });
    // Every Circle gets exactly one conversation (docs/DATABASE.md §1.5).
    await tx.insert(conversations).values({ type: 'circle', circleId: circle.id });
    return circle;
  });
}

/** Crockford-style invite code (same alphabet as recovery codes). */
export function generateInviteCode(): string {
  const bytes = randomBytes(12);
  let code = '';
  for (let i = 0; i < 12; i++) {
    code += INVITE_ALPHABET[bytes[i]! % INVITE_ALPHABET.length];
    if (i === 3 || i === 7) {
      code += '-';
    }
  }
  return code;
}

/**
 * Canonical invite-code form: uppercase, separators/whitespace stripped.
 * Every hash lookup AND the stored hash use this form, so users can type the
 * code with or without dashes/case and still match.
 */
export function normalizeInviteCode(code: string): string {
  return code.toUpperCase().replace(/[\s-]/g, '');
}

export function hashInviteCode(code: string): string {
  return createHash('sha256').update(normalizeInviteCode(code), 'utf8').digest('hex');
}

export async function createInvite(
  db: Database,
  input: { circleId: string; expiresInDays: number },
): Promise<string> {
  const rawCode = generateInviteCode();
  const codeHash = hashInviteCode(rawCode);
  const rows = await db
    .update(circles)
    .set({
      inviteCodeHash: codeHash,
      inviteExpiresAt: new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000),
    })
    .where(and(eq(circles.id, input.circleId), isNull(circles.deletedAt)))
    .returning({ id: circles.id });
  if (rows.length === 0) {
    throw notFound('Circle not found.');
  }
  return rawCode;
}

export async function revokeInvite(db: Database, circleId: string): Promise<boolean> {
  const rows = await db
    .update(circles)
    .set({ inviteCodeHash: null, inviteExpiresAt: null })
    .where(and(eq(circles.id, circleId), isNotNull(circles.inviteCodeHash)))
    .returning({ id: circles.id });
  return rows.length > 0;
}

export interface InvitePreview {
  name: string;
  memberCount: number;
  avatarMediaId: string | null;
}

/** Validates hash + expiry + revocation + capacity; limited fields only. */
export async function resolveInvitePreview(
  db: Database,
  rawCode: string,
): Promise<InvitePreview | undefined> {
  // The normalized 12-char shape is the code contract; a different length can
  // never hash-match an issued code, so skip the lookup entirely.
  if (rawCode.length !== 12) {
    return undefined;
  }
  const rows = await db
    .select({
      id: circles.id,
      name: circles.name,
      memberCount: circles.membersCount,
      avatarMediaId: circles.avatarMediaId,
      expiresAt: circles.inviteExpiresAt,
    })
    .from(circles)
    .where(and(eq(circles.inviteCodeHash, hashInviteCode(rawCode)), isNull(circles.deletedAt)))
    .limit(1);
  const circle = rows[0];
  if (!circle) {
    return undefined; // no matching hash: invalid or revoked
  }
  if (circle.expiresAt && circle.expiresAt.getTime() < Date.now()) {
    return undefined; // expired
  }
  return {
    name: circle.name,
    memberCount: circle.memberCount,
    avatarMediaId: circle.avatarMediaId,
  };
}

export interface JoinOutcome {
  circleId: string;
}

/**
 * The documented join procedure (docs/DATABASE.md §1.3, §3): ONE transaction —
 * lock the Circle row with FOR UPDATE, verify the invite is still valid and
 * the Circle has capacity, then insert the membership. The database trigger +
 * CHECK are additional layers; a trigger violation maps to CIRCLE_FULL.
 */
export async function joinCircle(
  db: Database,
  input: { userId: string; rawCode: string },
): Promise<JoinOutcome> {
  return db.transaction(async (tx) => {
    const locked = await tx
      .select({
        id: circles.id,
        membersCount: circles.membersCount,
        inviteExpiresAt: circles.inviteExpiresAt,
      })
      .from(circles)
      .where(
        and(
          eq(circles.inviteCodeHash, hashInviteCode(input.rawCode)),
          isNull(circles.deletedAt),
        ),
      )
      .for('update')
      .limit(1);
    const circle = locked[0];
    if (!circle) {
      throw new AppError('INVALID_INVITE', 404, 'This invite is not valid.');
    }
    if (circle.inviteExpiresAt && circle.inviteExpiresAt.getTime() < Date.now()) {
      throw new AppError('INVITE_EXPIRED', 410, 'This invite has expired.');
    }
    const existing = await tx
      .select({ role: circleMembers.role })
      .from(circleMembers)
      .where(and(eq(circleMembers.circleId, circle.id), eq(circleMembers.userId, input.userId)))
      .limit(1);
    if (existing.length > 0) {
      throw new AppError('ALREADY_MEMBER', 409, 'You are already a member of this Circle.');
    }
    if (circle.membersCount >= 5) {
      throw new AppError('CIRCLE_FULL', 409, 'This Circle is full.');
    }
    const inserted = await tx
      .insert(circleMembers)
      .values({ circleId: circle.id, userId: input.userId, role: 'member' })
      .returning({ circleId: circleMembers.circleId });
    return { circleId: inserted[0]!.circleId };
  });
}

export async function leaveCircle(db: Database, input: { circleId: string; userId: string }): Promise<void> {
  const role = await getCallerRole(db, input.circleId, input.userId);
  if (!role) {
    throw notFound('Circle not found.');
  }
  if (role === 'owner') {
    // The last owner cannot leave without transferring ownership first.
    throw new AppError(
      'OWNER_MUST_TRANSFER',
      409,
      'Transfer ownership before leaving the Circle.',
    );
  }
  await db
    .delete(circleMembers)
    .where(and(eq(circleMembers.circleId, input.circleId), eq(circleMembers.userId, input.userId)));
}

export async function removeMember(
  db: Database,
  input: { circleId: string; callerId: string; targetUserId: string },
): Promise<void> {
  const callerRole = await getCallerRole(db, input.circleId, input.callerId);
  if (!callerRole || (callerRole !== 'owner' && callerRole !== 'admin')) {
    throw notFound('Circle not found.');
  }
  const targetRole = await getCallerRole(db, input.circleId, input.targetUserId);
  if (!targetRole) {
    return; // not a member: nothing to do (idempotent, no existence leak)
  }
  if (targetRole === 'owner') {
    throw new AppError('CANNOT_REMOVE_OWNER', 409, 'The owner cannot be removed.');
  }
  // Admins cannot remove other admins (owner does that).
  if (callerRole === 'admin' && targetRole === 'admin') {
    throw new AppError('FORBIDDEN', 403, 'You do not have access to this resource.');
  }
  await db
    .delete(circleMembers)
    .where(
      and(eq(circleMembers.circleId, input.circleId), eq(circleMembers.userId, input.targetUserId)),
    );
}

export async function updateMemberRole(
  db: Database,
  input: { circleId: string; callerId: string; targetUserId: string; role: 'admin' | 'member' },
): Promise<void> {
  const callerRole = await getCallerRole(db, input.circleId, input.callerId);
  if (callerRole !== 'owner') {
    throw notFound('Circle not found.');
  }
  const targetRole = await getCallerRole(db, input.circleId, input.targetUserId);
  if (!targetRole || targetRole === 'owner') {
    throw new AppError('CANNOT_MODIFY_OWNER', 409, 'The owner role cannot be changed.');
  }
  await db
    .update(circleMembers)
    .set({ role: input.role })
    .where(and(eq(circleMembers.circleId, input.circleId), eq(circleMembers.userId, input.targetUserId)));
}

/**
 * Atomic ownership transfer (docs/DATABASE.md §3): one transaction — lock the
 * Circle, verify the target is an active member, demote the old owner,
 * promote the target. Exactly one owner exists before and after.
 */
export async function transferOwnership(
  db: Database,
  input: { circleId: string; callerId: string; newOwnerUserId: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const locked = await tx
      .select({ id: circles.id })
      .from(circles)
      .where(and(eq(circles.id, input.circleId), isNull(circles.deletedAt)))
      .for('update')
      .limit(1);
    if (!locked[0]) {
      throw notFound('Circle not found.');
    }
    const callerRole = await getCallerRole(tx, input.circleId, input.callerId);
    if (callerRole !== 'owner') {
      throw notFound('Circle not found.');
    }
    if (input.newOwnerUserId === input.callerId) {
      return; // transferring to self is a no-op
    }
    const targetRole = await getCallerRole(tx, input.circleId, input.newOwnerUserId);
    if (!targetRole) {
      throw new AppError('NOT_A_MEMBER', 404, 'The new owner must be an active member.');
    }
    await tx
      .update(circleMembers)
      .set({ role: 'admin' })
      .where(and(eq(circleMembers.circleId, input.circleId), eq(circleMembers.userId, input.callerId)));
    await tx
      .update(circleMembers)
      .set({ role: 'owner' })
      .where(and(eq(circleMembers.circleId, input.circleId), eq(circleMembers.userId, input.newOwnerUserId)));
  });
}

export async function updateCircleDetails(
  db: Database,
  input: { circleId: string; callerId: string; name?: string; description?: string | null },
): Promise<CircleRow> {
  const callerRole = await getCallerRole(db, input.circleId, input.callerId);
  if (!callerRole || (callerRole !== 'owner' && callerRole !== 'admin')) {
    throw notFound('Circle not found.');
  }
  const rows = await db
    .update(circles)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
    })
    .where(and(eq(circles.id, input.circleId), isNull(circles.deletedAt)))
    .returning();
  return rows[0]!;
}

/** Owner-only soft delete (docs/API.md). */
export async function deleteCircle(
  db: Database,
  input: { circleId: string; callerId: string },
): Promise<void> {
  const callerRole = await getCallerRole(db, input.circleId, input.callerId);
  if (callerRole !== 'owner') {
    throw notFound('Circle not found.');
  }
  await db
    .update(circles)
    .set({ deletedAt: new Date(), inviteCodeHash: null, inviteExpiresAt: null })
    .where(and(eq(circles.id, input.circleId), isNull(circles.deletedAt)));
}

export async function getCircleSettings(db: Database, circleId: string) {
  const rows = await db
    .select()
    .from(circleSettings)
    .where(eq(circleSettings.circleId, circleId))
    .limit(1);
  return rows[0];
}

export async function updateCircleSettings(
  db: Database,
  input: {
    circleId: string;
    callerId: string;
    themePreset?: string;
    accentColor?: string | null;
    backgroundKey?: string | null;
  },
): Promise<void> {
  const callerRole = await getCallerRole(db, input.circleId, input.callerId);
  if (!callerRole || (callerRole !== 'owner' && callerRole !== 'admin')) {
    throw notFound('Circle not found.');
  }
  await db
    .update(circleSettings)
    .set({
      ...(input.themePreset !== undefined ? { themePreset: input.themePreset } : {}),
      ...(input.accentColor !== undefined ? { accentColor: input.accentColor } : {}),
      ...(input.backgroundKey !== undefined ? { backgroundKey: input.backgroundKey } : {}),
      updatedAt: new Date(),
    })
    .where(eq(circleSettings.circleId, input.circleId));
}

/** Ids of the user's active Circles (used by the profile viewer rule). */
export async function activeCircleIdsForUser(db: Database, userId: string): Promise<string[]> {
  const rows = await db
    .select({ circleId: circleMembers.circleId })
    .from(circleMembers)
    .innerJoin(circles, eq(circles.id, circleMembers.circleId))
    .where(and(eq(circleMembers.userId, userId), isNull(circles.deletedAt)));
  return rows.map((row) => row.circleId);
}

export async function usersSharingAnyCircle(
  db: Database,
  circleIds: string[],
): Promise<string[]> {
  if (circleIds.length === 0) {
    return [];
  }
  const rows = await db
    .select({ userId: circleMembers.userId })
    .from(circleMembers)
    .where(inArray(circleMembers.circleId, circleIds));
  return [...new Set(rows.map((row) => row.userId))];
}
