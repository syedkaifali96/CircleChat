import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as LocalAuthentication from 'expo-local-authentication';
import {
  APP_LOCK_MODE_LABELS,
  APP_LOCK_MODES,
  type AppLockMode,
} from '../../src/auth/appLock';
import { clearAppLockPin, setupAppLockPin } from '../../src/auth/appLockPin';
import { useAppLock } from '../../src/auth/AppLockManager';
import { colors } from '../../src/design/tokens';

/**
 * App Lock settings (M13, design.md §22 "Off / Immediately / After 1 / 5 /
 * 15 minutes / On app restart"): a local privacy layer only. Enabling a mode
 * requires a PIN; switching to Off removes it. Changing the mode is instant —
 * there is nothing to save because nothing leaves the device.
 */

const PIN_REMOVAL_CONFIRM = 'Remove App Lock?';

export default function AppLockSettingsScreen() {
  const router = useRouter();
  const { mode, pinConfigured, ready, setMode, refreshPinConfigured } = useAppLock();
  const [biometricAvailable, setBiometricAvailable] = useState<boolean | null>(null);
  const [pinDraft, setPinDraft] = useState('');
  const [pinConfirmDraft, setPinConfirmDraft] = useState('');
  const [setupVisible, setSetupVisible] = useState(false);
  // The lock option that opened PIN setup — applied once the PIN exists.
  const [pendingMode, setPendingMode] = useState<AppLockMode | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
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

  const onPickMode = async (next: AppLockMode) => {
    setError(null);
    if (next === 'off') {
      if (pinConfigured) {
        Alert.alert(PIN_REMOVAL_CONFIRM, 'Your PIN is removed from this device.', [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: () =>
              void (async () => {
                setSaving(true);
                try {
                  await clearAppLockPin();
                  await refreshPinConfigured();
                  await setMode('off');
                } catch {
                  setError("Couldn't remove App Lock. Try again.");
                } finally {
                  setSaving(false);
                }
              })(),
          },
        ]);
        return;
      }
      await setMode('off');
      return;
    }

    if (!pinConfigured) {
      setPendingMode(next);
      setSetupVisible(true);
      return;
    }
    await setMode(next);
  };

  const onConfirmPinSetup = async () => {
    if (pinDraft !== pinConfirmDraft) {
      setError('PINs do not match.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await setupAppLockPin(pinDraft);
      await refreshPinConfigured();
      // The option that opened setup applies now that a PIN exists.
      if (pendingMode !== null) {
        await setMode(pendingMode);
        setPendingMode(null);
      }
      setSetupVisible(false);
      setPinDraft('');
      setPinConfirmDraft('');
    } catch {
      setError("Couldn't save the PIN. Try again.");
    } finally {
      setSaving(false);
    }
  };

  if (!ready) {
    return (
      <View style={styles.centered} testID="app-lock-loading">
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'android' ? undefined : 'padding'}>
      <View style={styles.container} testID="app-lock-screen-settings">
        <Text style={styles.title}>App lock</Text>
        <Text style={styles.subtitle}>
          Locks this app on this device with your PIN{biometricAvailable ? ' or biometrics' : ''}. Nothing is sent to
          the server. If you forget your PIN you will be signed out to recover access.
        </Text>

        {APP_LOCK_MODES.map((option) => (
          <Pressable
            key={option}
            style={({ pressed }) => [
              styles.modeRow,
              mode === option && styles.modeRowActive,
              pressed && styles.pressed,
            ]}
            onPress={() => void onPickMode(option)}
            disabled={saving}
            accessibilityLabel={`Lock ${APP_LOCK_MODE_LABELS[option]}`}
            testID={`app-lock-mode-${option}`}
          >
            <Text style={styles.modeLabel}>{APP_LOCK_MODE_LABELS[option]}</Text>
            {mode === option ? <Text style={styles.modeCheck} testID={`app-lock-selected-${option}`}>✓</Text> : null}
          </Pressable>
        ))}

        {pinConfigured ? (
          <Text style={styles.pinState} testID="app-lock-pin-state">
            PIN is set. Biometrics {biometricAvailable === false ? 'are not available on this device.' : 'are used when the device supports them.'}
          </Text>
        ) : (
          <Text style={styles.pinState} testID="app-lock-pin-state">
            No PIN set. Choosing a lock option asks you to create one.
          </Text>
        )}
        {error ? <Text style={styles.error} testID="app-lock-error">{error}</Text> : null}

        {setupVisible ? (
          <View style={styles.setupCard} testID="app-lock-setup">
            <Text style={styles.setupTitle}>Create your PIN</Text>
            <TextInput
              style={styles.input}
              value={pinDraft}
              onChangeText={(value) => {
                setPinDraft(value.replace(/[^0-9]/g, ''));
                setError(null);
              }}
              placeholder="4–6 digits"
              placeholderTextColor={colors.textMuted}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={6}
              testID="app-lock-pin-setup"
            />
            <TextInput
              style={styles.input}
              value={pinConfirmDraft}
              onChangeText={(value) => {
                setPinConfirmDraft(value.replace(/[^0-9]/g, ''));
                setError(null);
              }}
              placeholder="Repeat PIN"
              placeholderTextColor={colors.textMuted}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={6}
              testID="app-lock-pin-confirm"
            />
            <Pressable
              style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
              onPress={() => void onConfirmPinSetup()}
              disabled={saving || pinDraft.length < 4 || pinConfirmDraft.length < 4}
              testID="app-lock-pin-save"
            >
              {saving ? <ActivityIndicator color={colors.text} /> : <Text style={styles.primaryText}>Save PIN</Text>}
            </Pressable>
            <Pressable
              style={styles.textButton}
              onPress={() => {
                setSetupVisible(false);
                setPendingMode(null);
                setPinDraft('');
                setPinConfirmDraft('');
              }}
              testID="app-lock-setup-cancel"
            >
              <Text style={styles.textButtonText}>Cancel</Text>
            </Pressable>
          </View>
        ) : null}

        <Pressable style={styles.backLink} onPress={() => router.back()} testID="app-lock-back">
          <Text style={styles.backText}>Back to profile</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, padding: 24, paddingTop: 64 },
  centered: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.text, fontSize: 24, fontWeight: '700' },
  subtitle: { color: colors.textMuted, fontSize: 13, marginTop: 8, lineHeight: 19 },
  modeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginTop: 10,
  },
  modeRowActive: { borderColor: colors.accent },
  modeLabel: { color: colors.text, fontSize: 15, fontWeight: '600' },
  modeCheck: { color: colors.accent, fontSize: 15, fontWeight: '700' },
  pinState: { color: colors.textMuted, fontSize: 12, marginTop: 16 },
  error: { color: colors.error, fontSize: 13, marginTop: 10 },
  setupCard: { marginTop: 20, borderColor: colors.border, borderWidth: 1, borderRadius: 16, padding: 16 },
  setupTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    color: colors.text,
    fontSize: 16,
    textAlign: 'center',
    letterSpacing: 6,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 12,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 14,
  },
  primaryText: { color: colors.text, fontSize: 15, fontWeight: '700' },
  textButton: { alignItems: 'center', marginTop: 12, padding: 6 },
  textButtonText: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  backLink: { alignItems: 'center', marginTop: 28 },
  backText: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  pressed: { opacity: 0.85 },
});
