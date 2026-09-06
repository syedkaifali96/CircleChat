import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from '../src/auth/AuthContext';
import { AppLockProvider } from '../src/auth/AppLockManager';
import { PushManager } from '../src/lib/PushManager';
import { colors } from '../src/design/tokens';

// Root layout: authentication state wraps the whole app (M2). Navigation
// groups per design.md §8 — (auth) for the login flow, (app) for
// authenticated destinations that grow with later milestones. PushManager
// (M8) handles push registration and notification tap routing app-wide.
// AppLockProvider (M13) is the outermost gate: while locked it renders the
// LockScreen instead of any navigation content.
export default function RootLayout() {
  return (
    <AuthProvider>
      {/* PushManager lives OUTSIDE the App Lock gate: pushes and their M8
          preview-privacy rules keep working while the app is locked. */}
      <PushManager />
      <AppLockProvider>
        <StatusBar style="light" backgroundColor={colors.background} />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />
      </AppLockProvider>
    </AuthProvider>
  );
}
