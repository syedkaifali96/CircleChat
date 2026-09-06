import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import { AppState, Alert } from 'react-native';
import {
  APP_LOCK_MODES,
  loadAppLockMode,
  saveAppLockMode,
  shouldAppLock,
  type AppLockMode,
} from '../src/auth/appLock';
import {
  clearAppLockPin,
  hasAppLockPin,
  isValidAppLockPin,
  setupAppLockPin,
  verifyAppLockPin,
} from '../src/auth/appLockPin';
import { AppLockProvider, useAppLock } from '../src/auth/AppLockManager';
import LockScreen from '../src/auth/LockScreen';
import AppLockSettingsScreen from '../app/(app)/app-lock';

/**
 * M13 App Lock tests: the PIN is hashed locally with salted Argon2id (PHC
 * string, SecureStore only — nothing server-side exists), the lock policy
 * matches design.md §22 (off/immediately/1m/5m/15m/restart), the provider
 * gates ALL app content behind the LockScreen while locked, biometrics ride
 * the platform API, and the forgot-PIN path signs out and wipes the local
 * lock data so the device can never be permanently locked.
 */

declare global {
  var __appLockStore: Map<string, string>;
  var __appLockSignOut: jest.Mock;
  var __appLockRandom: number;
}

jest.mock('expo-secure-store', () => {
  const map = new Map<string, string>();
  globalThis.__appLockStore = map;
  return {
    setItemAsync: jest.fn(async (key: string, value: string) => {
      map.set(key, value);
    }),
    getItemAsync: jest.fn(async (key: string) => map.get(key) ?? null),
    deleteItemAsync: jest.fn(async (key: string) => {
      map.delete(key);
    }),
  };
});

jest.mock('expo-crypto', () => {
  let counter = 0;
  return {
    getRandomBytesAsync: jest.fn(async (size: number) => {
      counter += 1;
      globalThis.__appLockRandom = counter;
      return new Uint8Array(size).fill(counter);
    }),
  };
});

jest.mock('expo-local-authentication', () => ({
  hasHardwareAsync: jest.fn(async () => false),
  isEnrolledAsync: jest.fn(async () => false),
  authenticateAsync: jest.fn(async () => ({ success: false })),
}));

jest.mock('../src/auth/AuthContext', () => ({
  useAuth: () => ({ signOut: globalThis.__appLockSignOut }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));

import * as LocalAuthentication from 'expo-local-authentication';

const store = () => globalThis.__appLockStore;
const PIN_HASH_KEY = 'circlechat.applock.pin-hash';
const SETTINGS_KEY = 'circlechat.applock.settings';

// Real Argon2id derivations run in these tests (~5 s each under the Babel
// transform) — the default 5 s limit is smaller than one derivation.
jest.setTimeout(120_000);

beforeEach(() => {
  jest.clearAllMocks();
  store().clear();
  globalThis.__appLockSignOut = jest.fn().mockResolvedValue(undefined);
});

describe('app lock PIN hashing (M13)', () => {
  it('verifies the right PIN and rejects the wrong one, storing a PHC Argon2id string', async () => {
    await setupAppLockPin('1234');
    const stored = store().get(PIN_HASH_KEY)!;
    expect(stored.startsWith('$argon2id$v=19$m=19456,t=2,p=1$')).toBe(true);
    expect(await verifyAppLockPin('1234')).toBe(true);
    expect(await verifyAppLockPin('0000')).toBe(false);
    expect(await verifyAppLockPin('12345')).toBe(false);
  });

  it('salts every setup uniquely', async () => {
    await setupAppLockPin('1234');
    const first = store().get(PIN_HASH_KEY)!;
    await setupAppLockPin('1234');
    const second = store().get(PIN_HASH_KEY)!;
    expect(first).not.toBe(second);
    expect(await verifyAppLockPin('1234')).toBe(true);
  });

  it('validates the 4-6 digit rule', () => {
    expect(isValidAppLockPin('1234')).toBe(true);
    expect(isValidAppLockPin('123456')).toBe(true);
    expect(isValidAppLockPin('123')).toBe(false);
    expect(isValidAppLockPin('1234567')).toBe(false);
    expect(isValidAppLockPin('12a4')).toBe(false);
    expect(isValidAppLockPin('')).toBe(false);
  });

  it('clearing the PIN removes verification ability', async () => {
    await setupAppLockPin('9999');
    expect(await hasAppLockPin()).toBe(true);
    await clearAppLockPin();
    expect(await hasAppLockPin()).toBe(false);
    expect(await verifyAppLockPin('9999')).toBe(false);
  });

  it('treats a corrupt stored record as no-match instead of crashing', async () => {
    store().set(PIN_HASH_KEY, 'not-a-phc-string');
    expect(await verifyAppLockPin('1234')).toBe(false);
  });
});

describe('app lock policy (M13, design.md §22)', () => {
  it('round-trips the mode through SecureStore and defaults corrupt values to off', async () => {
    expect(await loadAppLockMode()).toBe('off');
    await saveAppLockMode('after_5m');
    expect(await loadAppLockMode()).toBe('after_5m');
    store().set(SETTINGS_KEY, '{broken json');
    expect(await loadAppLockMode()).toBe('off');
  });

  it('never locks while off', () => {
    for (const coldStart of [true, false]) {
      expect(shouldAppLock('off', { coldStart, backgroundedAtMs: 0, nowMs: 9_999_999 })).toBe(false);
    }
  });

  it('locks on restart mode only for cold starts', () => {
    expect(shouldAppLock('restart', { coldStart: true, backgroundedAtMs: null, nowMs: 1 })).toBe(true);
    expect(shouldAppLock('restart', { coldStart: false, backgroundedAtMs: 1, nowMs: 9_999_999 })).toBe(false);
  });

  it('locks immediately on cold start and on any background', () => {
    expect(shouldAppLock('immediately', { coldStart: true, backgroundedAtMs: null, nowMs: 1 })).toBe(true);
    expect(shouldAppLock('immediately', { coldStart: false, backgroundedAtMs: 5, nowMs: 6 })).toBe(true);
    expect(shouldAppLock('immediately', { coldStart: false, backgroundedAtMs: null, nowMs: 6 })).toBe(false);
  });

  it('applies the 1/5/15-minute thresholds on return from background', () => {
    const bg = 1_000;
    expect(shouldAppLock('after_1m', { coldStart: false, backgroundedAtMs: bg, nowMs: bg + 59_999 })).toBe(false);
    expect(shouldAppLock('after_1m', { coldStart: false, backgroundedAtMs: bg, nowMs: bg + 60_000 })).toBe(true);
    expect(shouldAppLock('after_5m', { coldStart: false, backgroundedAtMs: bg, nowMs: bg + 299_999 })).toBe(false);
    expect(shouldAppLock('after_5m', { coldStart: false, backgroundedAtMs: bg, nowMs: bg + 300_000 })).toBe(true);
    expect(shouldAppLock('after_15m', { coldStart: false, backgroundedAtMs: bg, nowMs: bg + 899_999 })).toBe(false);
    expect(shouldAppLock('after_15m', { coldStart: false, backgroundedAtMs: bg, nowMs: bg + 900_000 })).toBe(true);
    // Every timed mode also locks a fresh launch.
    for (const mode of APP_LOCK_MODES as readonly AppLockMode[]) {
      if (mode !== 'off' && mode !== 'restart') {
        expect(shouldAppLock(mode, { coldStart: true, backgroundedAtMs: null, nowMs: bg })).toBe(true);
      }
    }
  });
});

describe('AppLockProvider gate (M13)', () => {
  let appStateHandler: (state: string) => void;
  let nowMs: number;
  let addEventListenerSpy: jest.SpyInstance;

  beforeEach(() => {
    appStateHandler = () => undefined;
    nowMs = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
    addEventListenerSpy = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation(((event: string, callback: (state: string) => void) => {
        if (event === 'change') {
          appStateHandler = callback;
        }
        return { remove: () => undefined };
      }) as never);
  });

  afterEach(() => {
    addEventListenerSpy.mockRestore();
    (Date.now as jest.Mock).mockRestore();
  });

  function Probe() {
    const { locked, mode, setMode } = useAppLock();
    return (
      <>
        <Text testID="probe-locked">{locked ? 'locked' : 'unlocked'}</Text>
        <Text testID="probe-mode">{mode}</Text>
        <Text
          testID="probe-set-1m"
          onPress={() => void setMode('after_1m')}
        >
          set 1m
        </Text>
      </>
    );
  }

  it('renders children unlocked with no lock configured', async () => {
    render(
      <AppLockProvider>
        <Text testID="app-content">Private content</Text>
        <Probe />
      </AppLockProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('probe-locked').props.children).toBe('unlocked'));
    expect(screen.getByTestId('app-content')).toBeTruthy();
    expect(screen.queryByTestId('app-lock-screen')).toBeNull();
  });

  it('locks a cold start when a PIN and a non-off mode are configured', async () => {
    await setupAppLockPin('1234');
    await saveAppLockMode('after_5m');
    render(
      <AppLockProvider>
        <Text testID="app-content">Private content</Text>
      </AppLockProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('app-lock-screen')).toBeTruthy());
    // Children are NOT mounted — nothing private renders behind the lock.
    expect(screen.queryByTestId('app-content')).toBeNull();
  });

  it('applies the timed threshold on background → active transitions', async () => {
    await setupAppLockPin('1234');
    render(
      <AppLockProvider>
        <Text testID="app-content">Private content</Text>
        <Probe />
      </AppLockProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('app-content')).toBeTruthy());

    fireEvent.press(screen.getByTestId('probe-set-1m'));
    await waitFor(() => expect(screen.getByTestId('probe-mode').props.children).toBe('after_1m'));

    // Short background: no lock.
    appStateHandler('background');
    nowMs += 10_000;
    appStateHandler('active');
    await waitFor(() => expect(screen.getByTestId('probe-locked').props.children).toBe('unlocked'));

    // Past the threshold: the gate engages over all content.
    appStateHandler('background');
    nowMs += 61_000;
    appStateHandler('active');
    await waitFor(() => expect(screen.getByTestId('app-lock-screen')).toBeTruthy());
    expect(screen.queryByTestId('app-content')).toBeNull();
  });

  it('unlocks with the correct PIN and rejects the wrong one', async () => {
    await setupAppLockPin('1234');
    await saveAppLockMode('restart');
    render(
      <AppLockProvider>
        <Text testID="app-content">Private content</Text>
      </AppLockProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('app-lock-screen')).toBeTruthy());

    fireEvent.press(screen.getByTestId('app-lock-unlock-pin'));
    fireEvent.changeText(screen.getByTestId('app-lock-pin-input'), '9999');
    fireEvent.press(screen.getByTestId('app-lock-verify'));
    // Each verification runs a real Argon2id derivation (~5 s under Babel).
    await waitFor(() => expect(screen.getByTestId('app-lock-error')).toBeTruthy(), { timeout: 60_000 });
    expect(screen.queryByTestId('app-content')).toBeNull();

    fireEvent.changeText(screen.getByTestId('app-lock-pin-input'), '1234');
    fireEvent.press(screen.getByTestId('app-lock-verify'));
    await waitFor(() => expect(screen.getByTestId('app-content')).toBeTruthy(), { timeout: 60_000 });
  });

  it('offers biometrics only when the platform supports them, per platform capability', async () => {
    await setupAppLockPin('1234');
    await saveAppLockMode('restart');
    render(
      <AppLockProvider>
        <Text testID="app-content">Private content</Text>
      </AppLockProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('app-lock-screen')).toBeTruthy());
    expect(screen.queryByTestId('app-lock-unlock-biometric')).toBeNull();

    (LocalAuthentication.hasHardwareAsync as jest.Mock).mockResolvedValue(true);
    (LocalAuthentication.isEnrolledAsync as jest.Mock).mockResolvedValue(true);
    (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValue({ success: true });

    const { unmount } = render(
      <AppLockProvider>
        <Text testID="app-content-biometric">Private content</Text>
      </AppLockProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('app-lock-screen')).toBeTruthy());
    fireEvent.press(screen.getByTestId('app-lock-unlock-biometric'));
    await waitFor(() => expect(screen.getByTestId('app-content-biometric')).toBeTruthy());
    unmount();
  });
});

describe('forgot-PIN recovery (M13)', () => {
  it('signs out and wipes the local lock data via the alert flow', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    await setupAppLockPin('1234');
    await saveAppLockMode('after_1m');
    render(<LockScreen onUnlock={() => undefined} />);
    await waitFor(() => expect(screen.getByTestId('app-lock-forgot')).toBeTruthy());

    fireEvent.press(screen.getByTestId('app-lock-forgot'));
    expect(alertSpy).toHaveBeenCalled();
    const [, , buttons] = alertSpy.mock.calls[0] as [string, string, Array<{ text: string; onPress?: () => void }>];
    const signOutButton = buttons.find((button) => button.text !== 'Cancel');
    signOutButton?.onPress?.();

    await waitFor(() => expect(globalThis.__appLockSignOut).toHaveBeenCalled());
    await waitFor(() => expect(store().has(PIN_HASH_KEY)).toBe(false));
    expect(store().get(SETTINGS_KEY)).toBe(JSON.stringify({ mode: 'off' }));
    alertSpy.mockRestore();
  });
});

describe('app lock settings screen (M13)', () => {
  it('renders every documented mode and requests a PIN when none exists', async () => {
    render(
      <AppLockProvider>
        <AppLockSettingsScreen />
      </AppLockProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('app-lock-screen-settings')).toBeTruthy());
    for (const mode of APP_LOCK_MODES) {
      expect(screen.getByTestId(`app-lock-mode-${mode}`)).toBeTruthy();
    }
    expect(screen.getByTestId('app-lock-pin-state').props.children).toContain('No PIN set');

    // Picking a lock mode without a PIN opens the setup form.
    fireEvent.press(screen.getByTestId('app-lock-mode-after_1m'));
    expect(screen.getByTestId('app-lock-setup')).toBeTruthy();

    fireEvent.changeText(screen.getByTestId('app-lock-pin-setup'), '1234');
    fireEvent.changeText(screen.getByTestId('app-lock-pin-confirm'), '4321');
    fireEvent.press(screen.getByTestId('app-lock-pin-save'));
    await waitFor(() => expect(screen.getByTestId('app-lock-error')).toBeTruthy(), { timeout: 60_000 });
    expect(screen.getByTestId('app-lock-error').props.children).toBe('PINs do not match.');

    fireEvent.changeText(screen.getByTestId('app-lock-pin-confirm'), '1234');
    fireEvent.press(screen.getByTestId('app-lock-pin-save'));
    await waitFor(() => expect(store().has(PIN_HASH_KEY)).toBe(true), { timeout: 60_000 });
    await waitFor(() => expect(JSON.parse(store().get(SETTINGS_KEY)!).mode).toBe('after_1m'));
  });

  it('turning App Lock off removes the PIN after confirmation', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert');
    // PIN set but mode off — a configured lock would cold-start into the
    // LockScreen, which is the tested provider behavior, not the settings.
    await setupAppLockPin('1234');
    render(
      <AppLockProvider>
        <AppLockSettingsScreen />
      </AppLockProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('app-lock-screen-settings')).toBeTruthy());

    fireEvent.press(screen.getByTestId('app-lock-mode-off'));
    expect(alertSpy).toHaveBeenCalled();
    const [, , buttons] = alertSpy.mock.calls[0] as [string, string, Array<{ text: string; onPress?: () => void }>];
    buttons.find((button) => button.text === 'Remove')?.onPress?.();

    await waitFor(() => expect(store().has(PIN_HASH_KEY)).toBe(false), { timeout: 60_000 });
    expect(JSON.parse(store().get(SETTINGS_KEY)!).mode).toBe('off');
    alertSpy.mockRestore();
  });
});
