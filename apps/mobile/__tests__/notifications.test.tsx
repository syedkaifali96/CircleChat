import { render, screen, waitFor, act, fireEvent } from '@testing-library/react-native';
import NotificationSettingsScreen from '../app/(app)/notification-settings';
import { PushManager } from '../src/lib/PushManager';
import {
  extractNotificationTap,
  getPermissionStatus,
  onNotificationTap,
  registerForPushNotifications,
  unregisterPushNotifications,
} from '../src/lib/notifications';
import * as apiModule from '../src/lib/api';

/**
 * M8 mobile notification tests: OS permission states, push registration on
 * the caller's session, notification tap routing (warm + cold start, stale
 * taps ignored), the app-wide PushManager wiring, and the notification
 * settings screen (global toggle, preview privacy, failure revert).
 * expo-notifications/expo-device are mocked — real push delivery is proven by
 * the server integration tests.
 */

// Controlled auth status for PushManager tests (set per test). jest hoists
// mock factories above this declaration, but factories execute lazily — the
// `mock` prefix satisfies babel-plugin-jest-hoist's scope check.
let mockAuthStatus: 'authenticated' | 'unauthenticated' = 'unauthenticated';
// Mirrors Device.isDevice for the emulator test (read via the mock's getter).
let mockDeviceIsDevice = true;

jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest factory must be CJS
  const { Text: RNText } = require('react-native');
  // One stable router instance so tests can assert navigation calls.
  const push = jest.fn();
  return {
    Link: ({ children, testID }: { children: React.ReactNode; testID?: string }) => (
      <RNText testID={testID}>{children}</RNText>
    ),
    Redirect: ({ href }: { href: string }) => <RNText testID="redirect">{href}</RNText>,
    useRouter: () => ({ push, replace: jest.fn(), back: jest.fn() }),
    useFocusEffect: (cb: () => void) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest factory must be CJS
      const { useEffect } = require('react');
      useEffect(() => {
        cb();
      }, [cb]);
    },
    __push: push,
  };
});

jest.mock('../src/auth/AuthContext', () => ({
  useAuth: () => ({ status: mockAuthStatus }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('expo-notifications', () => {
  let tapListener: ((response: unknown) => void) | null = null;
  let lastResponse: unknown = null;
  return {
    setNotificationHandler: jest.fn(),
    getPermissionsAsync: jest.fn(),
    requestPermissionsAsync: jest.fn(),
    getExpoPushTokenAsync: jest.fn(),
    addNotificationResponseReceivedListener: jest.fn((cb: (response: unknown) => void) => {
      tapListener = cb;
      return { remove: () => {
        tapListener = null;
      } };
    }),
    getLastNotificationResponseAsync: jest.fn(() => Promise.resolve(lastResponse)),
    __emitTap: (response: unknown) => tapListener?.(response),
    __setLastResponse: (response: unknown) => {
      lastResponse = response;
    },
    __reset: () => {
      tapListener = null;
      lastResponse = null;
    },
  };
});

jest.mock('expo-device', () => ({
  // Getter so tests can flip it (emulator case) — expo-device exposes
  // `isDevice` as a live ES-module binding, not a writable property.
  get isDevice() {
    return mockDeviceIsDevice;
  },
}));

jest.mock('../src/lib/api', () => ({
  ApiError: class ApiError extends Error {
    code: string;
    statusCode: number;
    constructor(code: string, statusCode: number, message: string) {
      super(message);
      this.code = code;
      this.statusCode = statusCode;
    }
  },
  fetchNotificationSettings: jest.fn(),
  updateNotificationSettings: jest.fn(),
  registerPushTokenForSession: jest.fn(),
  unregisterPushTokenForSession: jest.fn(),
}));

jest.mock('../src/auth/session', () => ({
  loadSessionToken: jest.fn().mockResolvedValue('test-token'),
  saveSessionToken: jest.fn(),
  clearSessionToken: jest.fn(),
}));

const mockApi = apiModule as unknown as jest.Mocked<typeof apiModule>;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- mock's test hooks
const expoNotifications = require('expo-notifications');


// eslint-disable-next-line @typescript-eslint/no-require-imports -- mock's stable router handle
const expoRouter = require('expo-router');

beforeEach(() => {
  jest.clearAllMocks();
  expoNotifications.__reset();
  mockDeviceIsDevice = true;
  mockAuthStatus = 'unauthenticated';
});

// ---------------------------------------------------------------------------
// src/lib/notifications — permission + registration
// ---------------------------------------------------------------------------

describe('push permission states (M8)', () => {
  it('reports granted when the OS has already granted', async () => {
    expoNotifications.getPermissionsAsync.mockResolvedValue({ granted: true, status: 'granted' });
    await expect(getPermissionStatus()).resolves.toBe('granted');
  });

  it('reports denied without re-requesting (no permission spam)', async () => {
    expoNotifications.getPermissionsAsync.mockResolvedValue({ granted: false, status: 'denied' });
    await expect(getPermissionStatus()).resolves.toBe('denied');
    expect(expoNotifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('reports unavailable on emulators (push needs a physical device)', async () => {
    mockDeviceIsDevice = false;
    await expect(getPermissionStatus()).resolves.toBe('unavailable');
    expect(expoNotifications.getPermissionsAsync).not.toHaveBeenCalled();
  });

  it('registers the token on the session after the user grants permission', async () => {
    expoNotifications.getPermissionsAsync.mockResolvedValue({ granted: false, status: 'undetermined' });
    expoNotifications.requestPermissionsAsync.mockResolvedValue({ granted: true });
    expoNotifications.getExpoPushTokenAsync.mockResolvedValue({ data: 'ExpoPushToken[register-me]' });
    mockApi.registerPushTokenForSession.mockResolvedValue({ ok: true });

    await expect(registerForPushNotifications('session-token')).resolves.toBe('granted');
    expect(mockApi.registerPushTokenForSession).toHaveBeenCalledWith('session-token', 'ExpoPushToken[register-me]');
  });

  it('returns denied when permission is refused and never calls the API', async () => {
    // requestPermissionsAsync resolves with a full PermissionResponse; the lib
    // then re-reads the OS state, so the post-request read must also be denied.
    expoNotifications.getPermissionsAsync
      .mockResolvedValueOnce({ granted: false, status: 'undetermined' })
      .mockResolvedValueOnce({ granted: false, status: 'denied' });
    expoNotifications.requestPermissionsAsync.mockResolvedValue({ granted: false, status: 'denied' });

    await expect(registerForPushNotifications('session-token')).resolves.toBe('denied');
    expect(expoNotifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(mockApi.registerPushTokenForSession).not.toHaveBeenCalled();
  });

  it('survives token acquisition failures as unavailable (push is best-effort)', async () => {
    expoNotifications.getPermissionsAsync.mockResolvedValue({ granted: true });
    expoNotifications.getExpoPushTokenAsync.mockRejectedValue(new Error('no projectId'));
    await expect(registerForPushNotifications('session-token')).resolves.toBe('unavailable');
  });

  it('unregisters best-effort without throwing on API failure', async () => {
    mockApi.unregisterPushTokenForSession.mockRejectedValue(new Error('network down'));
    await expect(unregisterPushNotifications('session-token')).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tap routing — warm start listener, cold start response, stale taps ignored
// ---------------------------------------------------------------------------

describe('notification tap routing (M8)', () => {
  const tapPayload = (conversationId: string, date = Date.now()) => ({
    // expo shape: notification.date is the cold-start freshness marker the lib
    // reads; request.content.data carries the deep-link ids.
    notification: { date, request: { content: { data: { conversationId } } } },
  });

  it('extracts the conversation id and ignores payloads without one', () => {
    expect(extractNotificationTap(tapPayload('conv-9') as never)).toEqual({ conversationId: 'conv-9' });
    expect(
      extractNotificationTap({ notification: { request: { content: { data: {} } } } } as never),
    ).toBeNull();
  });

  it('routes warm-start taps through the handler', () => {
    const handler = jest.fn();
    onNotificationTap(handler);
    act(() => {
      expoNotifications.__emitTap(tapPayload('conv-1'));
    });
    expect(handler).toHaveBeenCalledWith({ conversationId: 'conv-1' });
  });

  it('routes fresh cold-start taps (app opened by the notification)', async () => {
    expoNotifications.__setLastResponse(tapPayload('conv-2'));
    const handler = jest.fn();
    onNotificationTap(handler);
    await waitFor(() => expect(handler).toHaveBeenCalledWith({ conversationId: 'conv-2' }));
  });

  it('ignores stale cold-start responses (old last-notification)', async () => {
    expoNotifications.__setLastResponse(tapPayload('conv-3', Date.now() - 120_000));
    const handler = jest.fn();
    onNotificationTap(handler);
    await waitFor(() => expect(expoNotifications.getLastNotificationResponseAsync).toHaveBeenCalled());
    expect(handler).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// PushManager — app-wide registration + navigation wiring
// ---------------------------------------------------------------------------

describe('PushManager (M8)', () => {
  it('navigates to the tapped conversation screen', async () => {
    expoNotifications.__setLastResponse(tapPayloadOf('conv-7'));
    render(<PushManager />);
    await waitFor(() => expect(expoRouter.__push).toHaveBeenCalledWith('/(app)/chats/conv-7'));
  });

  it('registers pushes once per session while authenticated', async () => {
    expoNotifications.getPermissionsAsync.mockResolvedValue({ granted: true });
    expoNotifications.getExpoPushTokenAsync.mockResolvedValue({ data: 'ExpoPushToken[pwid]' });
    mockApi.registerPushTokenForSession.mockResolvedValue({ ok: true });

    mockAuthStatus = 'authenticated';
    const { rerender } = render(<PushManager />);
    await waitFor(() => expect(mockApi.registerPushTokenForSession).toHaveBeenCalledTimes(1));
    // Re-renders within the same session must not re-register.
    rerender(<PushManager />);
    expect(mockApi.registerPushTokenForSession).toHaveBeenCalledTimes(1);
  });

  it('clears registration state on logout (registers again on next login)', async () => {
    expoNotifications.getPermissionsAsync.mockResolvedValue({ granted: true });
    expoNotifications.getExpoPushTokenAsync.mockResolvedValue({ data: 'ExpoPushToken[pwid]' });
    mockApi.registerPushTokenForSession.mockResolvedValue({ ok: true });

    mockAuthStatus = 'authenticated';
    const { rerender } = render(<PushManager />);
    await waitFor(() => expect(mockApi.registerPushTokenForSession).toHaveBeenCalledTimes(1));

    mockAuthStatus = 'unauthenticated';
    rerender(<PushManager />);
    mockAuthStatus = 'authenticated';
    rerender(<PushManager />);
    await waitFor(() => expect(mockApi.registerPushTokenForSession).toHaveBeenCalledTimes(2));
  });

  it('does not register while unauthenticated', () => {
    mockAuthStatus = 'unauthenticated';
    render(<PushManager />);
    expect(mockApi.registerPushTokenForSession).not.toHaveBeenCalled();
  });
});

function tapPayloadOf(conversationId: string, date = Date.now()) {
  return { notification: { date, request: { content: { data: { conversationId } } } } };
}

// ---------------------------------------------------------------------------
// Notification settings screen — global toggle, preview privacy, failures
// ---------------------------------------------------------------------------

describe('notification settings screen (M8)', () => {
  it('loads settings, shows both toggles and the permission state', async () => {
    mockApi.fetchNotificationSettings.mockResolvedValue({
      settings: { notificationsEnabled: true, notificationPreview: false },
    });
    expoNotifications.getPermissionsAsync.mockResolvedValue({ granted: true, status: 'granted' });
    expoNotifications.getExpoPushTokenAsync.mockResolvedValue({ data: 'ExpoPushToken[screen]' });
    mockApi.registerPushTokenForSession.mockResolvedValue({ ok: true });

    render(<NotificationSettingsScreen />);

    await waitFor(() => expect(screen.getByTestId('notif-settings-screen')).toBeTruthy());
    expect(screen.getByTestId('toggle-global')).toBeTruthy();
    expect(screen.getByTestId('toggle-preview')).toBeTruthy();
    expect(mockApi.fetchNotificationSettings).toHaveBeenCalled();
  });

  it('flips the global toggle through the settings API and persists the value', async () => {
    mockApi.fetchNotificationSettings.mockResolvedValue({
      settings: { notificationsEnabled: true, notificationPreview: true },
    });
    expoNotifications.getPermissionsAsync.mockResolvedValue({ granted: false, status: 'denied' });
    mockApi.updateNotificationSettings.mockResolvedValue({
      settings: { notificationsEnabled: false, notificationPreview: true },
    });

    render(<NotificationSettingsScreen />);
    await waitFor(() => expect(screen.getByTestId('switch-global')).toBeTruthy());

    act(() => {
      fireEvent(screen.getByTestId('switch-global'), 'valueChange', false);
    });
    await waitFor(() =>
      expect(mockApi.updateNotificationSettings).toHaveBeenCalledWith('test-token', { notificationsEnabled: false }),
    );
  });

  it('reverts the toggle when the server rejects the update', async () => {
    mockApi.fetchNotificationSettings.mockResolvedValue({
      settings: { notificationsEnabled: true, notificationPreview: true },
    });
    expoNotifications.getPermissionsAsync.mockResolvedValue({ granted: true, status: 'granted' });
    mockApi.updateNotificationSettings.mockRejectedValue(new apiModule.ApiError('VALIDATION', 400, 'bad'));

    render(<NotificationSettingsScreen />);
    await waitFor(() => expect(screen.getByTestId('switch-global')).toBeTruthy());

    act(() => {
      fireEvent(screen.getByTestId('switch-global'), 'valueChange', false);
    });
    await waitFor(() => expect(mockApi.updateNotificationSettings).toHaveBeenCalled());
    // The optimistic flip is rolled back — the switch shows the server truth.
    await waitFor(() => expect(screen.getByTestId('switch-global').props.value).toBe(true));
  });

  it('shows the error state when settings cannot load', async () => {
    mockApi.fetchNotificationSettings.mockRejectedValue(new Error('offline'));
    render(<NotificationSettingsScreen />);
    await waitFor(() => expect(screen.getByTestId('notif-settings-error')).toBeTruthy());
  });
});
