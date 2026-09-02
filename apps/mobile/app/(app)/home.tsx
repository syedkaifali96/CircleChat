import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/auth/AuthContext';
import { colors } from '../../src/design/tokens';

/**
 * Authenticated home placeholder (M2): proves the session restored and offers
 * logout. Circles/Home/Chat arrive in later milestones — intentionally no
 * product UI beyond authentication state here.
 */
export default function HomeScreen() {
  const { user, signOut } = useAuth();
  const router = useRouter();

  const onLogout = async () => {
    await signOut();
    router.replace('/(auth)/login');
  };

  return (
    <View style={styles.container} testID="home-screen">
      <Text style={styles.title}>CircleChat</Text>
      {user ? (
        <Text style={styles.subtitle} testID="home-user">
          Signed in as {user.displayName} (@{user.username})
        </Text>
      ) : null}
      <Link href="/(app)/profile" style={styles.profileLink} testID="home-profile-link">View profile</Link>
      <Text style={styles.note}>
        Your Circles will live here. Authentication is ready — the product experience arrives in
        upcoming milestones.
      </Text>
      <Pressable
        style={({ pressed }) => [styles.logout, pressed && styles.buttonPressed]}
        onPress={() => void onLogout()}
        testID="logout-button"
      >
        <Text style={styles.logoutText}>Log out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: { color: colors.text, fontSize: 28, fontWeight: '700' },
  subtitle: { color: colors.accent, fontSize: 14, marginTop: 8, textAlign: 'center' },
  note: { color: colors.textMuted, fontSize: 12, textAlign: 'center', marginTop: 16 },
  logout: {
    marginTop: 32,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 32,
    backgroundColor: colors.surface,
  },
  buttonPressed: { opacity: 0.85 },
  logoutText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  profileLink: { color: colors.accent, marginTop: 16, fontSize: 15, fontWeight: '600' },
});
