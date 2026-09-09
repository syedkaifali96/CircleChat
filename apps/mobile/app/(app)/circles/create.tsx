import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { createCircle } from '../../../src/lib/api';
import { loadSessionToken } from '../../../src/auth/session';
import { colors } from '../../../src/design/tokens';
import { useSafeInsets } from '../../../src/lib/safeInsets';

/**
 * Create Circle flow (design.md §19): choose a name (and optionally a short
 * description), then create. Setup stays short — theme/avatar customization
 * is never required before entering the Circle. On success the user lands in
 * the Circle Home where the invite flow continues.
 */

export default function CreateCircleScreen() {
  const router = useRouter();
  const insets = useSafeInsets();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setError('Give your Circle a name.');
      return;
    }
    setError(null);
    setCreating(true);
    try {
      const token = (await loadSessionToken()) ?? '';
      const { circle } = await createCircle(token, {
        name: trimmed,
        description: description.trim().length > 0 ? description.trim() : undefined,
      });
      router.replace(`/(app)/circles/${circle.id}`);
    } catch {
      setError("Couldn't create your Circle. Check your connection and try again.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <View style={styles.flex}>
      <View style={[styles.container, { paddingTop: Math.max(insets.top, 24) + 12 }]} testID="create-circle-screen">
        <View style={styles.headerRow} testID="create-circle-header">
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            accessibilityLabel="Back"
            accessibilityRole="button"
            testID="create-circle-back"
          >
            <Text style={styles.backText}>‹</Text>
          </Pressable>
          <Text style={styles.title}>Create Circle</Text>
        </View>
        <Text style={styles.subtitle}>A private space for 2–5 of your people.</Text>

        <Text style={styles.label}>Circle name</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="Night Owls"
          placeholderTextColor={colors.textMuted}
          maxLength={40}
          editable={!creating}
          testID="create-circle-name"
        />

        <Text style={styles.label}>Description (optional)</Text>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={description}
          onChangeText={setDescription}
          placeholder='e.g. "No sleep club"'
          placeholderTextColor={colors.textMuted}
          multiline
          maxLength={200}
          editable={!creating}
          testID="create-circle-description"
        />

        {error ? (
          <Text style={styles.error} testID="create-circle-error">{error}</Text>
        ) : null}

        <Pressable
          onPress={() => onSubmit()}
          style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]}
          disabled={creating}
          testID="create-circle-submit"
        >
          {creating ? <ActivityIndicator color={colors.text} /> : <Text style={styles.primaryButtonText}>Create Circle</Text>}
        </Pressable>
        <Pressable onPress={() => router.back()} style={styles.cancel} disabled={creating} testID="create-circle-cancel">
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, paddingTop: 12 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 12,
    marginBottom: 4,
  },
  backText: { color: colors.accent, fontSize: 28, fontWeight: '700', paddingHorizontal: 6 },
  title: { color: colors.text, fontSize: 26, fontWeight: '700' },
  subtitle: { color: colors.textMuted, fontSize: 13, marginTop: 6 },
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
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 28,
  },
  primaryButtonText: { color: colors.text, fontSize: 15, fontWeight: '700' },
  cancel: { alignSelf: 'center', marginTop: 18, padding: 8 },
  cancelText: { color: colors.textMuted, fontSize: 14 },
  buttonPressed: { opacity: 0.85 },
});
