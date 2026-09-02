import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from '../src/auth/AuthContext';
import { colors } from '../src/design/tokens';

// Root layout: authentication state wraps the whole app (M2). Navigation
// groups per design.md §8 — (auth) for the login flow, (app) for
// authenticated destinations that grow with later milestones.
export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar style="light" backgroundColor={colors.background} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />
    </AuthProvider>
  );
}
