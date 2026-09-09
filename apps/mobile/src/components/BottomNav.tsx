import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeInsets } from '../lib/safeInsets';
import { colors, radii, shadows, spacing } from '../design/tokens';
import { Icon } from './Icon';

export type BottomNavTab = 'home' | 'chats' | 'profile';

// Tab switches replace the current route so repeated navigation never builds
// a deep back stack of top-level destinations.
type TabRoute = '/(app)/home' | '/(app)/chats' | '/(app)/profile';

interface BottomNavProps {
  activeTab: BottomNavTab;
}

export function BottomNav({ activeTab }: BottomNavProps): React.JSX.Element {
  const router = useRouter();
  const insets = useSafeInsets();

  const tabs: { key: BottomNavTab; label: string; icon: 'circles' | 'chat' | 'profile'; route: TabRoute; testID?: string }[] = [
    { key: 'home', label: 'Circles', icon: 'circles', route: '/(app)/home', testID: 'bottom-nav-home' },
    { key: 'chats', label: 'Chats', icon: 'chat', route: '/(app)/chats', testID: 'bottom-nav-chats' },
    { key: 'profile', label: 'Profile', icon: 'profile', route: '/(app)/profile', testID: 'bottom-nav-profile' },
  ];

  const bottomPadding = Math.max(insets.bottom, 10) + 6;

  return (
    <View style={[styles.wrapper, { paddingBottom: bottomPadding }]}>
      <View style={styles.container}>
        {tabs.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <Pressable
              key={tab.key}
              onPress={() => {
                if (!isActive) {
                  router.replace(tab.route);
                }
              }}
              style={({ pressed }) => [
                styles.tab,
                isActive && styles.activeTab,
                pressed && styles.pressed,
              ]}
              testID={tab.testID}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
            >
              <Icon
                name={tab.icon}
                size={18}
                color={isActive ? colors.accent : colors.textMuted}
              />
              <Text
                style={[
                  styles.label,
                  isActive ? styles.activeLabel : styles.inactiveLabel,
                ]}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    backgroundColor: colors.background,
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.xxl,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    ...shadows.subtle,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    paddingVertical: 7,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.full,
    flexDirection: 'column',
    gap: 3,
  },
  activeTab: {
    backgroundColor: colors.backgroundElevated,
  },
  pressed: {
    opacity: 0.75,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    includeFontPadding: false,
  },
  activeLabel: {
    color: colors.text,
  },
  inactiveLabel: {
    color: colors.textMuted,
  },
});
