import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { useAuth } from '../../src/auth/AuthContext';
import { ApiError } from '../../src/lib/api';
import { colors, radii, shadows, spacing, typography } from '../../src/design/tokens';
import { Icon } from '../../src/components/Icon';

/** Login screen (M2). Errors are generic — never reveal which field failed. */
export default function LoginScreen() {
  const { signIn } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await signIn(username.trim().toLowerCase(), password);
      router.replace('/(app)/home');
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'RATE_LIMITED'
          ? 'Too many attempts. Try again later.'
          : 'Invalid username or password.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.container} testID="login-screen">
      <View style={styles.card}>
        {/* Brand Mark */}
        <View style={styles.logoBadge}>
          <View style={styles.logoCircle}>
            <Icon name="circles" size={32} color={colors.accent} />
          </View>
        </View>

        <Text style={styles.title}>CircleChat</Text>
        <Text style={styles.tagline}>No phone number required.</Text>

        <View style={styles.inputGroup}>
          <TextInput
            style={styles.input}
            placeholder="Username"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            value={username}
            onChangeText={setUsername}
            testID="login-username"
          />

          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor={colors.textMuted}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            testID="login-password"
          />
        </View>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.error} testID="login-error">
              {error}
            </Text>
          </View>
        ) : null}

        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          onPress={() => void onSubmit()}
          disabled={submitting}
          testID="login-submit"
        >
          {submitting ? (
            <ActivityIndicator color={colors.primaryContent} size="small" />
          ) : (
            <Text style={styles.buttonText}>Log in</Text>
          )}
        </Pressable>

        <Link href="/(auth)/register" style={styles.link} testID="login-to-register">
          Create account
        </Link>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.xxl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    ...shadows.card,
  },
  logoBadge: {
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  logoCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primaryGlowSoft,
    borderWidth: 1.5,
    borderColor: colors.primaryBorder,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.glow,
  },
  title: {
    ...typography.h1,
    color: colors.text,
    fontSize: 26,
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  tagline: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: spacing.xl,
  },
  inputGroup: {
    gap: spacing.sm,
  },
  input: {
    ...typography.body,
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.border,
    borderWidth: 1.5,
    borderRadius: radii.lg,
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    fontSize: 15,
  },
  errorBox: {
    backgroundColor: colors.errorMuted,
    borderRadius: radii.md,
    padding: spacing.sm,
    marginTop: spacing.sm,
  },
  error: {
    ...typography.captionStrong,
    color: colors.error,
    fontSize: 12,
    textAlign: 'center',
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radii.lg,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: spacing.md,
    ...shadows.glow,
  },
  buttonPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.985 }],
  },
  buttonText: {
    ...typography.button,
    color: colors.primaryContent,
    fontSize: 15,
  },
  link: {
    ...typography.bodyStrong,
    color: colors.accent,
    fontSize: 14,
    textAlign: 'center',
    marginTop: spacing.lg,
    paddingVertical: spacing.xs,
  },
});
