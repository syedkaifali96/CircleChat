import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { PublicUser } from '@circlechat/shared';
import { fetchCurrentUser, logout as apiLogout, login as apiLogin, signup as apiSignup } from '../lib/api';
import { clearSessionToken, loadSessionToken, saveSessionToken } from './session';

/**
 * Authentication state (M2): bootstrap restores the secure session token,
 * the server validates it, and an invalid/revoked session returns the user to
 * login. This is session state only — it never grants anything by itself;
 * every server request is authorized server-side.
 */
export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthContextValue {
  status: AuthStatus;
  user: PublicUser | null;
  /** Recovery code shown exactly once after signup/rotation. */
  pendingRecoveryCode: string | null;
  acknowledgeRecoveryCode: () => void;
  updateUser: (updated: PublicUser) => void;
  signIn: (username: string, password: string) => Promise<void>;
  signUp: (username: string, displayName: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<PublicUser | null>(null);
  const [pendingRecoveryCode, setPendingRecoveryCode] = useState<string | null>(null);

  const bootstrap = useCallback(async () => {
    const token = await loadSessionToken();
    if (!token) {
      setStatus('unauthenticated');
      return;
    }
    try {
      const { user: restored } = await fetchCurrentUser(token);
      setUser(restored);
      setStatus('authenticated');
    } catch {
      // Invalid/revoked/expired session → back to login.
      await clearSessionToken();
      setStatus('unauthenticated');
    }
  }, []);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const signIn = useCallback(async (username: string, password: string) => {
    const { token, user: loggedIn } = await apiLogin(username, password);
    await saveSessionToken(token);
    setUser(loggedIn);
    setStatus('authenticated');
  }, []);

  const signUp = useCallback(async (username: string, displayName: string, password: string) => {
    const { token, recoveryCode, user: created } = await apiSignup(username, displayName, password);
    await saveSessionToken(token);
    setPendingRecoveryCode(recoveryCode);
    setUser(created);
    setStatus('authenticated');
  }, []);

  const signOut = useCallback(async () => {
    const token = await loadSessionToken();
    if (token) {
      try {
        await apiLogout(token);
      } catch {
        // Session may already be revoked; clearing local state is still correct.
      }
    }
    await clearSessionToken();
    setUser(null);
    setStatus('unauthenticated');
  }, []);

  /** Replaces the cached user after a profile edit; /v1/users/me stays authoritative. */
  const updateUser = useCallback((updated: PublicUser) => {
    setUser(updated);
  }, []);

  const acknowledgeRecoveryCode = useCallback(() => setPendingRecoveryCode(null), []);

  const value = useMemo(
    () => ({
      status,
      user,
      pendingRecoveryCode,
      acknowledgeRecoveryCode,
      updateUser,
      signIn,
      signUp,
      signOut,
    }),
    [status, user, pendingRecoveryCode, acknowledgeRecoveryCode, updateUser, signIn, signUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return context;
}
