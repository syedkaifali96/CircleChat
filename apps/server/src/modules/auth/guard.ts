/**
 * Per-username login failure guard (docs/SECURITY.md §6): after
 * MAX_FAILURES consecutive failed logins for one username, that username is
 * locked out for LOCKOUT_MS. This complements the per-IP rate limiter, which
 * cannot distinguish attackers rotating IPs. In-memory by design (single
 * server instance; docs/SECURITY.md §13).
 */
const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;

interface FailureRecord {
  failures: number[];
  blockedUntil?: number;
}

const records = new Map<string, FailureRecord>();

function now(): number {
  return Date.now();
}

export function isBlocked(username: string): number {
  const record = records.get(username.toLowerCase());
  if (!record?.blockedUntil) {
    return 0;
  }
  const remaining = record.blockedUntil - now();
  if (remaining <= 0) {
    records.delete(username.toLowerCase());
    return 0;
  }
  return Math.ceil(remaining / 1000);
}

export function recordFailure(username: string): void {
  const key = username.toLowerCase();
  const record = records.get(key) ?? { failures: [] };
  const cutoff = now() - FAILURE_WINDOW_MS;
  record.failures = record.failures.filter((t) => t > cutoff);
  record.failures.push(now());
  if (record.failures.length >= MAX_FAILURES) {
    record.blockedUntil = now() + LOCKOUT_MS;
  }
  records.set(key, record);
}

export function clearFailures(username: string): void {
  records.delete(username.toLowerCase());
}

/** Test-only: reset all state. */
export function resetLoginGuard(): void {
  records.clear();
}
