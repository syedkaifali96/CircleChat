import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuth } from '../../src/auth/AuthContext';
import { colors, typography } from '../../src/design/tokens';

/**
 * Recovery code display (M2) — shown EXACTLY once after signup or rotation.
 * The server stores only a hash; if the user leaves without saving, the code
 * is gone (docs/SECURITY.md §4.3). No copy-paste requirement enforcement here,
 * but the screen demands an explicit acknowledgment.
 */
export default function RecoveryCodeScreen() {
  const { pendingRecoveryCode, acknowledgeRecoveryCode } = useAuth();

  if (!pendingRecoveryCode) {
    // Nothing pending (already acknowledged or deep-linked directly).
    return <Redirect href="/(app)/home" />;
  }

  return (
    <View style={styles.container} testID="recovery-code-screen">
      <Text style={styles.title}>Save your recovery code</Text>
      <Text style={styles.body}>
        It is the only way to recover your account if you forget your password. It will not be
        shown again.
      </Text>
      <Text style={styles.code} testID="recovery-code">
        {pendingRecoveryCode}
      </Text>
      <Pressable
        style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        onPress={acknowledgeRecoveryCode}
        testID="recovery-acknowledge"
      >
        <Text style={styles.buttonText}>I saved it</Text>
      </Pressable>
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
  title: { ...typography.h2, color: colors.text, textAlign: 'center' },
  body: { ...typography.body, color: colors.textSecondary, fontSize: 14, textAlign: 'center', marginTop: 12 },
  code: {
    ...typography.h2,
    color: colors.accent,
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: 2,
    textAlign: 'center',
    marginVertical: 24,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 18,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonPressed: { opacity: 0.85 },
  buttonText: { ...typography.button, color: colors.primaryContent },
});
