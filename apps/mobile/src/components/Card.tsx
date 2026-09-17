import React from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colors, radii, shadows, spacing } from '../design/tokens';

export type CardVariant = 'default' | 'elevated' | 'glass';

interface CardProps {
  children: React.ReactNode;
  variant?: CardVariant;
  onPress?: (event: GestureResponderEvent) => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Card({
  children,
  variant = 'default',
  onPress,
  style,
  testID,
}: CardProps): React.JSX.Element {
  const getBgColor = () => {
    switch (variant) {
      case 'elevated':
        return colors.surfaceElevated;
      case 'glass':
        return colors.surfaceGlass;
      case 'default':
      default:
        return colors.surface;
    }
  };

  const baseStyle: StyleProp<ViewStyle> = [
    styles.card,
    { backgroundColor: getBgColor() },
    variant === 'elevated' ? shadows.glow : shadows.card,
    style,
  ];

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        testID={testID}
        style={({ pressed }) => [
          baseStyle,
          pressed && styles.pressed,
        ]}
      >
        {children}
      </Pressable>
    );
  }

  return (
    <View style={baseStyle} testID={testID}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    overflow: 'hidden',
  },
  pressed: {
    opacity: 0.88,
    borderColor: colors.borderActive,
    transform: [{ scale: 0.985 }],
  },
});
