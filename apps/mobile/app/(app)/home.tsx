import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeInsets } from '../../src/lib/safeInsets';
import { useAuth } from '../../src/auth/AuthContext';
import { loadSessionToken } from '../../src/auth/session';
import { listCircles, type CircleListItem } from '../../src/lib/api';
import { colors, radii, shadows, spacing, typography } from '../../src/design/tokens';
import { Avatar } from '../../src/components/Avatar';
import { BottomNav } from '../../src/components/BottomNav';
import { Icon } from '../../src/components/Icon';

function memberLabel(count: number): string {
  return count === 1 ? '1 member' : `${count} members`;
}

export default function HomeScreen() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const insets = useSafeInsets();
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
      void (async () => {
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
    if (!token) return;
    setRefreshing(true);
    await load(token);
    setRefreshing(false);
  }, [load]);

  const onLogout = async () => {
    await signOut();
    router.replace('/(auth)/login');
  };

  const topPadding = Math.max(insets.top, spacing.xl) + spacing.md;
  const featuredCircle = circles?.[0];

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingTop: topPadding }]}
        testID="home-screen"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.primary} />
        }
      >
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>YOUR PRIVATE WORLD</Text>
            <Text style={styles.title}>Good to see you, {user?.displayName ?? 'friend'}</Text>
            {user ? (
              <Text style={styles.signedIn} testID="home-user">
                Signed in as {user.displayName} (@{user.username})
              </Text>
            ) : null}
          </View>
          <Pressable
            onPress={() => router.push('/(app)/profile')}
            style={({ pressed }) => [styles.profileButton, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Open profile"
            testID="home-profile-link"
          >
            <Avatar name={user?.displayName || user?.username || 'Profile'} size="md" />
          </Pressable>
        </View>

        {featuredCircle ? (
          <Pressable
            onPress={() => router.push(`/(app)/circles/${featuredCircle.id}`)}
            style={({ pressed }) => [styles.featured, pressed && styles.pressed]}
            accessibilityRole="button"
          >
            <View style={styles.featuredMark}>
              <View style={styles.featuredRing}>
                <Icon name="circles" size={28} color={colors.primary} />
              </View>
            </View>
            <View style={styles.featuredCopy}>
              <Text style={styles.featuredLabel}>OPEN YOUR CIRCLE</Text>
              <Text style={styles.featuredName} numberOfLines={1}>{featuredCircle.name}</Text>
              <Text style={styles.featuredMeta}>
                {memberLabel(featuredCircle.membersCount)}
                {featuredCircle.unreadCount ? ` · ${featuredCircle.unreadCount} unread` : ' · All caught up'}
              </Text>
            </View>
            <Icon name="chevron-right" size={22} color={colors.textSecondary} />
          </Pressable>
        ) : null}

        <View style={styles.actionRow}>
          <Pressable
            onPress={() => router.push('/(app)/circles/create')}
            style={({ pressed }) => [styles.primaryAction, pressed && styles.pressed]}
            testID="home-create-circle"
          >
            <Icon name="plus" size={16} color={colors.primaryContent} />
            <Text style={styles.primaryActionText}>Create Circle</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push('/(app)/circles/join')}
            style={({ pressed }) => [styles.secondaryAction, pressed && styles.pressed]}
            testID="home-join-circle"
          >
            <Text style={styles.secondaryActionText}>Join with code</Text>
          </Pressable>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Your Circles</Text>
          <Pressable
            onPress={() => router.push('/(app)/chats')}
            style={({ pressed }) => [styles.allChats, pressed && styles.pressed]}
            testID="home-chats"
          >
            <Text style={styles.allChatsText}>All chats</Text>
            <Icon name="chevron-right" size={16} color={colors.accent} />
          </Pressable>
        </View>

        {circles === null && !loadError ? (
          <View style={styles.state} testID="home-loading">
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.stateText}>Loading your Circles…</Text>
          </View>
        ) : null}

        {loadError ? (
          <View style={styles.state} testID="home-error">
            <View style={styles.stateIcon}><Icon name="close" size={18} color={colors.error} /></View>
            <Text style={styles.stateTitle}>Couldn’t load your Circles</Text>
            <Text style={styles.stateText}>Check your connection and try again.</Text>
            <Pressable onPress={() => void onRefresh()} style={styles.retry} testID="home-retry">
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        ) : null}

        {circles !== null && !loadError && circles.length === 0 ? (
          <View style={styles.state} testID="home-empty">
            <View style={styles.emptyIcon}><Icon name="sparkle" size={26} color={colors.primary} /></View>
            <Text style={styles.stateTitle}>Your little world starts here.</Text>
            <Text style={styles.stateText}>Create a Circle or join one with an invite code.</Text>
          </View>
        ) : null}

        {circles !== null && !loadError && circles.length > 0 ? (
          <View style={styles.list}>
            {circles.map((circle) => (
              <Pressable
                key={circle.id}
                onPress={() => router.push(`/(app)/circles/${circle.id}`)}
                style={({ pressed }) => [styles.circleRow, pressed && styles.pressed]}
                testID={`circle-card-${circle.id}`}
              >
                <Avatar name={circle.name} size="lg" />
                <View style={styles.circleCopy}>
                  <Text style={styles.circleName} numberOfLines={1}>{circle.name}</Text>
                  <Text style={styles.circleMeta}>
                    {memberLabel(circle.membersCount)} · {circle.callerRole}
                  </Text>
                </View>
                {circle.unreadCount && circle.unreadCount > 0 ? (
                  <View style={styles.unread}><Text style={styles.unreadText}>{circle.unreadCount}</Text></View>
                ) : (
                  <Icon name="chevron-right" size={20} color={colors.textMuted} />
                )}
              </Pressable>
            ))}
          </View>
        ) : null}

        <Pressable
          onPress={() => void onLogout()}
          style={({ pressed }) => [styles.logout, pressed && styles.pressed]}
          testID="logout-button"
        >
          <Icon name="logout" size={16} color={colors.textMuted} />
          <Text style={styles.logoutText}>Log out</Text>
        </Pressable>
      </ScrollView>
      <BottomNav activeTab="home" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xl },
  headerCopy: { flex: 1, paddingRight: spacing.md },
  eyebrow: { ...typography.captionStrong, color: colors.textMuted, letterSpacing: 1.2 },
  title: { ...typography.h2, color: colors.text, marginTop: spacing.xs },
  signedIn: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  profileButton: { borderRadius: radii.xl },
  featured: {
    minHeight: 126,
    padding: spacing.lg,
    borderRadius: radii.xxl,
    backgroundColor: colors.surfaceElevated,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    ...shadows.card,
  },
  featuredMark: { width: 68, height: 68, borderRadius: radii.xxl, backgroundColor: colors.accentMuted, alignItems: 'center', justifyContent: 'center' },
  featuredRing: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.backgroundElevated, alignItems: 'center', justifyContent: 'center' },
  featuredCopy: { flex: 1 },
  featuredLabel: { ...typography.captionStrong, color: colors.primary, letterSpacing: 0.8 },
  featuredName: { ...typography.h2, color: colors.text, marginTop: spacing.xs },
  featuredMeta: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xs },
  actionRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  primaryAction: { flex: 1, minHeight: 48, borderRadius: radii.lg, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  primaryActionText: { ...typography.button, color: colors.primaryContent },
  secondaryAction: { flex: 1, minHeight: 48, borderRadius: radii.lg, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  secondaryActionText: { ...typography.button, color: colors.text },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xxxl, marginBottom: spacing.sm },
  sectionTitle: { ...typography.h3, color: colors.text },
  allChats: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingLeft: spacing.md },
  allChatsText: { ...typography.captionStrong, color: colors.accent },
  list: {},
  circleRow: { minHeight: 78, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  circleCopy: { flex: 1 },
  circleName: { ...typography.bodyStrong, color: colors.text },
  circleMeta: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xs },
  unread: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  unreadText: { ...typography.captionStrong, color: colors.primaryContent },
  state: { padding: spacing.xxl, borderRadius: radii.xxl, backgroundColor: colors.surface, alignItems: 'center', gap: spacing.sm },
  stateIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.errorMuted, alignItems: 'center', justifyContent: 'center' },
  emptyIcon: { width: 56, height: 56, borderRadius: radii.xxl, backgroundColor: colors.primaryGlow, alignItems: 'center', justifyContent: 'center' },
  stateTitle: { ...typography.bodyStrong, color: colors.text, textAlign: 'center' },
  stateText: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
  retry: { minHeight: 44, paddingHorizontal: spacing.xl, borderRadius: radii.lg, backgroundColor: colors.surfaceElevated, alignItems: 'center', justifyContent: 'center' },
  retryText: { ...typography.button, color: colors.text },
  logout: { minHeight: 48, marginTop: spacing.xxl, flexDirection: 'row', gap: spacing.sm, alignItems: 'center', justifyContent: 'center' },
  logoutText: { ...typography.captionStrong, color: colors.textMuted },
  pressed: { opacity: 0.78, transform: [{ scale: 0.985 }] },
});
