import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors } from '../design/tokens';

export type IconName =
  | 'circle'
  | 'circles'
  | 'chat'
  | 'message'
  | 'settings'
  | 'profile'
  | 'user'
  | 'plus'
  | 'lock'
  | 'pin'
  | 'poll'
  | 'chevron-right'
  | 'check'
  | 'close'
  | 'bell'
  | 'crown'
  | 'shield'
  | 'sparkle'
  | 'search'
  | 'logout';

interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
}

export function Icon({
  name,
  size = 20,
  color = colors.text,
  style,
}: IconProps): React.JSX.Element {
  switch (name) {
    case 'circles':
    case 'circle': {
      const ringSize = size * 0.65;
      const stroke = 2;
      return (
        <View style={[styles.center, { width: size, height: size }, style]}>
          <View
            style={{
              position: 'absolute',
              left: 0,
              width: ringSize,
              height: ringSize,
              borderRadius: ringSize / 2,
              borderWidth: stroke,
              borderColor: color,
            }}
          />
          <View
            style={{
              position: 'absolute',
              right: 0,
              width: ringSize,
              height: ringSize,
              borderRadius: ringSize / 2,
              borderWidth: stroke,
              borderColor: color,
            }}
          />
        </View>
      );
    }

    case 'chat':
    case 'message': {
      const width = size * 0.95;
      const height = size * 0.8;
      return (
        <View style={[styles.center, { width: size, height: size }, style]}>
          <View
            style={{
              width,
              height,
              borderRadius: height * 0.38,
              borderWidth: 2,
              borderColor: color,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <View style={{ width: width * 0.45, height: 2, backgroundColor: color, borderRadius: 1 }} />
          </View>
          <View
            style={{
              position: 'absolute',
              bottom: 1,
              left: 3,
              width: 0,
              height: 0,
              borderLeftWidth: 3,
              borderRightWidth: 3,
              borderTopWidth: 4,
              borderLeftColor: 'transparent',
              borderRightColor: 'transparent',
              borderTopColor: color,
            }}
          />
        </View>
      );
    }

    case 'profile':
    case 'user': {
      const headSize = size * 0.42;
      const bodyWidth = size * 0.78;
      const bodyHeight = size * 0.38;
      return (
        <View style={[styles.center, { width: size, height: size }, style]}>
          <View
            style={{
              width: headSize,
              height: headSize,
              borderRadius: headSize / 2,
              borderWidth: 2,
              borderColor: color,
            }}
          />
          <View
            style={{
              width: bodyWidth,
              height: bodyHeight,
              borderTopLeftRadius: bodyWidth * 0.45,
              borderTopRightRadius: bodyWidth * 0.45,
              borderWidth: 2,
              borderBottomWidth: 0,
              borderColor: color,
              marginTop: 1.5,
            }}
          />
        </View>
      );
    }

    case 'plus': {
      const stroke = 2.2;
      const barLen = size * 0.75;
      return (
        <View style={[styles.center, { width: size, height: size }, style]}>
          <View
            style={{
              position: 'absolute',
              width: barLen,
              height: stroke,
              backgroundColor: color,
              borderRadius: 1,
            }}
          />
          <View
            style={{
              position: 'absolute',
              width: stroke,
              height: barLen,
              backgroundColor: color,
              borderRadius: 1,
            }}
          />
        </View>
      );
    }

    case 'logout': {
      const boxWidth = size * 0.55;
      const boxHeight = size * 0.82;
      return (
        <View style={[styles.center, { width: size, height: size, flexDirection: 'row' }, style]}>
          <View
            style={{
              width: boxWidth,
              height: boxHeight,
              borderWidth: 2,
              borderRightWidth: 0,
              borderColor: color,
              borderTopLeftRadius: 4,
              borderBottomLeftRadius: 4,
            }}
          />
          <View style={{ width: size * 0.4, height: 2, backgroundColor: color, marginLeft: -4 }} />
          <Text
            style={{
              color,
              fontSize: size * 0.65,
              fontWeight: '700',
              marginLeft: -3,
              marginTop: -1,
              includeFontPadding: false,
            }}
          >
            ›
          </Text>
        </View>
      );
    }

    case 'sparkle': {
      return (
        <Text
          style={[
            styles.symbol,
            {
              fontSize: size * 0.9,
              color,
              lineHeight: size,
            },
          ]}
        >
          ✦
        </Text>
      );
    }

    case 'chevron-right': {
      return (
        <Text
          style={[
            styles.symbol,
            {
              fontSize: size * 1.1,
              fontWeight: '700',
              color,
              lineHeight: size,
            },
          ]}
        >
          ›
        </Text>
      );
    }

    case 'close': {
      const stroke = 2;
      const barLen = size * 0.7;
      return (
        <View style={[styles.center, { width: size, height: size }, style]}>
          <View
            style={{
              position: 'absolute',
              width: barLen,
              height: stroke,
              backgroundColor: color,
              borderRadius: 1,
              transform: [{ rotate: '45deg' }],
            }}
          />
          <View
            style={{
              position: 'absolute',
              width: barLen,
              height: stroke,
              backgroundColor: color,
              borderRadius: 1,
              transform: [{ rotate: '-45deg' }],
            }}
          />
        </View>
      );
    }

    case 'search': {
      const radius = size * 0.55;
      return (
        <View style={[styles.center, { width: size, height: size }, style]}>
          <View
            style={{
              width: radius,
              height: radius,
              borderRadius: radius / 2,
              borderWidth: 2,
              borderColor: color,
              marginTop: -3,
              marginLeft: -3,
            }}
          />
          <View
            style={{
              position: 'absolute',
              width: 2,
              height: size * 0.35,
              backgroundColor: color,
              borderRadius: 1,
              bottom: 2,
              right: 4,
              transform: [{ rotate: '-45deg' }],
            }}
          />
        </View>
      );
    }

    case 'pin': {
      return (
        <View style={[styles.center, { width: size, height: size }, style]}>
          <View style={{ width: size * 0.5, height: size * 0.25, backgroundColor: color, borderRadius: 2 }} />
          <View style={{ width: size * 0.25, height: size * 0.35, backgroundColor: color }} />
          <View style={{ width: 2, height: size * 0.3, backgroundColor: color }} />
        </View>
      );
    }

    case 'poll': {
      return (
        <View style={[styles.center, { width: size, height: size, flexDirection: 'row', gap: 3, alignItems: 'flex-end', paddingBottom: 2 }, style]}>
          <View style={{ width: 3, height: size * 0.45, backgroundColor: color, borderRadius: 1.5 }} />
          <View style={{ width: 3, height: size * 0.8, backgroundColor: color, borderRadius: 1.5 }} />
          <View style={{ width: 3, height: size * 0.6, backgroundColor: color, borderRadius: 1.5 }} />
        </View>
      );
    }

    default: {
      return (
        <View
          style={[
            styles.center,
            {
              width: size * 0.5,
              height: size * 0.5,
              borderRadius: (size * 0.5) / 2,
              backgroundColor: color,
            },
            style,
          ]}
        />
      );
    }
  }
}

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  symbol: {
    textAlign: 'center',
    includeFontPadding: false,
  },
});
