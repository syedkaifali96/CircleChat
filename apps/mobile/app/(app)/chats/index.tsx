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
import { ApiError, createDirectConversation, listConversations, type ConversationListItem } from '../../../src/lib/api';
import { loadSessionToken } from '../../../src/auth/session';
import { colors } from '../../../src/design/tokens';

/**
 * Chats list (M5, design.md §8): every Circle and private conversation with
 * the last message preview and server-computed unread count. Private chats
 * start only with users who share an active Circle (server enforces D1);
 * the input here just asks for the username.
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
      // Server hides existence: unknown user, no shared Circle — same message.
      setStartError(
        err instanceof ApiError && err.code === 'VALIDATION_FAILED'
          ? 'Usernames are 3–20 letters, numbers or underscores.'
          : "Can't start this chat — you may not share a Circle with them yet.",
      );
    } finally {      setStarting(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Chats</Text>
        <Pressable style={styles.newChatButton} onPress={() => setNewChatOpen(true)} testID="new-chat-button">
          <Text style={styles.newChatText}>+ Private chat</Text>
        </Pressable>
      </View>

      {conversations === null && !loadError ? (
        <View style={styles.stateBox} testID="chats-loading">
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : null}

      {loadError ? (
        <View style={styles.stateBox} testID="chats-error">
          <Text style={styles.stateTitle}>Something went wrong.</Text>
          <Text style={styles.stateText}>Couldn't load your chats.</Text>
          <Pressable style={styles.retryButton} onPress={() => void load()} testID="chats-retry">
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : null}

      {conversations !== null && !loadError && conversations.length === 0 ? (
        <View style={styles.stateBox} testID="chats-empty">
          <Text style={styles.stateTitle}>No chats yet.</Text>
          <Text style={styles.stateText}>
            Open a Circle from Home, or start a private chat with someone in your Circle.
          </Text>
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.accent} />}
      >
        {conversations?.map((item) => (
          <Pressable
            key={item.id}
            style={({ pressed }) => [styles.chatRow, pressed && styles.buttonPressed]}
            onPress={() => router.push(`/(app)/chats/${item.id}`)}
            testID={`chat-row-${item.id}`}
          >
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{titleFor(item).charAt(0).toUpperCase()}</Text>
            </View>
            <View style={styles.chatInfo}>
              <View style={styles.topLine}>
                <Text style={styles.chatTitle} numberOfLines={1}>{titleFor(item)}</Text>
                {item.unreadCount > 0 ? (
                  <View style={styles.unreadBadge} testID={`unread-${item.id}`}>
                    <Text style={styles.unreadText}>{item.unreadCount}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.chatSubtitle} numberOfLines={1}>{subtitleFor(item)}</Text>
              <Text style={styles.chatPreview} numberOfLines={1} testID={`preview-${item.id}`}>
                {item.lastMessagePreview ?? 'No messages yet'}
              </Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>

      <Modal visible={newChatOpen} transparent animationType="fade" onRequestClose={() => setNewChatOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard} testID="new-chat-modal">
            <Text style={styles.modalTitle}>New private chat</Text>
            <Text style={styles.modalSubtitle}>Start a private chat with someone who shares a Circle with you.</Text>
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
            {startError ? <Text style={styles.error} testID="new-chat-error">{startError}</Text> : null}
            <Pressable
              style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]}
              onPress={() => void onStartChat()}
              disabled={starting}
              testID="new-chat-start"
            >
              {starting ? <ActivityIndicator color={colors.text} /> : <Text style={styles.primaryButtonText}>Start chat</Text>}
            </Pressable>
            <Pressable style={styles.textButton} onPress={() => setNewChatOpen(false)} testID="new-chat-cancel">
              <Text style={styles.textButtonText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingTop: 64 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24 },
  title: { color: colors.text, fontSize: 24, fontWeight: '700' },
  newChatButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  newChatText: { color: colors.text, fontSize: 13, fontWeight: '700' },
  listContent: { padding: 24, paddingTop: 16 },
  stateBox: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    marginHorizontal: 24,
    marginTop: 16,
    alignItems: 'center',
  },
  stateTitle: { color: colors.text, fontSize: 15, fontWeight: '700', textAlign: 'center' },
  stateText: { color: colors.textMuted, fontSize: 13, marginTop: 6, textAlign: 'center' },
  retryButton: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 24,
    marginTop: 14,
  },
  retryText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  chatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 10,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.text, fontSize: 18, fontWeight: '700' },
  chatInfo: { flex: 1, marginLeft: 12 },
  topLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chatTitle: { color: colors.text, fontSize: 15, fontWeight: '600', flexShrink: 1 },
  unreadBadge: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    minWidth: 20,
    paddingHorizontal: 6,
    paddingVertical: 1,
    alignItems: 'center',
  },
  unreadText: { color: colors.text, fontSize: 11, fontWeight: '700' },
  chatSubtitle: { color: colors.textMuted, fontSize: 11, marginTop: 1 },
  chatPreview: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(11,7,20,0.8)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 18,
    padding: 24,
    alignSelf: 'stretch',
  },
  modalTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  modalSubtitle: { color: colors.textMuted, fontSize: 13, marginTop: 6 },
  input: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 14,
  },
  error: { color: colors.error, fontSize: 13, marginTop: 10 },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 18,
  },
  primaryButtonText: { color: colors.text, fontSize: 14, fontWeight: '700' },
  textButton: { alignItems: 'center', marginTop: 12, padding: 6 },
  textButtonText: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  buttonPressed: { opacity: 0.85 },
});
