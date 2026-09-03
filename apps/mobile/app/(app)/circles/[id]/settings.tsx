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
  updateCircle,
} from '../../../../src/lib/api';
import { loadSessionToken } from '../../../../src/auth/session';
import { colors } from '../../../../src/design/tokens';

/**
 * Circle settings (design.md §23 "Circle Settings"): rename/description for
 * owner/admin, plus the destructive actions — delete (owner only) — visually
 * separated. The server re-checks the caller's role on every request.
 */

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

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const token = (await loadSessionToken()) ?? '';
      const { circle: found } = await fetchCircle(token, id);
      setCircle(found);
      setName(found.name);
      setDescription(found.description ?? '');
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
          {saving ? <ActivityIndicator color={colors.text} /> : <Text style={styles.primaryButtonText}>Save changes</Text>}
        </Pressable>

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
  title: { color: colors.text, fontSize: 24, fontWeight: '700' },
  label: { color: colors.text, fontSize: 14, fontWeight: '600', marginTop: 24 },
  input: {
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
  error: { color: colors.error, fontSize: 13, marginTop: 14 },
  saved: { color: colors.success, fontSize: 13, marginTop: 14 },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 28,
  },
  primaryButtonText: { color: colors.text, fontSize: 15, fontWeight: '700' },
  secondaryButton: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 32,
    marginTop: 16,
  },
  secondaryButtonText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  stateTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  dangerZone: { marginTop: 40, borderColor: colors.border, borderWidth: 1, borderRadius: 16, padding: 16 },
  dangerTitle: { color: colors.warning, fontSize: 13, fontWeight: '700', textTransform: 'uppercase' },
  deleteButton: {
    borderColor: colors.error,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 12,
    backgroundColor: colors.background,
  },
  deleteText: { color: colors.error, fontSize: 14, fontWeight: '600' },
  buttonPressed: { opacity: 0.85 },
});
