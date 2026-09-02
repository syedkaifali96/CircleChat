import * as SecureStore from 'expo-secure-store';

/**
 * Session credential storage (docs/SECURITY.md §3): the raw session token is
 * stored ONLY in Expo SecureStore (hardware-backed keystore where available),
 * never in AsyncStorage or any plaintext location. Passwords are never stored.
 */
const SESSION_TOKEN_KEY = 'circlechat.session-token';

export async function saveSessionToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(SESSION_TOKEN_KEY, token);
}

export async function loadSessionToken(): Promise<string | null> {
  return SecureStore.getItemAsync(SESSION_TOKEN_KEY);
}

export async function clearSessionToken(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_TOKEN_KEY);
}
