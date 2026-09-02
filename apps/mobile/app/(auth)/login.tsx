import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { useAuth } from '../../src/auth/AuthContext';
import { ApiError } from '../../src/lib/api';
import { colors } from '../../src/design/tokens';

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
      <Text style={styles.title}>CircleChat</Text>
      <Text style={styles.tagline}>No phone number required.</Text>

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
      {error ? (
        <Text style={styles.error} testID="login-error">
          {error}
        </Text>
      ) : null}
      <Pressable
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        onPress={() => void onSubmit()}
        disabled={submitting}
        testID="login-submit"
      >
        {submitting ? (
          <ActivityIndicator color={colors.text} />
        ) : (
          <Text style={styles.buttonText}>Log in</Text>
        )}
      </Pressable>

      <Link href="/(auth)/register" style={styles.link} testID="login-to-register">
        Create account
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    padding: 24,
  },
  title: { color: colors.text, fontSize: 28, fontWeight: '700', textAlign: 'center' },
  tagline: { color: colors.textMuted, fontSize: 13, textAlign: 'center', marginTop: 4, marginBottom: 24 },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    color: colors.text,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 12,
  },
  error: { color: colors.error, fontSize: 13, marginBottom: 12 },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonPressed: { opacity: 0.85 },
  buttonText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  link: { color: colors.accent, textAlign: 'center', marginTop: 20 },
});
