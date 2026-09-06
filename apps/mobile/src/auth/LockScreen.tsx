import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { clearAppLockPin, isValidAppLockPin, verifyAppLockPin } from './appLockPin';
import { saveAppLockMode } from './appLock';
import { useAuth } from './AuthContext';
import { clearSessionToken } from './session';
import { colors } from '../design/tokens';

/**
 * Locked screen (M13, design.md §22): rendered INSTEAD of the whole app while
 * App Lock is engaged, so no message previews or other private content can
 * render behind it. Unlock paths mirror the documented layout — PIN entry and
 * platform biometrics ("Biometric unlock uses platform capability rather than
 * custom biometric handling").
 */

export default function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const { signOut } = useAuth();
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [pinEntryVisible, setPinEntryVisible] = useState(false);
  const [pinDraft, setPinDraft] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [biometricError, setBiometricError] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        // Platform capability only — never custom biometric handling.
        const [hardware, enrolled] = await Promise.all([
          LocalAuthentication.hasHardwareAsync(),
          LocalAuthentication.isEnrolledAsync(),
        ]);
        setBiometricAvailable(hardware && enrolled);
      } catch {
        setBiometricAvailable(false);
      }
    })();
  }, []);

  const onUnlockBiometric = async () => {
    setBiometricError(false);
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock CircleChat',
      });
      if (result.success) {
        onUnlock();
      } else {
        setBiometricError(true);
      }
    } catch {
      setBiometricError(true);
    }
  };

  const onVerifyPin = async () => {
    if (!isValidAppLockPin(pinDraft) || verifying) {
      return;
    }
    setVerifying(true);
    setError(null);
    try {
      if (await verifyAppLockPin(pinDraft)) {
        onUnlock();
      } else {
        setError('Incorrect PIN.');
      }
    } catch {
      setError("Couldn't verify. Try again.");
    } finally {
      setVerifying(false);
      setPinDraft('');
    }
  };

  // Forgot-PIN recovery (docs: local layer, no server round-trip): the only
  // escape is signing out, which wipes the forgotten PIN and the session —
  // the user then authenticates normally on the login screen.
  const onForgotPin = useCallback(() => {
    Alert.alert(
      'Forgot your PIN?',
      'You will be signed out and App Lock will be removed. You can sign in again and set a new PIN.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out',
          style: 'destructive',
          onPress: () =>
            void (async () => {
              // A forgotten PIN must not survive recovery, or the next
              // sign-in would hit a lock the user can never satisfy.
              await clearAppLockPin();
              await saveAppLockMode('off');
              await clearSessionToken();
              await signOut();
            })(),
        },
      ],
    );
  }, [signOut]);

  return (
    <View style={styles.container} testID="app-lock-screen">
      <Text style={styles.logo} accessibilityLabel="CircleChat">
        <Text style={styles.logoMark}>⬤</Text> CircleChat
      </Text>
      <Text style={styles.title}>App locked</Text>

      {pinEntryVisible ? (
        <>
          <TextInput
            style={styles.pinInput}
            value={pinDraft}
            onChangeText={(value) => {
              setPinDraft(value.replace(/[^0-9]/g, ''));
              setError(null);
            }}
            placeholder="Enter your PIN"
            placeholderTextColor={colors.textMuted}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={6}
            autoFocus
            editable={!verifying}
            testID="app-lock-pin-input"
          />
          <Pressable
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
            onPress={() => void onVerifyPin()}
            disabled={verifying || pinDraft.length < 4}
            testID="app-lock-verify"
          >
            {verifying ? <ActivityIndicator color={colors.text} /> : <Text style={styles.primaryText}>Unlock</Text>}
          </Pressable>
        </>
      ) : (
        <Pressable
          style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
          onPress={() => setPinEntryVisible(true)}
          testID="app-lock-unlock-pin"
        >
          <Text style={styles.primaryText}>Unlock with PIN</Text>
        </Pressable>
      )}

      {biometricAvailable && !pinEntryVisible ? (
        <Pressable
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
          onPress={() => void onUnlockBiometric()}
          testID="app-lock-unlock-biometric"
        >
          <Text style={styles.secondaryText}>Use biometrics</Text>
        </Pressable>
      ) : null}
      {biometricError ? <Text style={styles.error} testID="app-lock-biometric-error">Biometric unlock failed. Use your PIN.</Text> : null}
      {error ? <Text style={styles.error} testID="app-lock-error">{error}</Text> : null}

      <Pressable onPress={onForgotPin} hitSlop={8} testID="app-lock-forgot">
        <Text style={styles.forgotText}>Forgot PIN?</Text>
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
  logo: { color: colors.text, fontSize: 22, fontWeight: '700' },
  logoMark: { color: colors.primary },
  title: { color: colors.textSecondary, fontSize: 16, marginTop: 12 },
  pinInput: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    color: colors.text,
    fontSize: 20,
    textAlign: 'center',
    letterSpacing: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 28,
    alignSelf: 'stretch',
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 16,
    alignSelf: 'stretch',
  },
  primaryText: { color: colors.text, fontSize: 15, fontWeight: '700' },
  secondaryButton: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 12,
    alignSelf: 'stretch',
  },
  secondaryText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  error: { color: colors.error, fontSize: 13, marginTop: 14 },
  forgotText: { color: colors.textMuted, fontSize: 13, marginTop: 32 },
  pressed: { opacity: 0.85 },
});
