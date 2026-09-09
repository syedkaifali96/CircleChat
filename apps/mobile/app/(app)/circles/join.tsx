import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ApiError, fetchInvitePreview, joinCircle, type InvitePreview } from '../../../src/lib/api';
import { loadSessionToken } from '../../../src/auth/session';
import { colors } from '../../../src/design/tokens';

/**
 * Join Circle flow (design.md §20): enter an invite code → see the limited
 * pre-join preview (name, member count, avatar only) → confirm. Private data
 * (members, description) is never shown before joining. Server errors map to
 * understandable states: invalid, expired, full, already a member.
 */

function friendlyJoinError(code: string): string {
  switch (code) {
    case 'INVALID_INVITE':
      return "This invite isn't valid. Check the code and try again.";
    case 'INVITE_EXPIRED':
      return 'This invite has expired. Ask for a new one.';
    case 'CIRCLE_FULL':
      return 'This Circle is full (5 members).';
    case 'ALREADY_MEMBER':
      return "You're already in this Circle.";
    default:
      return "Couldn't join. Check your connection and try again.";
  }
}

export default function JoinCircleScreen() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const onLookup = async () => {
    const normalized = code.trim().toUpperCase();
    if (normalized.length === 0) {
      setPreviewError('Enter the invite code you were given.');
      return;
    }
    setPreviewError(null);
    setJoinError(null);
    setPreview(null);
    setPreviewLoading(true);
    try {
      const { preview: found } = await fetchInvitePreview(normalized);
      setPreview(found);
    } catch {
      setPreviewError("This invite isn't valid. Check the code and try again.");
    } finally {
      setPreviewLoading(false);
    }
  };

  const onJoin = async () => {
    if (!preview) {
      return;
    }
    setJoinError(null);
    setJoining(true);
    try {
      const token = (await loadSessionToken()) ?? '';
      const { circleId } = await joinCircle(token, code.trim());
      router.replace(`/(app)/circles/${circleId}`);
    } catch (err) {
      setJoinError(friendlyJoinError(err instanceof ApiError ? err.code : 'UNKNOWN'));
    } finally {
      setJoining(false);
    }
  };

  return (
    <View style={styles.flex}>
      <View style={styles.container} testID="join-circle-screen">
        <View style={styles.headerRow} testID="join-circle-header">
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            accessibilityLabel="Back"
            accessibilityRole="button"
            testID="join-circle-back"
          >
            <Text style={styles.backText}>‹</Text>
          </Pressable>
          <Text style={styles.title}>Join Circle</Text>
        </View>
        <Text style={styles.subtitle}>Enter the invite code a Circle member shared with you.</Text>

        <Text style={styles.label}>Invite code</Text>
        <TextInput
          style={styles.input}
          value={code}
          onChangeText={(value) => {
            setCode(value);
            setPreview(null);
            setPreviewError(null);
          }}
          placeholder="XXXX-XXXX-XXXX"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="characters"
          autoCorrect={false}
          editable={!joining}
          testID="join-circle-code"
        />

        {previewLoading ? (
          <View style={styles.stateBox} testID="join-preview-loading">
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : null}

        <Pressable
          style={({ pressed }) => [styles.lookupButton, pressed && styles.buttonPressed]}
          onPress={() => void onLookup()}
          disabled={previewLoading || joining}
          testID="join-lookup"
        >
          <Text style={styles.lookupButtonText}>Preview Circle</Text>
        </Pressable>

        {previewError ? <Text style={styles.error} testID="join-preview-error">{previewError}</Text> : null}
        {joinError ? <Text style={styles.error} testID="join-error">{joinError}</Text> : null}

        {preview ? (
          <View style={styles.previewCard} testID="join-preview">
            <View style={styles.previewAvatar}>
              {preview.avatarUrl ? (
                <Image source={{ uri: preview.avatarUrl }} style={styles.previewAvatarImage} />
              ) : (
                <Text style={styles.previewAvatarText}>{preview.name.charAt(0).toUpperCase()}</Text>
              )}
            </View>
            <Text style={styles.previewName}>{preview.name}</Text>
            <Text style={styles.previewMeta}>
              {preview.memberCount === 1 ? '1 member' : `${preview.memberCount} members`}
            </Text>
            {preview.memberCount < 5 ? (
              <Text style={styles.previewCapacity}>
                You can join — {5 - preview.memberCount} {5 - preview.memberCount === 1 ? 'spot' : 'spots'} left.
              </Text>
            ) : (
              <Text style={styles.previewCapacityFull}>This Circle is full.</Text>
            )}
            <Pressable
              style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]}
              onPress={() => void onJoin()}
              disabled={joining || preview.memberCount >= 5}
              testID="join-confirm"
            >
              {joining ? (
                <ActivityIndicator color={colors.text} />
              ) : (
                <Text style={styles.primaryButtonText}>Join this Circle</Text>
              )}
            </Pressable>
          </View>
        ) : null}

        <Pressable onPress={() => router.back()} style={styles.cancel} disabled={joining} testID="join-cancel">
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
    letterSpacing: 2,
  },
  stateBox: { marginTop: 24, alignItems: 'center' },
  lookupButton: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 16,
  },
  lookupButtonText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  error: { color: colors.error, fontSize: 13, marginTop: 14 },
  previewCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 24,
    marginTop: 24,
    alignItems: 'center',
  },
  previewAvatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  previewAvatarImage: { width: 72, height: 72 },
  previewAvatarText: { color: colors.text, fontSize: 30, fontWeight: '700' },
  previewName: { color: colors.text, fontSize: 18, fontWeight: '700', marginTop: 14 },
  previewMeta: { color: colors.textSecondary, fontSize: 13, marginTop: 4 },
  previewCapacity: { color: colors.success, fontSize: 12, marginTop: 8 },
  previewCapacityFull: { color: colors.warning, fontSize: 12, marginTop: 8 },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 32,
    alignItems: 'center',
    marginTop: 20,
    alignSelf: 'stretch',
  },
  primaryButtonText: { color: colors.text, fontSize: 15, fontWeight: '700' },
  cancel: { alignSelf: 'center', marginTop: 18, padding: 8 },
  cancelText: { color: colors.textMuted, fontSize: 14 },
  buttonPressed: { opacity: 0.85 },
});
