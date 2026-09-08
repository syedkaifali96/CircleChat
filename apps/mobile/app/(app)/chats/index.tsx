import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeInsets } from '../../../src/lib/safeInsets';
import { ApiError, createDirectConversation, listConversations, type ConversationListItem } from '../../../src/lib/api';
import { loadSessionToken } from '../../../src/auth/session';
import { colors, radii, shadows, spacing } from '../../../src/design/tokens';
import { Avatar } from '../../../src/components/Avatar';
import { Badge } from '../../../src/components/Badge';
import { BottomNav } from '../../../src/components/BottomNav';
import { Icon } from '../../../src/components/Icon';

/**
 * Chats list (M5, design.md §8): every Circle and private conversation with
 * the last message preview and server-computed unread count.
 */

function titleFor(item: ConversationListItem): string {
  return item.type === 'circle' ? item.circleName ?? 'Circle' : item.partnerDisplayName ?? 'Private chat';
}

function subtitleFor(item: ConversationListItem): string {
  if (item.type === 'circle') {
    return `Circle`;
  }
  return `@${item.partnerUsername}`;
}

export default function ChatsScreen() {
  const router = useRouter();
  const insets = useSafeInsets();
  const [conversations, setConversations] = useState<ConversationListItem[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const token = (await loadSessionToken()) ?? '';
      const { conversations: rows } = await listConversations(token);
      setConversations(rows);
    } catch {
      setLoadError(true);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const onStartChat = async () => {
    const trimmed = username.trim().replace(/^@/, '');
    if (trimmed.length === 0) {
      setStartError('Enter a username.');
      return;
    }
    setStartError(null);
    setStarting(true);
    try {
      const token = (await loadSessionToken()) ?? '';
      const { conversationId } = await createDirectConversation(token, trimmed);
      setNewChatOpen(false);
      setUsername('');
      router.push(`/(app)/chats/${conversationId}`);
    } catch (err) {
      setStartError(
        err instanceof ApiError && err.code === 'VALIDATION_FAILED'
          ? 'Usernames are 3–20 letters, numbers or underscores.'
          : "Can't start this chat — you may not share a Circle with them yet.",
      );
    } finally {
      setStarting(false);
    }
  };

  const topPadding = Math.max(insets.top, 24) + 16;

  return (
    <View style={styles.screenWrapper}>
      <View style={[styles.container, { paddingTop: topPadding }]}>
        {/* Header Bar */}
        <View style={styles.headerRow}>
          <View style={styles.titleGroup}>
            <Text style={styles.title}>Chats</Text>
            {conversations && conversations.length > 0 ? (
              <Badge label={conversations.length} size="sm" variant="default" />
            ) : null}
          </View>
          <Pressable
            style={({ pressed }) => [styles.newChatButton, pressed && styles.buttonPressed]}
            onPress={() => setNewChatOpen(true)}
            testID="new-chat-button"
          >
            <Icon name="plus" size={13} color={colors.text} />
            <Text style={styles.newChatText}>Private chat</Text>
          </Pressable>
        </View>

        {/* Loading State */}
        {conversations === null && !loadError ? (
          <View style={styles.stateBox} testID="chats-loading">
            <ActivityIndicator color={colors.accent} size="small" />
            <Text style={styles.stateText}>Loading conversations...</Text>
          </View>
        ) : null}

        {/* Error State */}
        {loadError ? (
          <View style={styles.stateBox} testID="chats-error">
            <View style={styles.errorBadge}>
              <Icon name="close" size={16} color={colors.error} />
            </View>
            <Text style={styles.stateTitle}>Something went wrong.</Text>
            <Text style={styles.stateText}>Couldn't load your chats.</Text>
            <Pressable
              style={({ pressed }) => [styles.retryButton, pressed && styles.buttonPressed]}
              onPress={() => void load()}
              testID="chats-retry"
            >
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        ) : null}

        {/* Empty State */}
        {conversations !== null && !loadError && conversations.length === 0 ? (
          <View style={styles.emptyBox} testID="chats-empty">
            <View style={styles.emptyIconBadge}>
              <Icon name="chat" size={26} color={colors.accent} />
            </View>
            <Text style={styles.stateTitle}>No chats yet.</Text>
            <Text style={styles.stateText}>
              Open a Circle from Home, or start a private chat with someone in your Circle.
            </Text>
          </View>
        ) : null}

        {/* Conversation List */}
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.accent} />
          }
        >
          {conversations?.map((item) => (
            <Pressable
              key={item.id}
              style={({ pressed }) => [styles.chatRow, pressed && styles.buttonPressed]}
              onPress={() => router.push(`/(app)/chats/${item.id}`)}
              testID={`chat-row-${item.id}`}
            >
              <Avatar name={titleFor(item)} size="md" />

              <View style={styles.chatInfo}>
                <View style={styles.topLine}>
                  <Text style={styles.chatTitle} numberOfLines={1}>
                    {titleFor(item)}
                  </Text>
                  {item.unreadCount > 0 ? (
                    <View style={styles.unreadBadge} testID={`unread-${item.id}`}>
                      <Text style={styles.unreadText}>{item.unreadCount}</Text>
                    </View>
                  ) : null}
                </View>

                <View style={styles.metaLine}>
                  <Text style={styles.chatSubtitle} numberOfLines={1}>
                    {subtitleFor(item)}
                  </Text>
                  <Text style={styles.dotSeparator}>·</Text>
                  <Text style={styles.chatPreview} numberOfLines={1} testID={`preview-${item.id}`}>
                    {item.lastMessagePreview ?? 'No messages yet'}
                  </Text>
                </View>
              </View>

              <Icon name="chevron-right" size={18} color={colors.textMuted} />
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* New Chat Modal */}
      <Modal visible={newChatOpen} transparent animationType="fade" onRequestClose={() => setNewChatOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard} testID="new-chat-modal">
            <View style={styles.modalHeader}>
              <View style={styles.modalIconBadge}>
                <Icon name="chat" size={18} color={colors.accent} />
              </View>
              <Text style={styles.modalTitle}>New private chat</Text>
            </View>
            <Text style={styles.modalSubtitle}>
              Start a private chat with someone who shares a Circle with you.
            </Text>

            <TextInput
              style={styles.input}
              value={username}
              onChangeText={setUsername}
              placeholder="username"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!starting}
              testID="new-chat-username"
            />
            {startError ? (
              <Text style={styles.error} testID="new-chat-error">
                {startError}
              </Text>
            ) : null}

            <Pressable
              style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]}
              onPress={() => void onStartChat()}
              disabled={starting}
              testID="new-chat-start"
            >
              {starting ? (
                <ActivityIndicator color={colors.text} size="small" />
              ) : (
                <Text style={styles.primaryButtonText}>Start chat</Text>
              )}
            </Pressable>

            <Pressable
              style={styles.textButton}
              onPress={() => setNewChatOpen(false)}
              testID="new-chat-cancel"
            >
              <Text style={styles.textButtonText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Bottom Nav */}
      <BottomNav activeTab="chats" />
    </View>
  );
}

const styles = StyleSheet.create({
  screenWrapper: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flex: 1,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  titleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  newChatButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primary,
    borderRadius: radii.full,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    ...shadows.glow,
  },
  newChatText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
  },
  chatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.md,
    ...shadows.subtle,
  },
  chatInfo: {
    flex: 1,
  },
  topLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  chatTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
  },
  metaLine: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 4,
  },
  chatSubtitle: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '600',
  },
  dotSeparator: {
    color: colors.textMuted,
    fontSize: 12,
  },
  chatPreview: {
    color: colors.textMuted,
    fontSize: 13,
    flex: 1,
  },
  unreadBadge: {
    backgroundColor: colors.primary,
    borderRadius: radii.full,
    paddingHorizontal: 8,
    paddingVertical: 2,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.glow,
  },
  unreadText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '700',
  },
  stateBox: {
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    alignItems: 'center',
    gap: spacing.xs,
  },
  emptyBox: {
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xxl,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    alignItems: 'center',
  },
  emptyIconBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(124, 58, 237, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(167, 139, 250, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  errorBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  stateTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  stateText: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: 4,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: spacing.md,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingVertical: 8,
    paddingHorizontal: spacing.lg,
  },
  retryText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radii.xxl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    gap: spacing.sm,
    ...shadows.card,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  modalIconBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(124, 58, 237, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(167, 139, 250, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  modalSubtitle: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.lg,
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 15,
    marginTop: spacing.xs,
  },
  error: {
    color: colors.error,
    fontSize: 12,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: radii.lg,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: spacing.xs,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    ...shadows.glow,
  },
  primaryButtonText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  textButton: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  textButtonText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  buttonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.985 }],
  },
});
