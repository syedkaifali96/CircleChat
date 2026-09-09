import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Audio } from 'expo-av';
import type { Message } from '../lib/api';
import { fetchMediaDownloadUrl } from '../lib/api';
import { colors } from '../design/tokens';

/**
 * Media content for chat bubbles (M7): images render inline, voice shows a
 * simple play/pause control with duration, video/other attachments render as
 * tappable chips. Download URLs are short-TTL and fetched per render cycle —
 * never stored. Pending/failed outgoing states surface upload progress and
 * retry without losing the local media.
 */

interface MediaContentProps {
  message: Message;
  /** Pending outgoing: local preview URI while the upload runs. */
  localUri?: string;
  uploadStage?: 'pending' | 'uploading' | 'failed';
  onRetry?: (message: Message) => void;
}

function formatDuration(ms: number | null): string {
  if (ms === null) {
    return '';
  }
  const totalSeconds = Math.round(ms / 1000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

function VoicePlayer({ mediaId }: { mediaId: string }) {
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    return () => {
      void sound?.unloadAsync();
    };
  }, [sound]);

  const onToggle = () => {
    void (async () => {
      try {
        if (sound && playing) {
          await sound.pauseAsync();
          setPlaying(false);
          return;
        }
        if (sound) {
          await sound.replayAsync();
          setPlaying(true);
          return;
        }
        const uri = await fetchMediaDownloadUrl(mediaId);
        const { sound: loaded } = await Audio.Sound.createAsync(
          { uri },
          { progressUpdateIntervalMillis: 250 },
          (status) => {
            if (!status.isLoaded && status.error) {
              setError(true);
            }
            if ('didJustFinish' in status && status.didJustFinish) {
              setPlaying(false);
            }
          },
        );
        setSound(loaded);
        await loaded.playAsync();
        setPlaying(true);
      } catch {
        setError(true);
      }
    })();
  };

  return (
    <Pressable style={styles.voiceRow} onPress={onToggle} testID={`voice-player-${mediaId}`}>
      <Text style={styles.voiceIcon}>{error ? '⚠' : playing ? '⏸' : '▶'}</Text>
      <View style={styles.waveform}>
        {[6, 10, 14, 10, 16, 12, 8, 12, 16, 10, 7, 11, 15, 9].map((h, i) => (
          <View key={i} style={[styles.waveBar, { height: h }]} />
        ))}
      </View>
    </Pressable>
  );
}

export function MediaContent({ message, localUri, uploadStage, onRetry }: MediaContentProps) {
  const [imageUri, setImageUri] = useState<string | null>(localUri ?? null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [fullRes, setFullRes] = useState(false);
  const externalUrl = message.media?.externalUrl ?? null;

  useEffect(() => {
    if (uploadStage) {
      return;
    }
    // M7.1 external GIFs render straight from the provider URL — no signed
    // download round-trip (the message itself is D1-gated).
    if (externalUrl) {
      setLoadFailed(false);
      setImageUri(externalUrl);
      return;
    }
    if (!message.mediaId) {
      return;
    }
    let cancelled = false;
    setLoadFailed(false);
    setImageUri(localUri ?? null);
    void (async () => {
      try {
        const uri = await fetchMediaDownloadUrl(
          message.mediaId!,
          // Bubbles default to the thumbnail; tap-to-expand loads full-res.
          message.media?.hasThumbnail && !fullRes ? { variant: 'thumb' } : {},
        );
        if (!cancelled) {
          setImageUri(uri);
        }
      } catch {
        if (!cancelled) {
          setLoadFailed(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [message.mediaId, externalUrl, message.media?.hasThumbnail, fullRes, uploadStage, localUri]);

  if (uploadStage === 'failed') {
    return (
      <Pressable style={styles.failedBox} onPress={() => onRetry?.(message)} testID={`media-retry-${message.id}`}>
        <Text style={styles.failedText}>Upload failed — tap to retry</Text>
      </Pressable>
    );
  }

  if (uploadStage === 'pending' || uploadStage === 'uploading') {
    return (
      <View style={styles.pendingBox} testID={`media-pending-${message.id}`}>
        <ActivityIndicator color={colors.text} size="small" />
        <Text style={styles.pendingText}>
          {uploadStage === 'pending' ? 'Preparing…' : 'Uploading…'}
        </Text>
      </View>
    );
  }

  if ((!message.mediaId && !externalUrl) || loadFailed) {
    return <Text style={styles.mediaError}>{loadFailed ? 'Media unavailable' : 'Media'}</Text>;
  }

  if ((message.type === 'image' || message.type === 'gif') && imageUri) {
    const width = message.media?.width ?? null;
    const tappable = (message.media?.hasThumbnail ?? false) || (message.media?.externalUrl ?? false);
    return (
      <Pressable
        onPress={() => (message.media?.hasThumbnail ? setFullRes((v) => !v) : undefined)}
        disabled={!tappable}
        testID={`media-image-tap-${message.id}`}
      >
        <Image
          source={{ uri: imageUri }}
          style={width !== null && width < 120 ? styles.imageSmall : styles.image}
          resizeMode="cover"
          testID={`media-image-${message.id}`}
        />
      </Pressable>
    );
  }

  if (message.type === 'voice' && message.mediaId) {
    return (
      <View style={styles.voiceWrap}>
        <VoicePlayer mediaId={message.mediaId} />
        {message.media?.durationMs ? <Text style={styles.duration}>{formatDuration(message.media.durationMs)}</Text> : null}
      </View>
    );
  }

  // Video/file attachments render as tappable chips (opens the signed URL).
  return (
    <Pressable
      style={styles.attachment}
      onPress={() => void (async () => {
        try {
          const uri = await fetchMediaDownloadUrl(message.mediaId!);
          await Linking.openURL(uri);
        } catch {
          setLoadFailed(true);
        }
      })()}
      testID={`media-attachment-${message.id}`}
    >
      <Text style={styles.attachmentIcon}>{message.type === 'video' ? '🎬' : '📎'}</Text>
      <Text style={styles.attachmentText} numberOfLines={1}>
        {message.body || (message.type === 'video' ? 'Video' : 'Attachment')}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  image: { width: 220, height: 160, borderRadius: 12 },
  imageSmall: { width: 120, height: 120 },
  pendingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.background,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    opacity: 0.8,
  },
  pendingText: { color: colors.textSecondary, fontSize: 12 },
  failedBox: {
    backgroundColor: colors.background,
    borderColor: colors.error,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  failedText: { color: colors.error, fontSize: 12, fontWeight: '600' },
  mediaError: { color: colors.textMuted, fontSize: 12, fontStyle: 'italic' },
  voiceWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  voiceRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  voiceIcon: { color: colors.text, fontSize: 16 },
  waveform: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 18 },
  waveBar: { width: 2, backgroundColor: colors.accent, borderRadius: 1 },
  duration: { color: colors.textMuted, fontSize: 10 },
  attachment: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.background,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  attachmentIcon: { fontSize: 16 },
  attachmentText: { color: colors.text, fontSize: 13, maxWidth: 160 },
});
