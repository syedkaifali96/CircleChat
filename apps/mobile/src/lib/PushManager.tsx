import { useEffect, useRef } from 'react';
import { useRouter } from 'expo-router';
import { useAuth } from '../auth/AuthContext';
import { loadSessionToken } from '../auth/session';
import { onNotificationTap, registerForPushNotifications } from '../lib/notifications';

/**
 * Push wiring (M8): mounted once inside AuthProvider in the root layout.
 *
 * When a session becomes authenticated, the OS permission + Expo push token
 * are requested once per focus of this state and registered on the CURRENT
 * session (server stores it per session). Denied/unavailable states are
 * terminal here — re-request loops never happen (the OS blocks them anyway).
 *
 * Tap routing: a push tap navigates to the conversation screen, which
 * re-verifies access server-side on load (a stale/unauthorized conversation
 * 404s safely). The payload itself is never trusted for authorization.
 */
export function PushManager() {
  const { status } = useAuth();
  const router = useRouter();
  // Registration is per login, not per render: the last status this effect
  // ran for (session tokens are opaque, so status transitions are the signal).
  const registeredFor = useRef<string | null>(null);

  useEffect(() => {
    if (status !== 'authenticated') {
      registeredFor.current = null;
      return;
    }
    void (async () => {
      const token = (await loadSessionToken()) ?? '';
      if (!token || registeredFor.current === token) {
        return;
      }
      registeredFor.current = token;
      await registerForPushNotifications(token);
    })();
  }, [status]);

  useEffect(() => {
    const unsubscribe = onNotificationTap((tap) => {
      if (tap.conversationId) {
        router.push(`/(app)/chats/${tap.conversationId}`);
      }
    });
    return unsubscribe;
  }, [router]);

  return null;
}
