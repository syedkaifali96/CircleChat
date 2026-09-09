import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { colors, radii, shadows } from '../design/tokens';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  onPress?: (event: GestureResponderEvent) => void;
  children?: React.ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  iconTrailing?: React.ReactNode;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  testID?: string;
}

export function Button({
  onPress,
  children,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  icon,
  iconTrailing,
  fullWidth = false,
  style,
  textStyle,
  testID,
}: ButtonProps): React.JSX.Element {
  const getVariantStyles = () => {
    switch (variant) {
      case 'primary':
        return {
          container: styles.primaryContainer,
          text: styles.primaryText,
          spinnerColor: colors.primaryContent,
        };
      case 'secondary':
        return {
          container: styles.secondaryContainer,
          text: styles.secondaryText,
          spinnerColor: colors.accent,
        };
      case 'outline':
        return {
          container: styles.outlineContainer,
          text: styles.outlineText,
          spinnerColor: colors.accent,
        };
      case 'danger':
        return {
          container: styles.dangerContainer,
          text: styles.dangerText,
          spinnerColor: colors.text,
        };
      case 'ghost':
      default:
        return {
          container: styles.ghostContainer,
          text: styles.ghostText,
          spinnerColor: colors.accent,
        };
    }
  };

  const getSizeStyles = () => {
    switch (size) {
      case 'sm':
        return {
          paddingVertical: 8,
          paddingHorizontal: 12,
          fontSize: 13,
          gap: 6,
        };
      case 'lg':
        return {
          paddingVertical: 16,
          paddingHorizontal: 24,
          fontSize: 16,
          gap: 10,
        };
      case 'md':
      default:
        return {
          paddingVertical: 12,
          paddingHorizontal: 18,
          fontSize: 15,
          gap: 8,
        };
    }
  };

  const v = getVariantStyles();
  const s = getSizeStyles();

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      testID={testID}
      style={({ pressed }) => [
        styles.base,
        v.container,
        {
          paddingVertical: s.paddingVertical,
          paddingHorizontal: s.paddingHorizontal,
          opacity: disabled ? 0.5 : pressed ? 0.88 : 1,
          transform: [{ scale: pressed && !disabled && !loading ? 0.98 : 1 }],
        },
        fullWidth && styles.fullWidth,
        variant === 'primary' && !disabled && shadows.glow,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={v.spinnerColor} />
      ) : (
        <View style={[styles.contentRow, { gap: s.gap }]}>
          {icon ? <View style={styles.icon}>{icon}</View> : null}
          {typeof children === 'string' ? (
            <Text style={[styles.text, v.text, { fontSize: s.fontSize }, textStyle]}>
              {children}
            </Text>
          ) : (
            children
          )}
          {iconTrailing ? <View style={styles.icon}>{iconTrailing}</View> : null}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullWidth: {
    width: '100%',
  },
  text: {
    fontWeight: '600',
    textAlign: 'center',
    includeFontPadding: false,
  },
  primaryContainer: {
    backgroundColor: colors.primary,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
  },
  primaryText: {
    color: colors.primaryContent,
  },
  secondaryContainer: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryText: {
    color: colors.text,
  },
  outlineContainer: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: colors.accent,
  },
  outlineText: {
    color: colors.accent,
  },
  dangerContainer: {
    backgroundColor: colors.error,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  dangerText: {
    color: colors.text,
  },
  ghostContainer: {
    backgroundColor: 'transparent',
  },
  ghostText: {
    color: colors.textSecondary,
  },
});
