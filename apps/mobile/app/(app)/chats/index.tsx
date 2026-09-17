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
import { colors, radii, shadows, spacing, typography } from '../../../src/design/tokens';
import { Avatar } from '../../../src/components/Avatar';
import { BottomNav } from '../../../src/components/BottomNav';
import { Icon } from '../../../src/components/Icon';

function titleFor(item: ConversationListItem): string {
  return item.type === 'circle' ? item.circleName ?? 'Circle' : item.partnerDisplayName ?? 'Private chat';
}

function subtitleFor(item: ConversationListItem): string {
  return item.type === 'circle' ? 'Circle' : `@${item.partnerUsername}`;
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

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const onStartChat = async () => {
    const trimmed = username.trim().replace(/^@/, '');
    if (!trimmed) {
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

  const closeModal = () => {
    if (starting) return;
    setNewChatOpen(false);
    setStartError(null);
  };

  return (
    <View style={styles.screen}>
      <View style={[styles.container, { paddingTop: Math.max(insets.top, spacing.xl) + spacing.md }]}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>PRIVATE CONVERSATIONS</Text>
            <Text style={styles.title}>Chats</Text>
          </View>
          <Pressable
            onPress={() => setNewChatOpen(true)}
            style={({ pressed }) => [styles.newChatButton, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Start private chat"
            testID="new-chat-button"
          >
            <Icon name="plus" size={18} color={colors.primaryContent} />
          </Pressable>
        </View>

        {conversations === null && !loadError ? (
          <View style={styles.state} testID="chats-loading">
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.stateText}>Loading conversations…</Text>
          </View>
        ) : null}

        {loadError ? (
          <View style={styles.state} testID="chats-error">
            <View style={styles.errorIcon}><Icon name="close" size={18} color={colors.error} /></View>
            <Text style={styles.stateTitle}>Couldn’t load your chats</Text>
            <Text style={styles.stateText}>Check your connection and try again.</Text>
            <Pressable onPress={() => void load()} style={styles.retry} testID="chats-retry">
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        ) : null}

        {conversations !== null && !loadError && conversations.length === 0 ? (
          <View style={styles.state} testID="chats-empty">
            <View style={styles.emptyIcon}><Icon name="chat" size={25} color={colors.primary} /></View>
            <Text style={styles.stateTitle}>No conversations yet</Text>
            <Text style={styles.stateText}>Start a private chat with someone who shares a Circle with you.</Text>
          </View>
        ) : null}

        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.primary} />}
        >
          {conversations?.map((item) => (
            <Pressable
              key={item.id}
              onPress={() => router.push(`/(app)/chats/${item.id}`)}
              style={({ pressed }) => [styles.chatRow, pressed && styles.pressed]}
              testID={`chat-row-${item.id}`}
            >
              <Avatar name={titleFor(item)} size="lg" />
              <View style={styles.chatCopy}>
                <View style={styles.chatTopLine}>
                  <Text style={styles.chatTitle} numberOfLines={1}>{titleFor(item)}</Text>
                  {item.unreadCount > 0 ? (
                    <View style={styles.unread} testID={`unread-${item.id}`}>
                      <Text style={styles.unreadText}>{item.unreadCount}</Text>
                    </View>
                  ) : null}
                </View>
                <View style={styles.previewLine}>
                  <Text style={styles.chatKind}>{subtitleFor(item)}</Text>
                  <Text style={styles.separator}>·</Text>
                  <Text style={styles.preview} numberOfLines={1} testID={`preview-${item.id}`}>
                    {item.lastMessagePreview ?? 'No messages yet'}
                  </Text>
                </View>
              </View>
              <Icon name="chevron-right" size={20} color={colors.textMuted} />
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <Modal visible={newChatOpen} transparent animationType="fade" onRequestClose={closeModal}>
        <View style={styles.backdrop}>
          <View style={styles.sheet} testID="new-chat-modal">
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <View>
                <Text style={styles.sheetEyebrow}>ONE-TO-ONE</Text>
                <Text style={styles.sheetTitle}>New private chat</Text>
              </View>
              <Pressable onPress={closeModal} style={styles.closeButton} accessibilityLabel="Close">
                <Icon name="close" size={18} color={colors.textSecondary} />
              </Pressable>
            </View>
            <Text style={styles.sheetDescription}>Enter the username of someone who shares a Circle with you.</Text>
            <Text style={styles.inputLabel}>Username</Text>
            <TextInput
              style={styles.input}
              value={username}
              onChangeText={setUsername}
              placeholder="@username"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!starting}
              testID="new-chat-username"
            />
            {startError ? <Text style={styles.error} testID="new-chat-error">{startError}</Text> : null}
            <Pressable
              onPress={() => void onStartChat()}
              disabled={starting}
              style={({ pressed }) => [styles.startButton, pressed && styles.pressed, starting && styles.disabled]}
              testID="new-chat-start"
            >
              {starting ? <ActivityIndicator color={colors.primaryContent} /> : <Text style={styles.startButtonText}>Start chat</Text>}
            </Pressable>
            <Pressable onPress={closeModal} style={styles.cancelButton} testID="new-chat-cancel">
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <BottomNav activeTab="chats" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, marginBottom: spacing.xl },
  eyebrow: { ...typography.captionStrong, color: colors.textMuted, letterSpacing: 1.2 },
  title: { ...typography.h1, color: colors.text, marginTop: spacing.xs },
  newChatButton: { width: 46, height: 46, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', ...shadows.subtle },
  list: { flex: 1 },
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  chatRow: { minHeight: 80, flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  chatCopy: { flex: 1 },
  chatTopLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  chatTitle: { ...typography.bodyStrong, color: colors.text, flex: 1 },
  previewLine: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.xs, gap: spacing.xs },
  chatKind: { ...typography.captionStrong, color: colors.accent },
  separator: { ...typography.caption, color: colors.textMuted },
  preview: { ...typography.caption, color: colors.textMuted, flex: 1 },
  unread: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  unreadText: { ...typography.captionStrong, color: colors.primaryContent },
  state: { marginHorizontal: spacing.lg, padding: spacing.xxl, borderRadius: radii.xxl, backgroundColor: colors.surface, alignItems: 'center', gap: spacing.sm },
  stateTitle: { ...typography.bodyStrong, color: colors.text, textAlign: 'center' },
  stateText: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
  emptyIcon: { width: 56, height: 56, borderRadius: radii.xxl, backgroundColor: colors.primaryGlow, alignItems: 'center', justifyContent: 'center' },
  errorIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.errorMuted, alignItems: 'center', justifyContent: 'center' },
  retry: { minHeight: 44, paddingHorizontal: spacing.xl, borderRadius: radii.lg, backgroundColor: colors.surfaceElevated, justifyContent: 'center' },
  retryText: { ...typography.button, color: colors.text },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlay },
  sheet: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.xxxl, borderTopLeftRadius: radii.sheet, borderTopRightRadius: radii.sheet, backgroundColor: colors.surfaceElevated, ...shadows.card },
  sheetHandle: { width: 42, height: 4, borderRadius: 2, alignSelf: 'center', backgroundColor: colors.borderActive, marginBottom: spacing.xl },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetEyebrow: { ...typography.captionStrong, color: colors.primary, letterSpacing: 1 },
  sheetTitle: { ...typography.h2, color: colors.text, marginTop: spacing.xs },
  closeButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  sheetDescription: { ...typography.body, color: colors.textSecondary, marginTop: spacing.md },
  inputLabel: { ...typography.captionStrong, color: colors.textSecondary, marginTop: spacing.xl, marginBottom: spacing.sm },
  input: { minHeight: 52, borderRadius: radii.lg, paddingHorizontal: spacing.md, backgroundColor: colors.backgroundElevated, color: colors.text, ...typography.body },
  error: { ...typography.caption, color: colors.error, marginTop: spacing.sm },
  startButton: { minHeight: 52, marginTop: spacing.xl, borderRadius: radii.lg, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  startButtonText: { ...typography.button, color: colors.primaryContent },
  cancelButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  cancelText: { ...typography.button, color: colors.textMuted },
  disabled: { opacity: 0.55 },
  pressed: { opacity: 0.78, transform: [{ scale: 0.985 }] },
});
