import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Avatar, type AvatarSize } from './Avatar';
import { colors } from '../design/tokens';

interface AvatarGroupItem {
  id: string;
  name: string;
  uri?: string | null;
}

interface AvatarGroupProps {
  items: AvatarGroupItem[];
  max?: number;
  size?: AvatarSize;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const OVERLAP_MAP: Record<AvatarSize, number> = {
  xs: 8,
  sm: 10,
  md: 14,
  lg: 18,
  xl: 22,
};

const BUBBLE_SIZE_MAP: Record<AvatarSize, { dimension: number; fontSize: number }> = {
  xs: { dimension: 24, fontSize: 10 },
  sm: { dimension: 32, fontSize: 12 },
  md: { dimension: 44, fontSize: 14 },
  lg: { dimension: 56, fontSize: 16 },
  xl: { dimension: 72, fontSize: 20 },
};

export function AvatarGroup({
  items,
  max = 3,
  size = 'sm',
  style,
  testID,
}: AvatarGroupProps): React.JSX.Element {
  const visible = items.slice(0, max);
  const remaining = items.length - max;
  const overlap = OVERLAP_MAP[size];
  const { dimension, fontSize } = BUBBLE_SIZE_MAP[size];

  return (
    <View style={[styles.container, style]} testID={testID}>
      {visible.map((item, index) => (
        <View
          key={item.id}
          style={[
            styles.itemWrapper,
            index > 0 && { marginLeft: -overlap },
            { zIndex: visible.length - index },
          ]}
        >
          <Avatar name={item.name} uri={item.uri} size={size} />
        </View>
      ))}

      {remaining > 0 ? (
        <View
          style={[
            styles.remainingBubble,
            {
              width: dimension,
              height: dimension,
              borderRadius: dimension / 2,
              marginLeft: -overlap,
              zIndex: 0,
            },
          ]}
        >
          <Text style={[styles.remainingText, { fontSize }]}>+{remaining}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  itemWrapper: {
    borderWidth: 2,
    borderColor: colors.surface,
    borderRadius: 9999,
  },
  remainingBubble: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: 2,
    borderColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  remainingText: {
    color: colors.accent,
    fontWeight: '700',
  },
});
