import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import {
  ApiError,
  fetchCircleHome,
  fetchCirclePins,
  removePin,
  type CircleHome,
  type PinItem,
} from '../../../../src/lib/api';
import { useAuth } from '../../../../src/auth/AuthContext';
import { loadSessionToken } from '../../../../src/auth/session';
import { CircleThemeGate } from '../../../../src/design/useCircleSettings';
import { useCircleTheme } from '../../../../src/design/CircleTheme';
import { colors } from '../../../../src/design/tokens';

/**
 * Pinboard (M10): the Circle's full pinned list. Items reference existing
 * Circle messages — tapping one opens the Circle chat (the authorized media
 * pipeline renders the content there). Unpinning follows the server policy:
 * anyone may remove their own pin, an owner/admin any pin; the UI only
 * mirrors what the API already enforces.
 */

function pinPreviewLabel(message: PinItem['message']): string {
  if (message.deleted) {
    return 'Deleted message';
  }
  switch (message.type) {
    case 'image':
      return '📷 Photo';
    case 'video':
      return '🎥 Video';
    case 'voice':
      return '🎤 Voice message';
    case 'gif':
      return 'GIF';
    case 'file':
      return '📎 Attachment';
    default:
      return message.body ?? 'Message';
  }
}

function pinnedDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function friendlyError(code: string): string {
  if (code === 'FORBIDDEN') {
    return 'You can only remove your own pins.';
  }
  if (code === 'NOT_FOUND') {
    return 'This Circle is no longer available.';
  }
  return 'Something went wrong. Try again.';
}

export default function PinboardScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // M12: the gate sits ABOVE the themed body so hooks resolve the live
  // Circle theme (preset + accent), not the provider default.
  return (
    <CircleThemeGate circleId={id}>
      <PinboardScreenThemed circleId={id} />
    </CircleThemeGate>
  );
}

function PinboardScreenThemed({ circleId: id }: { circleId: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const themed = useCircleTheme().colors;
  const [pins, setPins] = useState<PinItem[] | null>(null);
  const [home, setHome] = useState<CircleHome | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const token = (await loadSessionToken()) ?? '';
      // Home supplies the conversation + caller role; pins the full list.
      const [{ home: foundHome }, { items }] = await Promise.all([
        fetchCircleHome(token, id),
        fetchCirclePins(token, id),
      ]);
      setHome(foundHome);
      setPins(items);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const onUnpin = (pin: PinItem) => {
    setActionError(null);
    void (async () => {
      try {
        const token = (await loadSessionToken()) ?? '';
        await removePin(token, id, pin.id);
        await load();
      } catch (err) {
        setActionError(friendlyError(err instanceof ApiError ? err.code : 'UNKNOWN'));
      }
    })();
  };

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: themed.background }]} testID="pinboard-loading">
        <ActivityIndicator color={themed.accent} />
      </View>
    );
  }

  if (loadError || !pins || !home) {
    return (
      <View style={[styles.centered, { backgroundColor: themed.background }]} testID="pinboard-error">
        <Text style={styles.stateTitle}>Something went wrong.</Text>
        <Text style={styles.stateText}>Couldn't load the Pinboard.</Text>
        <Pressable style={styles.secondaryButton} onPress={() => void load()} testID="pinboard-retry">
          <Text style={styles.secondaryButtonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  const isAdmin = home.callerRole === 'owner' || home.callerRole === 'admin';

  return (
    <View style={{ flex: 1, backgroundColor: themed.background }}>
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      testID="pinboard-screen"
      refreshControl={<RefreshControl refreshing={false} onRefresh={() => void load()} tintColor={themed.accent} />}
    >
      <Text style={styles.title}>Pinboard</Text>
      <Text style={styles.subtitle} testID="pinboard-count">
        {pins.length === 1 ? '1 pinned message' : `${pins.length} pinned messages`}
      </Text>

      {actionError ? <Text style={styles.error} testID="pinboard-action-error">{actionError}</Text> : null}

      {pins.length === 0 ? (
        <View style={styles.emptyCard} testID="pinboard-empty">
          <Text style={styles.emptyTitle}>Nothing pinned yet</Text>
          <Text style={styles.emptyText}>
            Long-press a message in the chat and choose Pin to keep it here for the whole Circle.
          </Text>
        </View>
      ) : (
        pins.map((pin) => {
          const canUnpin = isAdmin || pin.pinnedBy.userId === user?.id;
          return (
            <View key={pin.id} style={styles.pinCard}>
              <Pressable
                style={({ pressed }) => [styles.pinMain, pressed && styles.buttonPressed]}
                testID={`pinboard-item-${pin.messageId}`}
                onPress={() => router.push(`/(app)/chats/${pin.message.conversationId}`)}
                disabled={!pin.message.conversationId}
              >
                <Text style={styles.pinIcon}>📌</Text>
                <View style={styles.pinInfo}>
                  <Text style={styles.pinBody} numberOfLines={3}>{pinPreviewLabel(pin.message)}</Text>
                  <Text style={styles.pinMeta}>
                    {pin.message.senderDisplayName} · pinned by {pin.pinnedBy.displayName} · {pinnedDate(pin.pinnedAt)}
                  </Text>
                </View>
                {canUnpin ? (
                  <Pressable onPress={() => onUnpin(pin)} hitSlop={8} testID={`pin-unpin-${pin.id}`}>
                    <Text style={styles.unpinText}>Unpin</Text>
                  </Pressable>
                ) : null}
              </Pressable>
            </View>
          );
        })
      )}
    </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, paddingTop: 64 },
  centered: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { color: colors.text, fontSize: 26, fontWeight: '700' },
  subtitle: { color: colors.textMuted, fontSize: 13, marginTop: 4 },
  error: { color: colors.error, fontSize: 13, marginTop: 12 },
  emptyCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 20,
    marginTop: 16,
  },
  emptyTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  emptyText: { color: colors.textMuted, fontSize: 13, marginTop: 6 },
  pinCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginTop: 12,
  },
  pinMain: { flexDirection: 'row', alignItems: 'center' },
  pinIcon: { fontSize: 16 },
  pinInfo: { flex: 1, marginLeft: 10 },
  pinBody: { color: colors.text, fontSize: 14 },
  pinMeta: { color: colors.textMuted, fontSize: 11, marginTop: 3 },
  unpinText: { color: colors.error, fontSize: 13, fontWeight: '600', paddingHorizontal: 6 },
  secondaryButton: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 32,
    marginTop: 16,
  },
  secondaryButtonText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  stateTitle: { color: colors.text, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  stateText: { color: colors.textMuted, fontSize: 13, marginTop: 6, textAlign: 'center' },
  buttonPressed: { opacity: 0.85 },
});
