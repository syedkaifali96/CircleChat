import * as SecureStore from 'expo-secure-store';

/**
 * App Lock preference storage + lock policy (M13, design.md §22 / docs/
 * ARCHITECTURE.md §2.8): everything is local — SecureStore only, the server
 * has no App-Lock concept. The lock applies to the whole app regardless of
 * which account is signed in; logging out neither reads nor clears it.
 */

export const APP_LOCK_MODES = ['off', 'immediately', 'after_1m', 'after_5m', 'after_15m', 'restart'] as const;

export type AppLockMode = (typeof APP_LOCK_MODES)[number];

export const APP_LOCK_MODE_LABELS: Record<AppLockMode, string> = {
  off: 'Off',
  immediately: 'Immediately',
  after_1m: 'After 1 minute',
  after_5m: 'After 5 minutes',
  after_15m: 'After 15 minutes',
  restart: 'On app restart',
};

export const APP_LOCK_THRESHOLDS_MS: Record<Exclude<AppLockMode, 'off' | 'restart'>, number> = {
  immediately: 0,
  after_1m: 60_000,
  after_5m: 300_000,
  after_15m: 900_000,
};

const SETTINGS_KEY = 'circlechat.applock.settings';

export async function loadAppLockMode(): Promise<AppLockMode> {
  const raw = await SecureStore.getItemAsync(SETTINGS_KEY);
  if (!raw) {
    return 'off';
  }
  try {
    const parsed = JSON.parse(raw) as { mode?: string };
    return APP_LOCK_MODES.includes(parsed.mode as AppLockMode) ? (parsed.mode as AppLockMode) : 'off';
  } catch {
    return 'off';
  }
}

export async function saveAppLockMode(mode: AppLockMode): Promise<void> {
  await SecureStore.setItemAsync(SETTINGS_KEY, JSON.stringify({ mode }));
}

/**
 * Pure lock decision (design.md §22). `coldStart` is true for the initial
 * mount of the app process: every enabled mode locks a fresh launch, because
 * elapsed-background time is unknowable after a process death. `restart` locks
 * ONLY on cold start — returning from the background with the process alive
 * never re-locks it.
 */
export function shouldAppLock(
  mode: AppLockMode,
  { coldStart, backgroundedAtMs, nowMs }: { coldStart: boolean; backgroundedAtMs: number | null; nowMs: number },
): boolean {
  if (mode === 'off') {
    return false;
  }
  if (mode === 'restart') {
    return coldStart;
  }
  if (coldStart) {
    return true;
  }
  if (backgroundedAtMs === null) {
    return false;
  }
  if (mode === 'immediately') {
    return true;
  }
  const threshold = APP_LOCK_THRESHOLDS_MS[mode];
  return nowMs - backgroundedAtMs >= threshold;
}
