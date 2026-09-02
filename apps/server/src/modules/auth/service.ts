import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Database } from '../../db/client';
import { sessions, users } from '../../db/schema';
import { generateSessionToken, hashSessionToken, hashesMatch } from './tokens';

/**
 * Session and credential persistence for authentication (docs/SECURITY.md §3).
 * Raw session tokens exist only in the return value of createSession; the
 * database stores SHA-256 hashes exclusively. Hash comparisons are timing-safe.
 */

export interface PublicUserRow {
  id: string;
  username: string;
  displayName: string;
  bio: string | null;
  avatarMediaId: string | null;
  createdAt: Date;
}

export interface CreatedSession {
  sessionId: string;
  /** Raw token — return to the client exactly once. */
  token: string;
  expiresAt: Date;
}

export async function findUserByUsername(
  db: Database,
  username: string,
): Promise<PublicUserRow & { passwordHash: string; recoveryCodeHash: string } | undefined> {
  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      bio: users.bio,
      avatarMediaId: users.avatarMediaId,
      createdAt: users.createdAt,
      passwordHash: users.passwordHash,
      recoveryCodeHash: users.recoveryCodeHash,
    })
    .from(users)
    .where(eq(users.username, username))
    .limit(1);
  return rows[0];
}

export async function findUserById(db: Database, userId: string): Promise<PublicUserRow | undefined> {
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

export async function createSession(
  db: Database,
  input: { userId: string; deviceName: string; platform: string; ttlDays: number },
): Promise<CreatedSession> {
  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  const rows = await db
    .insert(sessions)
    .values({
      userId: input.userId,
      tokenHash,
      deviceName: input.deviceName,
      platform: input.platform,
      expiresAt: sql`now() + (${input.ttlDays} * interval '1 day')`,
    })
    .returning({ id: sessions.id, expiresAt: sessions.expiresAt });
  const row = rows[0]!;
  return { sessionId: row.id, token, expiresAt: row.expiresAt };
}

export interface ValidatedSession {
  sessionId: string;
  userId: string;
}

/**
 * Validates a raw bearer token: looks up the non-revoked, unexpired session by
 * stored hash, re-confirms the hash timing-safely, then applies the sliding
 * expiry (throttled to refresh only when less than ttl-1 day remains).
 */
export async function validateSession(
  db: Database,
  rawToken: string,
  ttlDays: number,
): Promise<ValidatedSession | undefined> {
  const tokenHash = hashSessionToken(rawToken);
  const rows = await db
    .select({ id: sessions.id, userId: sessions.userId, tokenHash: sessions.tokenHash })
    .from(sessions)
    .where(and(isNull(sessions.revokedAt), gt(sessions.expiresAt, sql`now()`), eq(sessions.tokenHash, tokenHash)))
    .limit(1);
  const row = rows[0];
  if (!row || !hashesMatch(row.tokenHash, tokenHash)) {
    return undefined;
  }
  await db
    .update(sessions)
    .set({
      lastActiveAt: sql`now()`,
      expiresAt: sql`now() + (${ttlDays} * interval '1 day')`,
    })
    .where(
      and(eq(sessions.id, row.id), sql`${sessions.expiresAt} < now() + (${ttlDays - 1} * interval '1 day')`),
    );
  return { sessionId: row.id, userId: row.userId };
}

export async function revokeSession(db: Database, sessionId: string): Promise<boolean> {
  const rows = await db
    .update(sessions)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  return rows.length > 0;
}

export async function revokeAllOtherSessions(db: Database, userId: string, keepSessionId: string): Promise<number> {
  const rows = await db
    .update(sessions)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), sql`${sessions.id} <> ${keepSessionId}`))
    .returning({ id: sessions.id });
  return rows.length;
}

export async function revokeAllSessions(db: Database, userId: string): Promise<number> {
  const rows = await db
    .update(sessions)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  return rows.length;
}

export async function listActiveSessions(db: Database, userId: string) {
  return db
    .select({
      id: sessions.id,
      deviceName: sessions.deviceName,
      platform: sessions.platform,
      createdAt: sessions.createdAt,
      lastActiveAt: sessions.lastActiveAt,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, sql`now()`)))
    .orderBy(sql`${sessions.lastActiveAt} DESC`);
}

export async function getPasswordHash(db: Database, userId: string): Promise<string> {
  const rows = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, userId)).limit(1);
  return rows[0]!.passwordHash;
}

export async function updatePasswordHash(db: Database, userId: string, passwordHash: string): Promise<void> {
  await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
}

export async function updateRecoveryCodeHash(db: Database, userId: string, recoveryCodeHash: string): Promise<void> {
  await db.update(users).set({ recoveryCodeHash }).where(eq(users.id, userId));
}
