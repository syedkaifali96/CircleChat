import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radii, spacing, typography } from '../design/tokens';

export type BadgeVariant = 'default' | 'primary' | 'unread' | 'role' | 'success' | 'warning' | 'error';
export type BadgeSize = 'sm' | 'md';

interface BadgeProps {
  label: string | number;
  variant?: BadgeVariant;
  size?: BadgeSize;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Badge({
  label,
  variant = 'default',
  size = 'md',
  style,
  testID,
}: BadgeProps): React.JSX.Element {
  const isSm = size === 'sm';

  const getVariantStyles = () => {
    switch (variant) {
      case 'primary':
      case 'unread':
        return {
          bg: colors.primary,
          text: colors.text,
          border: 'transparent',
        };
      case 'role':
        return {
          bg: 'rgba(167, 139, 250, 0.15)',
          text: colors.accent,
          border: 'rgba(167, 139, 250, 0.3)',
        };
      case 'success':
        return {
          bg: 'rgba(34, 197, 94, 0.15)',
          text: colors.success,
          border: 'rgba(34, 197, 94, 0.3)',
        };
      case 'warning':
        return {
          bg: 'rgba(245, 158, 11, 0.15)',
          text: colors.warning,
          border: 'rgba(245, 158, 11, 0.3)',
        };
      case 'error':
        return {
          bg: 'rgba(239, 68, 68, 0.15)',
          text: colors.error,
          border: 'rgba(239, 68, 68, 0.3)',
        };
      default:
        return {
          bg: colors.surfaceElevated,
          text: colors.textSecondary,
          border: colors.border,
        };
    }
  };

  const v = getVariantStyles();

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: v.bg,
          borderColor: v.border,
          paddingVertical: isSm ? 2 : 4,
          paddingHorizontal: isSm ? spacing.xs + 2 : spacing.sm + 2,
        },
        variant === 'unread' && styles.unreadShadow,
        style,
      ]}
      testID={testID}
    >
      <Text
        style={[
          styles.label,
          {
            color: v.text,
            fontSize: isSm ? 10 : 12,
            lineHeight: isSm ? 13 : 16,
          },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: radii.full,
    borderWidth: 1,
    alignSelf: 'flex-start',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontWeight: '700',
    includeFontPadding: false,
    textTransform: 'capitalize',
  },
  unreadShadow: {
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
    elevation: 3,
  },
});
