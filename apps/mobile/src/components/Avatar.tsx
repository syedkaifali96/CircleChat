import React from 'react';
import { Image, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors } from '../design/tokens';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

interface AvatarProps {
  name: string;
  uri?: string | null;
  size?: AvatarSize;
  online?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const SIZE_MAP: Record<AvatarSize, { dimension: number; fontSize: number; dotSize: number }> = {
  xs: { dimension: 24, fontSize: 11, dotSize: 7 },
  sm: { dimension: 32, fontSize: 14, dotSize: 9 },
  md: { dimension: 44, fontSize: 18, dotSize: 11 },
  lg: { dimension: 56, fontSize: 24, dotSize: 13 },
  xl: { dimension: 72, fontSize: 32, dotSize: 16 },
};

const ACCENT_COLORS = ['#F58A7A', '#D4B5FF', '#92B7E8', '#71B7A2', '#E6B977', '#C58EA8'];

function getColorForName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash + name.charCodeAt(i) * (i + 1)) % ACCENT_COLORS.length;
  }
  return ACCENT_COLORS[hash] ?? colors.primary;
}

export function Avatar({
  name,
  uri,
  size = 'md',
  online,
  style,
  testID,
}: AvatarProps): React.JSX.Element {
  const { dimension, fontSize, dotSize } = SIZE_MAP[size];
  const initial = (name.trim().charAt(0) || '?').toUpperCase();
  const bgColor = getColorForName(name);

  return (
    <View style={[styles.container, { width: dimension, height: dimension }, style]} testID={testID}>
      {uri ? (
        <Image
          source={{ uri }}
          style={[styles.image, { width: dimension, height: dimension, borderRadius: dimension * 0.34 }]}
        />
      ) : (
        <View
          style={[
            styles.fallback,
            {
              width: dimension,
              height: dimension,
              borderRadius: dimension * 0.34,
              backgroundColor: bgColor,
            },
          ]}
        >
          <Text style={[styles.initial, { fontSize }]}>{initial}</Text>
        </View>
      )}

      {online !== undefined ? (
        <View
          style={[
            styles.dot,
            {
              width: dotSize,
              height: dotSize,
              borderRadius: dotSize / 2,
              backgroundColor: online ? colors.success : colors.textMuted,
              borderWidth: size === 'xs' || size === 'sm' ? 1.5 : 2,
            },
          ]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    backgroundColor: colors.surface,
  },
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.borderActive,
  },
  initial: {
    color: colors.text,
    fontWeight: '700',
    includeFontPadding: false,
  },
  dot: {
    position: 'absolute',
    bottom: -1,
    right: -1,
    borderColor: colors.surface,
  },
});
