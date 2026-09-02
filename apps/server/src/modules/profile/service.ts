import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Database } from '../../db/client';
import { circleMembers, circles, users } from '../../db/schema';

/**
 * Profile service (docs/API.md, M3). Profile fields live on the existing
 * `users` row (docs/DATABASE.md §1.1) — no separate profiles table.
 *
 * Viewer rule for ANOTHER user's minimal profile: the requester must share at
 * least one active (non-deleted) Circle with the target, or be the target.
 * Username alone never grants access (docs/API.md "access/existence rules
 * apply"), aligning with the approved shared-Circle DM policy (D1).
 */

export interface ProfileRow {
  id: string;
  username: string;
  displayName: string;
  bio: string | null;
  avatarMediaId: string | null;
  createdAt: Date;
}

export async function getProfileById(db: Database, userId: string): Promise<ProfileRow | undefined> {
  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      bio: users.bio,
      avatarMediaId: users.avatarMediaId,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0];
}

export async function getProfileByUsername(
  db: Database,
  username: string,
): Promise<ProfileRow | undefined> {
  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      bio: users.bio,
      avatarMediaId: users.avatarMediaId,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.username, username))
    .limit(1);
  return rows[0];
}

/** True when the two users share at least one active Circle (non-deleted). */
export async function sharesActiveCircle(db: Database, userA: string, userB: string): Promise<boolean> {
  const rows = await db
    .select({ circleId: circleMembers.circleId })
    .from(circleMembers)
    .innerJoin(circles, eq(circles.id, circleMembers.circleId))
    .where(and(eq(circleMembers.userId, userA), isNull(circles.deletedAt)));
  const circleIds = rows.map((row) => row.circleId);
  if (circleIds.length === 0) {
    return false;
  }
  const shared = await db
    .select({ circleId: circleMembers.circleId })
    .from(circleMembers)
    .where(and(eq(circleMembers.userId, userB), inArray(circleMembers.circleId, circleIds)))
    .limit(1);
  return shared.length > 0;
}

export interface ProfileUpdate {
  displayName?: string;
  bio?: string | null;
}

export async function updateProfile(
  db: Database,
  userId: string,
  update: ProfileUpdate,
): Promise<ProfileRow> {
  const rows = await db
    .update(users)
    .set({
      ...(update.displayName !== undefined ? { displayName: update.displayName } : {}),
      ...(update.bio !== undefined ? { bio: update.bio } : {}),
    })
    .where(eq(users.id, userId))
    .returning({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      bio: users.bio,
      avatarMediaId: users.avatarMediaId,
      createdAt: users.createdAt,
    });
  return rows[0]!;
}

export async function assignAvatar(db: Database, userId: string, avatarMediaId: string): Promise<ProfileRow> {
  const rows = await db
    .update(users)
    .set({ avatarMediaId })
    .where(eq(users.id, userId))
    .returning({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      bio: users.bio,
      avatarMediaId: users.avatarMediaId,
      createdAt: users.createdAt,
    });
  return rows[0]!;
}
