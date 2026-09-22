import { Pressable, Text, View, StyleSheet } from 'react-native';
import type { Message } from '../lib/api';
import { colors, typography } from '../design/tokens';

/**
 * Video thumbnail seam (M14.3, docs/ARCHITECTURE.md §9).
 *
 * Chat images get a server-generated 400px JPEG (sharp, best-effort). Videos
 * do not — frame extraction needs ffmpeg-scale native tooling that is not
 * part of the MVP toolchain, so a video bubble never has a thumbnail URI to
 * fetch. This module is the single seam for that: today it always reports
 * "no thumbnail" and the caller renders a generic video placeholder; if a
 * future milestone adds frame extraction (server-side ffmpeg → a
 * `<storageKey>-frame.jpg` derivative, or a client-side extractor), the only
 * change needed is to make `getVideoThumbnail` resolve a real URI instead of
 * returning null. Nothing else in the chat renders video.
 *
 * The placeholder is crash-safe: it never waits on a network round-trip and
 * never throws, so a missing thumbnail can never break message rendering.
 */

/** Returns a thumbnail URI when one is available, otherwise null. */
export function getVideoThumbnail(_message: Message): string | null {
  // Future seam (post-MVP, requires ffmpeg): resolve a frame-extraction
  // derivative here, e.g. fetchMediaDownloadUrl(message.mediaId!, { variant: 'frame' }).
  // Until then, video bubbles always fall back to the placeholder below.
  return null;
}

export interface VideoPlaceholderProps {
  message: Message;
  onPress?: (message: Message) => void;
}

/** Generic video placeholder — a play icon over a themed surface. */
export function VideoPlaceholder({ message, onPress }: VideoPlaceholderProps) {
  return (
    <Pressable
      style={styles.box}
      onPress={onPress ? () => onPress(message) : undefined}
      testID={`video-placeholder-${message.id}`}
    >
      <View style={styles.playCircle}>
        <Text style={styles.playIcon}>▶</Text>
      </View>
      <Text style={styles.videoLabel} numberOfLines={1}>
        {message.body || 'Video'}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    maxWidth: 220,
  },
  playCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playIcon: { ...typography.button, color: colors.primaryContent, fontSize: 14, marginLeft: 2 },
  videoLabel: { ...typography.body, color: colors.text, fontSize: 13, flex: 1 },
});