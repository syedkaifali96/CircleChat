import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '../../src/auth/AuthContext';
import { loadSessionToken } from '../../src/auth/session';
import { listCircles, type CircleListItem } from '../../src/lib/api';
import { colors } from '../../src/design/tokens';

/**
 * Home screen (M4, design.md §9): makes the user's Circles immediately
 * visible — Circle cards with name, member count and role — plus the two
 * quick actions (Create/Join). All state is fetched fresh; unread counts and
 * message previews arrive with M5 messaging. Server data is authoritative;
 * the UI only renders it.
 */

function memberLabel(count: number): string {
  return count === 1 ? '1 member' : `${count} members`;
}

export default function HomeScreen() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const [circles, setCircles] = useState<CircleListItem[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (token: string) => {
    setLoadError(false);
    try {
      const { circles: rows } = await listCircles(token);
      setCircles(rows);
    } catch {
      setLoadError(true);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const token = await loadSessionToken();
        if (!cancelled && token) {
          await load(token);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [load]),
  );

  const onRefresh = useCallback(async () => {
    const token = await loadSessionToken();
    if (!token) {
      return;
    }
    setRefreshing(true);
    await load(token);
    setRefreshing(false);
  }, [load]);

  const onLogout = async () => {
    await signOut();
    router.replace('/(auth)/login');
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      testID="home-screen"
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.accent} />
      }
    >
      <Text style={styles.title}>CircleChat</Text>
      {user ? (
        <Text style={styles.subtitle} testID="home-user">
          Signed in as {user.displayName} (@{user.username})
        </Text>
      ) : null}

      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>Your Circles</Text>
        <Link href="/(app)/profile" style={styles.profileLink} testID="home-profile-link">
          Profile
        </Link>
      </View>

      {circles === null && !loadError ? (
        <View style={styles.stateBox} testID="home-loading">
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : null}

      {loadError ? (
        <View style={styles.stateBox} testID="home-error">
          <Text style={styles.stateTitle}>Something went wrong.</Text>
          <Text style={styles.stateText}>Couldn't load your Circles. Check your connection.</Text>
          <Pressable
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
            onPress={() => void onRefresh()}
            testID="home-retry"
          >
            <Text style={styles.secondaryButtonText}>Try again</Text>
          </Pressable>
        </View>
      ) : null}

      {circles !== null && !loadError && circles.length === 0 ? (
        <View style={styles.stateBox} testID="home-empty">
          <Text style={styles.stateTitle}>Your little world starts here.</Text>
          <Text style={styles.stateText}>Create a Circle or join one with an invite code.</Text>
        </View>
      ) : null}

      {circles !== null && !loadError && circles.length > 0
        ? circles.map((circle) => (
            <Pressable
              key={circle.id}
              style={({ pressed }) => [styles.circleCard, pressed && styles.buttonPressed]}
              onPress={() => router.push(`/(app)/circles/${circle.id}`)}
              testID={`circle-card-${circle.id}`}
            >
              <View style={styles.circleAvatar}>
                <Text style={styles.circleAvatarText}>{circle.name.charAt(0).toUpperCase()}</Text>
              </View>
              <View style={styles.circleInfo}>
                <Text style={styles.circleName} numberOfLines={1}>{circle.name}</Text>
                <Text style={styles.circleMeta}>
                  {memberLabel(circle.membersCount)} · {circle.callerRole}
                </Text>
              </View>
            </Pressable>
          ))
        : null}

      <View style={styles.quickActions}>
        <Link href="/(app)/chats" asChild>
          <Pressable style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]} testID="home-chats">
            <Text style={styles.primaryButtonText}>Chats</Text>
          </Pressable>
        </Link>
        <Link href="/(app)/circles/create" asChild>
          <Pressable style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]} testID="home-create-circle">
            <Text style={styles.secondaryButtonText}>Create a Circle</Text>
          </Pressable>
        </Link>
      </View>
      <View style={styles.quickActions}>
        <Link href="/(app)/circles/join" asChild>
          <Pressable
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
            testID="home-join-circle"
          >
            <Text style={styles.secondaryButtonText}>Join a Circle</Text>
          </Pressable>
        </Link>
      </View>

      <Pressable
        style={({ pressed }) => [styles.logout, pressed && styles.buttonPressed]}
        onPress={() => void onLogout()}
        testID="logout-button"
      >
        <Text style={styles.logoutText}>Log out</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, paddingTop: 64 },
  title: { color: colors.text, fontSize: 28, fontWeight: '700' },
  subtitle: { color: colors.accent, fontSize: 14, marginTop: 8 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 28 },
  sectionTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  profileLink: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  stateBox: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    marginTop: 16,
    alignItems: 'center',
  },
  stateTitle: { color: colors.text, fontSize: 15, fontWeight: '700', textAlign: 'center' },
  stateText: { color: colors.textMuted, fontSize: 13, marginTop: 6, textAlign: 'center' },
  circleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginTop: 12,
  },
  circleAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleAvatarText: { color: colors.text, fontSize: 20, fontWeight: '700' },
  circleInfo: { flex: 1, marginLeft: 14 },
  circleName: { color: colors.text, fontSize: 16, fontWeight: '600' },
  circleMeta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  quickActions: { flexDirection: 'row', gap: 12, marginTop: 24 },
  primaryButton: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryButtonText: { color: colors.text, fontSize: 14, fontWeight: '700' },
  secondaryButton: {
    flex: 1,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryButtonText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  logout: {
    marginTop: 32,
    alignSelf: 'center',
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 32,
    backgroundColor: colors.surface,
  },
  buttonPressed: { opacity: 0.85 },
  logoutText: { color: colors.textMuted, fontSize: 14, fontWeight: '600' },
});
