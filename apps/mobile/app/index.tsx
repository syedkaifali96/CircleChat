import { StyleSheet, Text, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuth } from '../src/auth/AuthContext';
import { colors } from '../src/design/tokens';

/**
 * Auth gate (M2): restores the session, then routes to the authenticated app
 * or the login flow. The old M0 landing content lives on while sessions load.
 */
export default function AuthGate() {
  const { status } = useAuth();

  if (status === 'loading') {
    return (
      <View style={styles.container} testID="auth-loading">
        <Text style={styles.title}>CircleChat</Text>
        <Text style={styles.tagline}>Your little private world.</Text>
      </View>
    );
  }
  if (status === 'authenticated') {
    return <Redirect href="/(app)/home" />;
  }
  return <Redirect href="/(auth)/login" />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: { color: colors.text, fontSize: 32, fontWeight: '700' },
  tagline: { color: colors.accent, fontSize: 16, marginTop: 8 },
});
