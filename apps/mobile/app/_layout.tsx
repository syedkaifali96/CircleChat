import { ActivityIndicator, StyleSheet, View } from 'react-native';
import {
  useFonts as useJakarta,
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
} from '@expo-google-fonts/plus-jakarta-sans';
import { useFonts as useInter, Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { AuthProvider } from '../src/auth/AuthContext';
import { AppLockProvider } from '../src/auth/AppLockManager';
import { PushManager } from '../src/lib/PushManager';
import { colors } from '../src/design/tokens';

// Root layout: authentication state wraps the whole app (M2). Navigation
// groups per design.md §8 — (auth) for the login flow, (app) for
// authenticated destinations that grow with later milestones. PushManager
// (M8) handles push registration and notification tap routing app-wide.
// AppLockProvider (M13) is the outermost gate: while locked it renders the
// LockScreen instead of any navigation content. SafeAreaProvider supplies the
// device's real insets (status bar, cutout, nav bar) to every screen — without
// it useSafeInsets() falls back to zeros and headers sit under the status bar.
export default function RootLayout() {
  const [jakartaLoaded, jakartaError] = useJakarta({
    'PlusJakartaSans-Regular': PlusJakartaSans_400Regular,
    'PlusJakartaSans-Medium': PlusJakartaSans_500Medium,
    'PlusJakartaSans-SemiBold': PlusJakartaSans_600SemiBold,
    'PlusJakartaSans-Bold': PlusJakartaSans_700Bold,
  });
  const [interLoaded, interError] = useInter({
    'Inter-Regular': Inter_400Regular,
    'Inter-Medium': Inter_500Medium,
    'Inter-SemiBold': Inter_600SemiBold,
  });
  // Native text falls back to the system font for unavailable families on error.
  const fontsSettled = (jakartaLoaded || jakartaError) && (interLoaded || interError);

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <AuthProvider>
        {/* PushManager lives OUTSIDE the App Lock gate: pushes and their M8
            preview-privacy rules keep working while the app is locked. */}
        <PushManager />
        <AppLockProvider>
          <StatusBar style="light" backgroundColor={colors.background} />
          {fontsSettled ? (
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />
          ) : (
            <View testID="font-loading" style={styles.loading}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          )}
        </AppLockProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
});
