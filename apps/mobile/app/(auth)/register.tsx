import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { useAuth } from '../../src/auth/AuthContext';
import { ApiError } from '../../src/lib/api';
import { colors } from '../../src/design/tokens';

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
      <Text style={styles.title}>Create account</Text>
      <Text style={styles.tagline}>No phone number required.</Text>

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
      {error ? (
        <Text style={styles.error} testID="register-error">
          {error}
        </Text>
      ) : null}
      <Pressable
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        onPress={() => void onSubmit()}
        disabled={submitting}
        testID="register-submit"
      >
        {submitting ? <ActivityIndicator color={colors.text} /> : <Text style={styles.buttonText}>Create account</Text>}
      </Pressable>

      <Link href="/(auth)/login" style={styles.link} testID="register-to-login">
        I already have an account
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
