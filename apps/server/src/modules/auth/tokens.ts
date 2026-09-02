import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Opaque session tokens (docs/SECURITY.md §3):
 * - 32 random bytes from crypto.randomBytes, base64url-encoded (raw token).
 * - Server stores only SHA-256(token) in sessions.token_hash.
 * - Timing-safe comparison wherever a secret hash is compared directly.
 * The raw token is returned exactly once (signup/login) and never logged.
 */

export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

/** Timing-safe comparison of two token-hash strings (length-safe). */
export function hashesMatch(a: string, b: string): boolean {
  const bufA = createHash('sha256').update(a, 'utf8').digest();
  const bufB = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(bufA, bufB);
}

/**
 * Constant work factor for unknown usernames: login always performs one
 * Argon2 verification even when the user does not exist, so response timing
 * does not reveal which usernames exist. The dummy hash is derived from a
 * per-process random secret, never from any committed constant.
 */
let dummyHashPromise: Promise<string> | undefined;

export function getDummyPasswordHash(hash: (plain: string) => Promise<string>): Promise<string> {
  dummyHashPromise ??= hash(randomBytes(32).toString('base64url'));
  return dummyHashPromise;
}
