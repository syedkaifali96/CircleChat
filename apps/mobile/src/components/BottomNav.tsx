import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeInsets } from '../lib/safeInsets';
import { colors, radii, shadows, spacing } from '../design/tokens';
import { Icon } from './Icon';

export type BottomNavTab = 'home' | 'chats' | 'profile';

interface BottomNavProps {
  activeTab: BottomNavTab;
}

export function BottomNav({ activeTab }: BottomNavProps): React.JSX.Element {
  const router = useRouter();
  const insets = useSafeInsets();

  const tabs: { key: BottomNavTab; label: string; icon: 'circles' | 'chat' | 'profile'; route: string; testID?: string }[] = [
    { key: 'home', label: 'Circles', icon: 'circles', route: '/(app)/home', testID: 'bottom-nav-home' },
    { key: 'chats', label: 'Direct', icon: 'chat', route: '/(app)/chats', testID: 'bottom-nav-chats' },
    { key: 'profile', label: 'Profile', icon: 'profile', route: '/(app)/profile', testID: 'bottom-nav-profile' },
  ];

  const bottomPadding = Math.max(insets.bottom, 12) + 8;

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
                  router.push(tab.route as any);
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
    paddingTop: 4,
    backgroundColor: 'transparent',
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.full,
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
    ...shadows.card,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.full,
    flexDirection: 'row',
    gap: 8,
  },
  activeTab: {
    backgroundColor: 'rgba(124, 58, 237, 0.28)',
    borderWidth: 1,
    borderColor: 'rgba(167, 139, 250, 0.4)',
  },
  pressed: {
    opacity: 0.75,
  },
  label: {
    fontSize: 13,
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
