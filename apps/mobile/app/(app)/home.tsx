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
import { Link, useRouter, useFocusEffect } from 'expo-router';
import { useSafeInsets } from '../../src/lib/safeInsets';
import { useAuth } from '../../src/auth/AuthContext';
import { loadSessionToken } from '../../src/auth/session';
import { listCircles, type CircleListItem } from '../../src/lib/api';
import { colors, radii, shadows, spacing, typography } from '../../src/design/tokens';
import { Avatar } from '../../src/components/Avatar';
import { Badge } from '../../src/components/Badge';
import { BottomNav } from '../../src/components/BottomNav';
import { Icon } from '../../src/components/Icon';

/**
 * Home screen (design.md §9): makes the user's Circles immediately
 * visible with rich Circle cards, identity badges, and quick actions.
 */

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

  const topPadding = Math.max(insets.top, 24) + 16;

  return (
    <View style={styles.screenWrapper}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingTop: topPadding }]}
        testID="home-screen"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.accent} />
        }
      >
        {/* Brand Bar */}
        <View style={styles.brandRow}>
          <View style={styles.brandBadge}>
            <View style={styles.brandDot} />
            <Text style={styles.title}>CircleChat</Text>
          </View>
          <Link href="/(app)/profile" style={styles.profileLink} testID="home-profile-link">
            Profile
          </Link>
        </View>

        {/* User Card */}
        {user ? (
          <View style={styles.userCard}>
            <Avatar name={user.displayName || user.username} size="md" />
            <View style={styles.userInfo}>
              <Text style={styles.greetingText}>WELCOME BACK 👋</Text>
              <Text style={styles.subtitle} testID="home-user">
                Signed in as {user.displayName} (@{user.username})
              </Text>
            </View>
          </View>
        ) : null}

        {/* Quick Actions Grid */}
        <View style={styles.quickActionsContainer}>
          <View style={styles.quickActionsRow}>
            <Pressable
              onPress={() => router.push('/(app)/chats')}
              style={({ pressed }) => [styles.quickActionPrimary, pressed && styles.buttonPressed]}
              testID="home-chats"
            >
              <View style={styles.actionIconBadgePrimary}>
                <Icon name="chat" size={16} color={colors.text} />
              </View>
              <Text style={styles.primaryButtonText}>Chats</Text>
            </Pressable>

            <Pressable
              onPress={() => router.push('/(app)/circles/create')}
              style={({ pressed }) => [styles.quickActionSecondary, pressed && styles.buttonPressed]}
              testID="home-create-circle"
            >
              <View style={styles.actionIconBadgeSecondary}>
                <Icon name="plus" size={14} color={colors.accent} />
              </View>
              <Text style={styles.secondaryButtonText}>Create a Circle</Text>
            </Pressable>
          </View>

          <Pressable
            onPress={() => router.push('/(app)/circles/join')}
            style={({ pressed }) => [styles.quickActionSecondaryFull, pressed && styles.buttonPressed]}
            testID="home-join-circle"
          >
            <View style={styles.actionIconBadgeSecondary}>
              <Icon name="circles" size={16} color={colors.accent} />
            </View>
            <Text style={styles.secondaryButtonText}>Join a Circle</Text>
          </Pressable>
        </View>

        {/* Section Header */}
        <View style={styles.sectionHeaderRow}>
          <View style={styles.sectionTitleGroup}>
            <Text style={styles.sectionTitle}>Your Circles</Text>
            {circles && circles.length > 0 ? (
              <Badge label={circles.length} size="sm" variant="default" />
            ) : null}
          </View>
        </View>

        {/* Loading State */}
        {circles === null && !loadError ? (
          <View style={styles.stateBox} testID="home-loading">
            <ActivityIndicator color={colors.accent} size="small" />
            <Text style={styles.loadingText}>Loading your spaces...</Text>
          </View>
        ) : null}

        {/* Error State */}
        {loadError ? (
          <View style={styles.stateBox} testID="home-error">
            <View style={styles.errorIconBadge}>
              <Icon name="close" size={16} color={colors.error} />
            </View>
            <Text style={styles.stateTitle}>Something went wrong.</Text>
            <Text style={styles.stateText}>Couldn't load your Circles. Check your connection.</Text>
            <Pressable
              style={({ pressed }) => [styles.retryButton, pressed && styles.buttonPressed]}
              onPress={() => void onRefresh()}
              testID="home-retry"
            >
              <Text style={styles.retryButtonText}>Try again</Text>
            </Pressable>
          </View>
        ) : null}

        {/* Empty State */}
        {circles !== null && !loadError && circles.length === 0 ? (
          <View style={styles.emptyContainer} testID="home-empty">
            <View style={styles.emptyIconBadge}>
              <Icon name="sparkle" size={26} color={colors.accent} />
            </View>
            <Text style={styles.stateTitle}>Your little world starts here.</Text>
            <Text style={styles.stateText}>Create a Circle or join one with an invite code.</Text>
          </View>
        ) : null}

        {/* Circles List */}
        {circles !== null && !loadError && circles.length > 0 ? (
          <View style={styles.circleList}>
            {circles.map((circle) => (
              <Pressable
                key={circle.id}
                style={({ pressed }) => [styles.circleCard, pressed && styles.buttonPressed]}
                onPress={() => router.push(`/(app)/circles/${circle.id}`)}
                testID={`circle-card-${circle.id}`}
              >
                <Avatar name={circle.name} size="md" />

                <View style={styles.circleInfo}>
                  <View style={styles.circleTitleRow}>
                    <Text style={styles.circleName} numberOfLines={1}>
                      {circle.name}
                    </Text>
                    {circle.unreadCount && circle.unreadCount > 0 ? (
                      <Badge label={circle.unreadCount} variant="unread" size="sm" />
                    ) : null}
                  </View>

                  <View style={styles.circleMetaRow}>
                    <Text style={styles.circleMeta}>
                      {memberLabel(circle.membersCount)} · {circle.callerRole}
                    </Text>
                  </View>
                </View>

                <Icon name="chevron-right" size={18} color={colors.textMuted} />
              </Pressable>
            ))}
          </View>
        ) : null}

        {/* Logout Action */}
        <Pressable
          style={({ pressed }) => [styles.logout, pressed && styles.buttonPressed]}
          onPress={() => void onLogout()}
          testID="logout-button"
        >
          <Icon name="logout" size={15} color={colors.textMuted} />
          <Text style={styles.logoutText}>Log out</Text>
        </Pressable>
      </ScrollView>

      {/* Docked Bottom Navigation with Safe Area */}
      <BottomNav activeTab="home" />
    </View>
  );
}

const styles = StyleSheet.create({
  screenWrapper: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  brandBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  brandDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
    ...shadows.glow,
  },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  profileLink: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '600',
    paddingVertical: 6,
    paddingHorizontal: 16,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.lg,
    gap: spacing.md,
    ...shadows.subtle,
  },
  userInfo: {
    flex: 1,
  },
  greetingText: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  subtitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
    marginTop: 2,
  },
  quickActionsContainer: {
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  quickActionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  quickActionPrimary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radii.xl,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    ...shadows.glow,
  },
  quickActionSecondary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.xl,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
  },
  quickActionSecondaryFull: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.xl,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
  },
  actionIconBadgePrimary: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionIconBadgeSecondary: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(124, 58, 237, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(167, 139, 250, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  secondaryButtonText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  sectionTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  circleList: {
    gap: spacing.sm,
  },
  circleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.md,
    ...shadows.card,
  },
  circleInfo: {
    flex: 1,
  },
  circleTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  circleName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
  },
  circleMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: 4,
  },
  circleMeta: {
    color: colors.textMuted,
    fontSize: 12,
  },
  stateBox: {
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    marginVertical: spacing.md,
    alignItems: 'center',
    gap: spacing.xs,
  },
  loadingText: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: spacing.xs,
  },
  errorIconBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  stateTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  stateText: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: 4,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: spacing.md,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingVertical: 10,
    paddingHorizontal: spacing.lg,
  },
  retryButtonText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  emptyContainer: {
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xxl,
    marginVertical: spacing.md,
    alignItems: 'center',
  },
  emptyIconBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(124, 58, 237, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(167, 139, 250, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  logout: {
    marginTop: spacing.xl,
    marginBottom: spacing.md,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.full,
    paddingVertical: 10,
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.surfaceElevated,
  },
  buttonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  logoutText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
});
