import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../../src/auth/AuthContext';
import { apiFetch, uploadAndAssignAvatar } from '../../src/lib/api';
import { useSafeInsets } from '../../src/lib/safeInsets';
import { colors, radii, shadows, spacing, typography } from '../../src/design/tokens';
import { BottomNav } from '../../src/components/BottomNav';
import { Icon, type IconName } from '../../src/components/Icon';

async function fetchAvatarUri(token: string): Promise<string | null> {
  try {
    const res = await apiFetch<{ url: string }>(
      `${process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000'}/v1/users/me/avatar-url`,
      { method: 'GET', token },
    );
    return res.url;
  } catch {
    return null;
  }
}

interface SettingsRowProps {
  icon: IconName;
  title: string;
  detail: string;
  onPress: () => void;
  testID: string;
}

function SettingsRow({ icon, title, detail, onPress, testID }: SettingsRowProps) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.settingsRow, pressed && styles.pressed]} testID={testID}>
      <View style={styles.settingsIcon}><Icon name={icon} size={19} color={colors.accent} /></View>
      <View style={styles.settingsCopy}>
        <Text style={styles.settingsTitle}>{title}</Text>
        <Text style={styles.settingsDetail}>{detail}</Text>
      </View>
      <Icon name="chevron-right" size={20} color={colors.textMuted} />
    </Pressable>
  );
}

export default function ProfileScreen() {
  const { user, updateUser, signOut } = useAuth();
  const router = useRouter();
  const insets = useSafeInsets();
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.avatarMediaId) {
      setAvatarUri(null);
      return;
    }
    let cancelled = false;
    setAvatarLoading(true);
    void (async () => {
      const session = await import('../../src/auth/session');
      const token = (await session.loadSessionToken()) ?? '';
      const uri = await fetchAvatarUri(token);
      if (!cancelled) {
        setAvatarUri(uri);
        setAvatarLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.avatarMediaId]);

  const onPickAvatar = async () => {
    setUploadError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setUploadError('Media library permission is required to change the avatar.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.8,
    });
    if (result.canceled || result.assets.length === 0) return;

    const asset = result.assets[0]!;
    const mimeType = asset.mimeType ?? 'image/jpeg';
    setUploading(true);
    try {
      const fileResponse = await fetch(asset.uri);
      const blob = await fileResponse.blob();
      if (blob.size > 2 * 1024 * 1024) {
        setUploadError('Avatar must be 2 MB or smaller.');
        return;
      }
      const session = await import('../../src/auth/session');
      const token = (await session.loadSessionToken()) ?? '';
      const updated = await uploadAndAssignAvatar(token, asset.uri, mimeType, blob.size);
      updateUser(updated.user);
      setAvatarUri(await fetchAvatarUri(token));
    } catch {
      setUploadError('Upload failed. Check your connection and try again.');
    } finally {
      setUploading(false);
    }
  };

  if (!user) {
    return (
      <View style={styles.loading} testID="profile-loading">
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: Math.max(insets.top, spacing.xl) + spacing.md }]}
        testID="profile-screen"
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>YOUR SPACE</Text>
            <Text style={styles.pageTitle}>Profile</Text>
          </View>
          <View style={styles.lockMark}><Icon name="lock" size={18} color={colors.primary} /></View>
        </View>

        <View style={styles.hero}>
          <Pressable
            onPress={() => void onPickAvatar()}
            disabled={uploading}
            style={({ pressed }) => [styles.avatarButton, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Change profile photo"
            testID="avatar-button"
          >
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.avatar} testID="avatar-image" />
            ) : (
              <View style={[styles.avatar, styles.avatarPlaceholder]} testID="avatar-placeholder">
                <Text style={styles.avatarInitial}>{user.displayName.charAt(0).toUpperCase()}</Text>
              </View>
            )}
            <View style={styles.cameraBadge}><Icon name="plus" size={15} color={colors.background} /></View>
            {uploading || avatarLoading ? <ActivityIndicator style={styles.uploadIndicator} color={colors.text} /> : null}
          </Pressable>

          <Text style={styles.displayName} testID="profile-display-name">{user.displayName}</Text>
          <Text style={styles.username} testID="profile-username">@{user.username}</Text>
          {user.bio ? (
            <Text style={styles.bio} testID="profile-bio">{user.bio}</Text>
          ) : (
            <Text style={[styles.bio, styles.bioEmpty]} testID="profile-bio-empty">Your little private world.</Text>
          )}
          <Text style={styles.avatarHint} testID="avatar-hint">Tap your photo to update it</Text>
          {uploadError ? <Text style={styles.error} testID="profile-upload-error">{uploadError}</Text> : null}
        </View>

        <View style={styles.settings}>
          <SettingsRow
            icon="profile"
            title="Edit profile"
            detail="Name, bio and profile photo"
            onPress={() => router.push('/(app)/profile-edit')}
            testID="profile-edit-link"
          />
          <SettingsRow
            icon="lock"
            title="Privacy & app lock"
            detail="PIN and biometric protection"
            onPress={() => router.push('/(app)/app-lock')}
            testID="app-lock-link"
          />
          <SettingsRow
            icon="bell"
            title="Notifications"
            detail="Messages, sound and previews"
            onPress={() => router.push('/(app)/notification-settings')}
            testID="notification-settings-link"
          />
        </View>

        <Pressable onPress={() => void signOut()} style={({ pressed }) => [styles.logout, pressed && styles.pressed]} testID="profile-logout">
          <Icon name="logout" size={17} color={colors.primary} />
          <Text style={styles.logoutText}>Log out</Text>
        </Pressable>
      </ScrollView>
      <BottomNav activeTab="profile" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  loading: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xl },
  eyebrow: { ...typography.captionStrong, color: colors.textMuted, letterSpacing: 1.2 },
  pageTitle: { ...typography.h1, color: colors.text, marginTop: spacing.xs },
  lockMark: { width: 44, height: 44, borderRadius: 16, backgroundColor: colors.primaryGlow, alignItems: 'center', justifyContent: 'center' },
  hero: { alignItems: 'center', paddingVertical: spacing.md },
  avatarButton: { width: 104, height: 104 },
  avatar: { width: 104, height: 104, borderRadius: 35, backgroundColor: colors.surface },
  avatarPlaceholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
  avatarInitial: { color: colors.background, fontSize: 40, fontWeight: '700' },
  cameraBadge: { position: 'absolute', right: -4, bottom: -4, width: 36, height: 36, borderRadius: 13, borderWidth: 3, borderColor: colors.background, backgroundColor: colors.text, alignItems: 'center', justifyContent: 'center' },
  uploadIndicator: { position: 'absolute', left: 40, top: 40 },
  displayName: { ...typography.h2, color: colors.text, marginTop: spacing.lg },
  username: { ...typography.body, color: colors.textMuted, marginTop: spacing.xs },
  bio: { ...typography.body, color: colors.textSecondary, marginTop: spacing.md, textAlign: 'center' },
  bioEmpty: { color: colors.textMuted },
  avatarHint: { ...typography.caption, color: colors.textMuted, marginTop: spacing.sm },
  error: { ...typography.caption, color: colors.error, marginTop: spacing.md, textAlign: 'center' },
  settings: { marginTop: spacing.xl, borderRadius: radii.xxl, backgroundColor: colors.surface, paddingHorizontal: spacing.md, ...shadows.subtle },
  settingsRow: { minHeight: 74, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  settingsIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.backgroundElevated, alignItems: 'center', justifyContent: 'center' },
  settingsCopy: { flex: 1 },
  settingsTitle: { ...typography.bodyStrong, color: colors.text },
  settingsDetail: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  logout: { minHeight: 50, marginTop: spacing.xl, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.primaryBorder, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  logoutText: { ...typography.button, color: colors.primary },
  pressed: { opacity: 0.78, transform: [{ scale: 0.985 }] },
});
