import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import {
  ApiError,
  deleteCircle,
  fetchCircle,
  fetchCircleSettings,
  updateCircle,
  updateCircleSettings,
} from '../../../../src/lib/api';
import { loadSessionToken } from '../../../../src/auth/session';
import { colors, typography } from '../../../../src/design/tokens';
import {
  BACKGROUND_LABELS,
  CIRCLE_THEMES,
  THEME_LABELS,
} from '../../../../src/design/CircleTheme';
import {
  BACKGROUND_KEYS,
  THEME_PRESETS,
  type BackgroundKey,
  type ThemePreset,
} from '@circlechat/shared';

/**
 * Circle settings (design.md §23 "Circle Settings"): rename/description for
 * owner/admin, plus the destructive actions — delete (owner only) — visually
 * separated. The server re-checks the caller's role on every request.
 *
 * M12 personalization (design.md §24): theme preset, accent color, and the
 * bundled chat background live here too — owner/admin only, mirroring the
 * server-side role guard on PATCH /circles/:id/settings. The pickers submit
 * stable app-defined identifiers; contrast is guaranteed by the preset
 * palettes (no free-form color input).
 */

/** Legacy test IDs stay stable independently of the visible accent labels. */
const ACCENT_SWATCHES: { label: string; value: string | null; testID: string }[] = [
  { label: 'Default', value: null, testID: 'accent-option-default' },
  { label: 'Amber', value: colors.memberAmber, testID: 'accent-option-amber' },
  { label: 'Coral', value: colors.memberCoral, testID: 'accent-option-lavender' },
  { label: 'Gold', value: colors.memberGold, testID: 'accent-option-light violet' },
  { label: 'Terracotta', value: colors.memberTerracotta, testID: 'accent-option-emerald' },
];

export default function CircleSettingsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [circle, setCircle] = useState<{ id: string; name: string; description: string | null; callerRole: string } | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // M12 personalization state (owner/admin only; server re-checks the role).
  const [settings, setSettings] = useState<{ themePreset: ThemePreset; accentColor: string | null; backgroundKey: BackgroundKey | null } | null>(null);
  const [savingTheme, setSavingTheme] = useState<string | null>(null);
  const [themeError, setThemeError] = useState(false);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const token = (await loadSessionToken()) ?? '';
      const [{ circle: found }, { settings: foundSettings }] = await Promise.all([
        fetchCircle(token, id),
        fetchCircleSettings(token, id),
      ]);
      setCircle(found);
      setName(found.name);
      setDescription(found.description ?? '');
      setSettings(foundSettings);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const dirty = circle !== null && (name.trim() !== circle.name || description.trim() !== (circle.description ?? ''));

  const onSave = async () => {
    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      setError('The Circle needs a name.');
      return;
    }
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      const token = (await loadSessionToken()) ?? '';
      const { circle: updated } = await updateCircle(token, id, {
        name: trimmedName,
        description: description.trim().length > 0 ? description.trim() : null,
      });
      setCircle((current) => (current ? { ...current, ...updated } : current));
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'VALIDATION_FAILED' ? 'Check the name (1–40) and description (≤200).' : "Couldn't save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  /** PATCH one personalization field; the response is the new state. */
  const onPatchSettings = async (
    field: string,
    patch: { themePreset?: ThemePreset; accentColor?: string | null; backgroundKey?: BackgroundKey | null },
  ) => {
    setThemeError(false);
    setSavingTheme(field);
    const previous = settings;
    // Optimistic update with revert on failure (mirrors the settings-screen
    // toggle pattern from M8).
    setSettings((current) => (current ? { ...current, ...patch } : current));
    try {
      const token = (await loadSessionToken()) ?? '';
      const { settings: updated } = await updateCircleSettings(token, id, patch);
      setSettings(updated);
    } catch {
      setSettings(previous);
      setThemeError(true);
    } finally {
      setSavingTheme(null);
    }
  };

  const onDelete = () => {
    Alert.alert(
      'Delete this Circle?',
      'This removes it for everyone. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            void (async () => {
              try {
                const token = (await loadSessionToken()) ?? '';
                await deleteCircle(token, id);
                router.replace('/(app)/home');
              } catch {
                setError("Couldn't delete the Circle. Try again.");
              }
            })(),
        },
      ],
    );
  };

  if (loading) {
    return (
      <View style={styles.centered} testID="circle-settings-loading">
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (loadError || !circle) {
    return (
      <View style={styles.centered} testID="circle-settings-error">
        <Text style={styles.stateTitle}>Something went wrong.</Text>
        <Pressable style={styles.secondaryButton} onPress={() => void load()} testID="circle-settings-retry">
          <Text style={styles.secondaryButtonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  const isAdmin = circle.callerRole === 'owner' || circle.callerRole === 'admin';
  // The API's null and the `none` key both mean "no background" — the server
  // normalizes `none` to null on write.
  const selectedBackground = settings?.backgroundKey ?? 'none';

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'android' ? undefined : 'padding'}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content} testID="circle-settings-screen">
        <Text style={styles.title}>Circle settings</Text>

        <Text style={styles.label}>Circle name</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={(value) => {
            setName(value);
            setSaved(false);
          }}
          maxLength={40}
          editable={!saving}
          testID="circle-settings-name"
        />

        <Text style={styles.label}>Description</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={description}
          onChangeText={(value) => {
            setDescription(value);
            setSaved(false);
          }}
          multiline
          maxLength={200}
          placeholder="A short line about this Circle"
          placeholderTextColor={colors.textMuted}
          editable={!saving}
          testID="circle-settings-description"
        />

        {error ? <Text style={styles.error} testID="circle-settings-error-text">{error}</Text> : null}
        {saved ? <Text style={styles.saved} testID="circle-settings-saved">Saved.</Text> : null}

        <Pressable
          style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]}
          onPress={() => void onSave()}
          disabled={saving || !dirty}
          testID="circle-settings-save"
        >
          {saving ? <ActivityIndicator color={colors.primaryContent} /> : <Text style={styles.primaryButtonText}>Save changes</Text>}
        </Pressable>

        {isAdmin && settings ? (
          <View style={styles.personalization} testID="personalization-section">
            <Text style={styles.personalizationTitle}>Personalization</Text>

            <Text style={styles.label}>Theme</Text>
            {THEME_PRESETS.map((preset) => (
              <Pressable
                key={preset}
                style={({ pressed }) => [
                  styles.presetRow,
                  settings.themePreset === preset && styles.presetRowActive,
                  pressed && styles.buttonPressed,
                ]}
                onPress={() => void onPatchSettings(`theme:${preset}`, { themePreset: preset })}
                disabled={savingTheme !== null}
                accessibilityLabel={`Theme ${THEME_LABELS[preset]}`}
                testID={`theme-option-${preset}`}
              >
                <View style={[styles.presetSwatch, { backgroundColor: CIRCLE_THEMES[preset].background, borderColor: CIRCLE_THEMES[preset].primary }]} />
                <Text style={styles.presetLabel}>{THEME_LABELS[preset]}</Text>
                {settings.themePreset === preset ? <Text style={styles.presetCheck} testID={`theme-selected-${preset}`}>✓</Text> : null}
                {savingTheme === `theme:${preset}` ? <ActivityIndicator size="small" color={colors.accent} /> : null}
              </Pressable>
            ))}

            <Text style={styles.label}>Accent color</Text>
            <View style={styles.swatchRow} testID="accent-swatches">
              {ACCENT_SWATCHES.map((swatch) => (
                <Pressable
                  key={swatch.label}
                  style={[
                    styles.accentSwatch,
                    swatch.value
                      ? { backgroundColor: swatch.value }
                      : styles.accentSwatchDefault,
                    settings.accentColor === swatch.value && styles.accentSwatchActive,
                  ]}
                  onPress={() => void onPatchSettings('accent', { accentColor: swatch.value })}
                  disabled={savingTheme !== null}
                  accessibilityLabel={`Accent ${swatch.label}`}
                  testID={swatch.testID}
                />
              ))}
            </View>

            <Text style={styles.label}>Chat background</Text>
            {BACKGROUND_KEYS.map((key) => (
              <Pressable
                key={key}
                style={({ pressed }) => [
                  styles.presetRow,
                  selectedBackground === key && styles.presetRowActive,
                  pressed && styles.buttonPressed,
                ]}
                onPress={() => void onPatchSettings('background', { backgroundKey: key })}
                disabled={savingTheme !== null}
                accessibilityLabel={`Background ${BACKGROUND_LABELS[key]}`}
                testID={`background-option-${key}`}
              >
                <Text style={styles.presetLabel}>{BACKGROUND_LABELS[key]}</Text>
                {selectedBackground === key ? <Text style={styles.presetCheck} testID={`background-selected-${key}`}>✓</Text> : null}
              </Pressable>
            ))}

            {themeError ? <Text style={styles.error} testID="personalization-error">Couldn't save. Try again.</Text> : null}
          </View>
        ) : null}

        {circle.callerRole === 'owner' ? (
          <View style={styles.dangerZone} testID="circle-danger-zone">
            <Text style={styles.dangerTitle}>Danger zone</Text>
            <Pressable style={({ pressed }) => [styles.deleteButton, pressed && styles.buttonPressed]} onPress={onDelete} testID="circle-delete">
              <Text style={styles.deleteText}>Delete Circle</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, paddingTop: 64 },
  centered: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { ...typography.h1, color: colors.text, fontSize: 24 },
  label: { ...typography.bodyStrong, color: colors.text, fontSize: 14, marginTop: 24 },
  input: {
    ...typography.body,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 8,
  },
  multiline: { minHeight: 90, textAlignVertical: 'top' },
  error: { ...typography.captionStrong, color: colors.error, fontSize: 13, marginTop: 14 },
  saved: { ...typography.caption, color: colors.success, fontSize: 13, marginTop: 14 },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 28,
  },
  primaryButtonText: { ...typography.button, color: colors.primaryContent, fontSize: 15 },
  secondaryButton: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 32,
    marginTop: 16,
  },
  secondaryButtonText: { ...typography.button, color: colors.text, fontSize: 14 },
  stateTitle: { ...typography.h3, color: colors.text, fontSize: 16 },
  personalization: { marginTop: 36, borderColor: colors.border, borderWidth: 1, borderRadius: 16, padding: 16 },
  personalizationTitle: { ...typography.h3, color: colors.text, fontSize: 17 },
  presetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginTop: 10,
  },
  presetRowActive: { borderColor: colors.accent },
  presetSwatch: { width: 22, height: 22, borderRadius: 11, borderWidth: 2 },
  presetLabel: { ...typography.bodyStrong, color: colors.text, fontSize: 14, flex: 1 },
  presetCheck: { ...typography.bodyStrong, color: colors.accent, fontSize: 15 },
  swatchRow: { flexDirection: 'row', gap: 12, marginTop: 12 },
  accentSwatch: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, borderColor: colors.border },
  accentSwatchDefault: {
    backgroundColor: colors.surface,
    borderColor: colors.accent,
  },
  accentSwatchActive: { borderColor: colors.text },
  dangerZone: { marginTop: 40, borderColor: colors.border, borderWidth: 1, borderRadius: 16, padding: 16 },
  dangerTitle: { ...typography.captionStrong, color: colors.warning, fontSize: 13, textTransform: 'uppercase' },
  deleteButton: {
    borderColor: colors.error,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 12,
    backgroundColor: colors.background,
  },
  deleteText: { ...typography.button, color: colors.error, fontSize: 14 },
  buttonPressed: { opacity: 0.85 },
});
