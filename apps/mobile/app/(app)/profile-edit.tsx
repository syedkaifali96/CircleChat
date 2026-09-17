import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/auth/AuthContext';
import { loadSessionToken } from '../../src/auth/session';
import { ApiError, updateProfile } from '../../src/lib/api';
import { colors, typography } from '../../src/design/tokens';

/**
 * Edit profile (M3): display name + bio only. Username is shown read-only
 * (fixed in MVP). Saves through PATCH /v1/users/me; the auth context is
 * updated from the response so /users/me remains the single identity source.
 */
export default function ProfileEditScreen() {
  const { user, updateUser } = useAuth();
  const router = useRouter();
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [bio, setBio] = useState(user?.bio ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Sync fields when the profile arrives from the bootstrap fetch.
  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName);
      setBio(user.bio ?? '');
    }
  }, [user]);

  const onSave = async () => {
    setError(null);
    setSaved(false);
    const trimmedName = displayName.trim();
    if (trimmedName.length < 1 || trimmedName.length > 40) {
      setError('Display name must be 1–40 characters.');
      return;
    }
    if (bio.trim().length > 200) {
      setError('Bio must be 200 characters or fewer.');
      return;
    }
    setSaving(true);
    try {
      const token = (await loadSessionToken()) ?? '';
      const { user: updated } = await updateProfile(token, {
        displayName: trimmedName,
        bio: bio.trim().length > 0 ? bio.trim() : null,
      });
      updateUser(updated);
      setSaved(true);
      router.back();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.container} testID="profile-edit-screen">
      <Text style={styles.title}>Edit profile</Text>

      <Text style={styles.label}>Username (fixed)</Text>
      <Text style={styles.readonly} testID="edit-username">
        @{user?.username ?? ''}
      </Text>

      <Text style={styles.label}>Display name</Text>
      <TextInput
        style={styles.input}
        placeholder="Your name"
        placeholderTextColor={colors.textMuted}
        value={displayName}
        onChangeText={setDisplayName}
        maxLength={40}
        testID="edit-display-name"
      />

      <Text style={styles.label}>Bio (optional, max 200)</Text>
      <TextInput
        style={[styles.input, styles.bioInput]}
        placeholder="Tell your circle about yourself"
        placeholderTextColor={colors.textMuted}
        value={bio}
        onChangeText={setBio}
        multiline
        maxLength={200}
        testID="edit-bio"
      />

      {error ? (
        <Text style={styles.error} testID="edit-error">
          {error}
        </Text>
      ) : null}
      {saved && !error ? (
        <Text style={styles.success} testID="edit-success">
          Profile saved.
        </Text>
      ) : null}

      <Pressable
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        onPress={() => void onSave()}
        disabled={saving}
        testID="edit-save"
      >
        {saving ? <ActivityIndicator color={colors.primaryContent} /> : <Text style={styles.buttonText}>Save</Text>}
      </Pressable>
      <Pressable style={styles.cancel} onPress={() => router.back()} testID="edit-cancel">
        <Text style={styles.cancelText}>Cancel</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: 24 },
  title: { ...typography.h1, color: colors.text, fontSize: 24, marginTop: 48 },
  label: { ...typography.captionStrong, color: colors.textMuted, fontSize: 12, marginTop: 20, marginBottom: 6 },
  readonly: {
    ...typography.body,
    color: colors.textSecondary,
    fontSize: 15,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    opacity: 0.7,
  },
  input: {
    ...typography.body, lineHeight: undefined,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    color: colors.text,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  bioInput: { minHeight: 90, textAlignVertical: 'top' },
  error: { ...typography.caption, color: colors.error, fontSize: 13, marginTop: 12 },
  success: { ...typography.caption, color: colors.success, fontSize: 13, marginTop: 12 },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 20,
  },
  pressed: { opacity: 0.85 },
  buttonText: { ...typography.button, color: colors.primaryContent, fontSize: 15 },
  cancel: { alignItems: 'center', marginTop: 16 },
  cancelText: { ...typography.button, color: colors.accent },
});
