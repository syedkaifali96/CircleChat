import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { registerPushTokenForSession, unregisterPushTokenForSession } from './api';

/**
 * Push notification registration + tap routing (M8, docs/ARCHITECTURE.md §10).
 *
 * The SERVER constructs every payload; this module only (a) obtains the OS
 * permission + Expo push token and registers it against the caller's session,
 * and (b) surfaces notification taps so the app can navigate. Tap navigation
 * re-verifies access server-side by simply opening the conversation screen —
 * which 404s safely when access was revoked.
 */

export type PushPermissionStatus = 'granted' | 'denied' | 'unavailable';

/** Minimal structural type — the installed expo-notifications .d.ts lags the
 * runtime shape (PermissionResponse carries granted + status). */
interface PermissionResult {
  granted: boolean;
  status?: string;
}

/** Foreground display policy: show banners while the app is open. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export async function getPermissionStatus(): Promise<PushPermissionStatus> {
  if (!Device.isDevice) {
    // Push requires a physical device; emulators report unavailable.
    return 'unavailable';
  }
  try {
    const current = (await Notifications.getPermissionsAsync()) as unknown as PermissionResult;
    if (current.granted) {
      return 'granted';
    }
    return current.status === 'denied' ? 'denied' : 'unavailable';
  } catch {
    // Environments without push support (Expo Go Android removed remote push
    // in SDK 53) THROW from these APIs — the app must degrade to 'unavailable'
    // and keep working fully without pushes, never crash the render tree.
    return 'unavailable';
  }
}

/**
 * Requests OS permission (never spams: called from explicit user actions),
 * obtains the Expo push token and registers it on the caller's session.
 * Returns the OS permission status; registration failures are reported via
 * the returned state, never thrown.
 */
export async function registerForPushNotifications(token: string): Promise<PushPermissionStatus> {
  if (!Device.isDevice) {
    return 'unavailable';
  }
  try {
    const current = (await Notifications.getPermissionsAsync()) as unknown as PermissionResult;
    let granted = current.granted;
    if (!granted) {
      const request = (await Notifications.requestPermissionsAsync()) as unknown as PermissionResult;
      granted = request.granted;
    }
    if (!granted) {
      const after = (await Notifications.getPermissionsAsync()) as unknown as PermissionResult;
      return after.status === 'denied' ? 'denied' : 'unavailable';
    }
    // EAS builds (M16) need the EAS project id here — without it
    // getExpoPushTokenAsync throws in preview/production builds (Expo Go
    // never reached this path; it has no remote push on Android SDK 53+).
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    const pushToken = (
      await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)
    ).data;
    await registerPushTokenForSession(token, pushToken);
    return 'granted';
  } catch {
    // Permission/Token failures AND environments without any push support
    // (Expo Go Android SDK 53+) land here — push is best-effort by contract,
    // so report 'unavailable' and keep the app fully functional.
    return 'unavailable';
  }
}

/** Removes the current session's push token (logout / settings reset). */
export async function unregisterPushNotifications(token: string): Promise<void> {
  try {
    await unregisterPushTokenForSession(token);
  } catch {
    // Best-effort; the server also cleans up revoked sessions' tokens.
  }
}

export interface NotificationTap {
  conversationId: string | null;
}

/** Extracts the minimal deep-link identifiers from a notification response. */
export function extractNotificationTap(response: Notifications.NotificationResponse): NotificationTap | null {
  const data = response.notification.request.content.data as
    | { conversationId?: unknown }
    | undefined;
  if (typeof data?.conversationId === 'string' && data.conversationId.length > 0) {
    return { conversationId: data.conversationId };
  }
  return null;
}

/** Subscribes to notification taps (warm + cold start). Returns unsubscribe. */
export function onNotificationTap(
  handler: (tap: NotificationTap) => void,
): () => void {
  const warm = Notifications.addNotificationResponseReceivedListener((response) => {
    const tap = extractNotificationTap(response);
    if (tap) {
      handler(tap);
    }
  });
  void Notifications.getLastNotificationResponseAsync().then((response) => {
    // Cold start: the tap that launched the app — only route fresh taps.
    if (response?.notification.date && Date.now() - response.notification.date < 30_000) {
      const tap = extractNotificationTap(response);
      if (tap) {
        handler(tap);
      }
    }
  });
  return () => warm.remove();
}
