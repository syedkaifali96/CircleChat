import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Link } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../../src/auth/AuthContext';
import { apiFetch, uploadAndAssignAvatar } from '../../src/lib/api';
import { colors } from '../../src/design/tokens';

/**
 * Profile screen (M3): shows the authenticated user's profile (username is
 * fixed, per the MVP rule), links to the edit flow, and handles avatar
 * selection/upload with progress and error states. The avatar image itself
 * loads through a short-TTL presigned URL issued by the server after the
 * avatar access check — never a permanent public URL.
 */

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

export default function ProfileScreen() {
  const { user, updateUser, signOut } = useAuth();
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
    (async () => {
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

  if (!user) {
    return (
      <View style={styles.container} testID="profile-loading">
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

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
    if (result.canceled || result.assets.length === 0) {
      return;
    }
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
      const uri = await fetchAvatarUri(token);
      setAvatarUri(uri);
    } catch {
      setUploadError('Upload failed. Check your connection and try again.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <View style={styles.container} testID="profile-screen">
      <Pressable onPress={() => void onPickAvatar()} disabled={uploading} testID="avatar-button">
        {avatarUri ? (
          <Image source={{ uri: avatarUri }} style={styles.avatar} testID="avatar-image" />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder]} testID="avatar-placeholder">
            <Text style={styles.avatarInitial}>{user.displayName.charAt(0).toUpperCase()}</Text>
          </View>
        )}
        {uploading || avatarLoading ? (
          <ActivityIndicator style={styles.uploadIndicator} color={colors.accent} />
        ) : null}
      </Pressable>
      <Text style={styles.avatarHint} testID="avatar-hint">
        Tap the avatar to change it (JPG/PNG/WebP/GIF, max 2 MB)
      </Text>

      <Text style={styles.displayName} testID="profile-display-name">
        {user.displayName}
      </Text>
      <Text style={styles.username} testID="profile-username">
        @{user.username} · username cannot be changed
      </Text>
      {user.bio ? (
        <Text style={styles.bio} testID="profile-bio">
          {user.bio}
        </Text>
      ) : (
        <Text style={[styles.bio, styles.bioEmpty]} testID="profile-bio-empty">
          No bio yet.
        </Text>
      )}
      {uploadError ? (
        <Text style={styles.error} testID="profile-upload-error">
          {uploadError}
        </Text>
      ) : null}

      <Link href="/(app)/profile-edit" style={styles.editLink} testID="profile-edit-link">
        Edit profile
      </Link>
      <Link href="/(app)/app-lock" style={styles.editLink} testID="app-lock-link">
        App lock
      </Link>
      <Pressable
        style={({ pressed }) => [styles.logout, pressed && styles.pressed]}
        onPress={() => void signOut()}
        testID="profile-logout"
      >
        <Text style={styles.logoutText}>Log out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, alignItems: 'center', padding: 24 },
  avatar: {
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: colors.surface,
    marginTop: 48,
  },
  avatarPlaceholder: { alignItems: 'center', justifyContent: 'center', borderColor: colors.border, borderWidth: 1 },
  avatarInitial: { color: colors.accent, fontSize: 40, fontWeight: '700' },
  uploadIndicator: { position: 'absolute', top: 48 },
  avatarHint: { color: colors.textMuted, fontSize: 10, marginTop: 8 },
  displayName: { color: colors.text, fontSize: 24, fontWeight: '700', marginTop: 16 },
  username: { color: colors.textMuted, fontSize: 13, marginTop: 4 },
  bio: { color: colors.textSecondary, fontSize: 14, marginTop: 16, textAlign: 'center' },
  bioEmpty: { color: colors.textMuted, fontStyle: 'italic' },
  error: { color: colors.error, fontSize: 13, marginTop: 12 },
  editLink: { color: colors.accent, marginTop: 24, fontSize: 15, fontWeight: '600' },
  logout: {
    marginTop: 24,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 32,
    backgroundColor: colors.surface,
  },
  pressed: { opacity: 0.85 },
  logoutText: { color: colors.text, fontSize: 14, fontWeight: '600' },
});
