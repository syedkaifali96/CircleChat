import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { loadAppLockMode, saveAppLockMode, type AppLockMode } from './appLock';
import { hasAppLockPin } from './appLockPin';
import LockScreen from './LockScreen';

/**
 * App Lock lifecycle (M13, design.md §22 / docs/ARCHITECTURE.md §2.8): owns
 * the persisted mode + PIN presence, evaluates the documented lock policy on
 * background/foreground transitions and cold start, and renders the LockScreen
 * INSTEAD of the app while locked (no private content ever renders behind it).
 * Locked state is deliberately process-local — it does not survive app
 * restarts, and a fresh launch re-evaluates from the persisted mode.
 */

export const APP_LOCK_STORAGE_KEY = 'circlechat.applock';

interface AppLockContextValue {
  mode: AppLockMode;
  pinConfigured: boolean;
  /**hydrates from SecureStore once on mount. */
  ready: boolean;
  setMode: (mode: AppLockMode) => Promise<void>;
  /** Settings screen calls this after PIN setup/removal to refresh gate state. */
  refreshPinConfigured: () => Promise<void>;
  /** Unlock attempt counter — lets tests/settings observe lock transitions. */
  locked: boolean;
}

const AppLockContext = createContext<AppLockContextValue | undefined>(undefined);

export function AppLockProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<AppLockMode>('off');
  const [pinConfigured, setPinConfigured] = useState(false);
  const [ready, setReady] = useState(false);
  const [locked, setLocked] = useState(false);
  const backgroundedAtRef = useRef<number | null>(null);

  useEffect(() => {
    void (async () => {
      const [loadedMode, hasPin] = await Promise.all([loadAppLockMode(), hasAppLockPin()]);
      setModeState(loadedMode);
      setPinConfigured(hasPin);
      setReady(true);
      // Cold start with App Lock enabled locks immediately — regardless of
      // which account is signed in (lock is device-local, not per-account).
      if (loadedMode !== 'off' && hasPin) {
        setLocked(true);
      }
    })();
  }, []);

  // Refs mirror the values the AppState handler reads: the subscription is
  // created once, so it must always evaluate against the CURRENT mode and
  // PIN presence, never the values captured at mount.
  const modeRef = useRef<AppLockMode>('off');
  const pinConfiguredRef = useRef(false);
  modeRef.current = mode;
  pinConfiguredRef.current = pinConfigured;

  const evaluate = useCallback((nowMs: number) => {
    const currentMode = modeRef.current;
    if (currentMode === 'off' || !pinConfiguredRef.current) {
      setLocked(false);
      return;
    }
    const backgroundedAtMs = backgroundedAtRef.current;
    if (currentMode === 'restart') {
      // Process restart is handled by the cold-start hydration; an alive
      // process returning from the background never re-locks this mode.
      setLocked(false);
      return;
    }
    if (currentMode === 'immediately') {
      setLocked(backgroundedAtMs !== null);
      return;
    }
    const thresholds: Record<string, number> = { after_1m: 60_000, after_5m: 300_000, after_15m: 900_000 };
    setLocked(backgroundedAtMs !== null && nowMs - backgroundedAtMs >= thresholds[currentMode]);
  }, []);

  useEffect(() => {
    if (!ready) {
      return;
    }
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        if (backgroundedAtRef.current !== null) {
          evaluate(Date.now());
          backgroundedAtRef.current = null;
        }
      } else if (state === 'background') {
        backgroundedAtRef.current = Date.now();
      }
    });
    return () => subscription?.remove?.();
  }, [ready, evaluate]);

  const setMode = useCallback(async (next: AppLockMode) => {
    await saveAppLockMode(next);
    setModeState(next);
    if (next === 'off') {
      setLocked(false);
      backgroundedAtRef.current = null;
    }
  }, []);

  const refreshPinConfigured = useCallback(async () => {
    setPinConfigured(await hasAppLockPin());
  }, []);

  const value = useMemo<AppLockContextValue>(
    () => ({ mode, pinConfigured, ready, setMode, refreshPinConfigured, locked }),
    [mode, pinConfigured, ready, setMode, refreshPinConfigured, locked],
  );

  // Gate ALL app content behind the lock screen — children never mount.
  if (ready && locked) {
    return (
      <AppLockContext.Provider value={value}>
        <LockScreen onUnlock={() => setLocked(false)} />
      </AppLockContext.Provider>
    );
  }

  return <AppLockContext.Provider value={value}>{children}</AppLockContext.Provider>;
}

export function useAppLock(): AppLockContextValue {
  const value = useContext(AppLockContext);
  if (!value) {
    throw new Error('useAppLock must be used inside AppLockProvider');
  }
  return value;
}
