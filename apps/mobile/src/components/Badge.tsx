import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radii, spacing } from '../design/tokens';

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
          text: colors.primaryContent,
          border: 'transparent',
        };
      case 'role':
        return {
          bg: colors.accentMuted,
          text: colors.accent,
          border: colors.accentBorder,
        };
      case 'success':
        return {
          bg: colors.successMuted,
          text: colors.success,
          border: colors.successBorder,
        };
      case 'warning':
        return {
          bg: colors.warningMuted,
          text: colors.warning,
          border: colors.warningBorder,
        };
      case 'error':
        return {
          bg: colors.errorMuted,
          text: colors.error,
          border: colors.errorBorder,
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
});
