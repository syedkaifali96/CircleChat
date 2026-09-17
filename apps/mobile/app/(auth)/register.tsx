import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { useAuth } from '../../src/auth/AuthContext';
import { ApiError } from '../../src/lib/api';
import { colors, radii, shadows, spacing, typography } from '../../src/design/tokens';
import { Icon } from '../../src/components/Icon';

/** Registration screen (M2). Shows the recovery code screen on success. */
export default function RegisterScreen() {
  const { signUp } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await signUp(username.trim().toLowerCase(), displayName.trim(), password);
      router.replace('/(auth)/recovery-code');
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'USERNAME_TAKEN'
          ? 'That username is not available.'
          : 'Could not create the account. Check the fields and try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.container} testID="register-screen">
      <View style={styles.card}>
        <View style={styles.logoBadge}>
          <View style={styles.logoCircle}>
            <Icon name="sparkle" size={30} color={colors.accent} />
          </View>
        </View>

        <Text style={styles.title}>Create account</Text>
        <Text style={styles.tagline}>No phone number required.</Text>

        <View style={styles.inputGroup}>
          <TextInput
            style={styles.input}
            placeholder="Username (a-z, 0-9, _)"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            value={username}
            onChangeText={setUsername}
            testID="register-username"
          />
          <TextInput
            style={styles.input}
            placeholder="Display name"
            placeholderTextColor={colors.textMuted}
            value={displayName}
            onChangeText={setDisplayName}
            testID="register-display-name"
          />
          <TextInput
            style={styles.input}
            placeholder="Password (10+ characters)"
            placeholderTextColor={colors.textMuted}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            testID="register-password"
          />
        </View>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.error} testID="register-error">
              {error}
            </Text>
          </View>
        ) : null}

        <Pressable
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          onPress={() => void onSubmit()}
          disabled={submitting}
          testID="register-submit"
        >
          {submitting ? (
            <ActivityIndicator color={colors.primaryContent} size="small" />
          ) : (
            <Text style={styles.buttonText}>Create account</Text>
          )}
        </Pressable>

        <Link href="/(auth)/login" style={styles.link} testID="register-to-login">
          I already have an account
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
