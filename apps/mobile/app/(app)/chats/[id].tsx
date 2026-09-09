import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ApiError,
  addReaction,
  deleteMessage,
  editMessage,
  fetchChatHeader,
  fetchMessages,
  markConversationRead,
  removeReaction,
  sendMessage,
  type ChatHeader,
  type Message,
  fetchNotificationPref,
  updateNotificationPref,
  addPin,
} from '../../../src/lib/api';
import { loadSessionToken } from '../../../src/auth/session';
import { useCircleTheme, themedBackdrop } from '../../../src/design/CircleTheme';
import { CircleThemeGate } from '../../../src/design/useCircleSettings';
import { useAuth } from '../../../src/auth/AuthContext';
import { Audio } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import { uploadAndSendMedia } from '../../../src/lib/mediaSend';
import { searchGiphy } from '../../../src/lib/giphy';
import {
  sendTypingStart,
  sendTypingStop,
  subscribeToConversation,
  trackJoinedRoom,
} from '../../../src/lib/socket';
import { MessageBubble } from '../../../src/chat/MessageBubble';
import { useSafeInsets } from '../../../src/lib/safeInsets';
import { colors } from '../../../src/design/tokens';

/**
 * Conversation screen (M5): Circle or private chat — newest messages at the
 * bottom, keyset pagination upward, long-press actions, and the text composer
 * (media/voice controls are intentionally deferred to M7/M6). REST is the
 * source of truth; the view reloads after every mutation.
 */

const QUICK_REACTIONS = ['❤️', '😂', '👍', '😮', '😢', '🔥'];

function makeClientMessageId(): string {
  return `m5_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/** M12: full-screen Circle backdrop — the preset-tinted base plus the
 * bundled chat background (dimmed + scrimmed, design.md §24 readability
 * rule) when one is set. Sits inside the CircleThemeGate so it consumes the
 * live theme context. */
function ThemedSurface() {
  const { colors: themed, backgroundKey } = useCircleTheme();
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: themed.background }]} pointerEvents="none">
      {themedBackdrop(backgroundKey)}
    </View>
  );
}

/** Header chrome (hairline) recolored by the Circle theme — a wrapper so the
 * existing header JSX keeps its structure. */
function ThemedHeaderBar({ children }: { children: React.ReactNode }) {
  const themed = useCircleTheme().colors;
  return (
    <View style={[styles.headerBar, { borderBottomColor: themed.border }]} testID="conversation-header">
      {children}
    </View>
  );
}

/** Message-action / attachment / GIF / edit sheets recolored by the theme. */
function ThemedModalCard({ testID, children }: { testID: string; children: React.ReactNode }) {
  const themed = useCircleTheme().colors;
  return (
    <View style={[styles.modalCard, { backgroundColor: themed.surface, borderColor: themed.border }]} testID={testID}>
      {children}
    </View>
  );
}

/** The composer (input + send) recolored by the Circle theme. */
function ThemedComposer({
  draft,
  onDraftChange,
  onSend,
  sending,
  onAttachments,
}: {
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  sending: boolean;
  onAttachments: () => void;
}) {
  const themed = useCircleTheme().colors;
  // Bottom safe-area inset keeps the composer above the system navigation
  // bar (gesture and 3-button devices report different heights — always the
  // live inset, never a fixed pixel value).
  const insets = useSafeInsets();
  return (
    <View
      style={[styles.composer, { borderTopColor: themed.border, paddingBottom: 12 + Math.max(insets.bottom, 0) }]}
      testID="composer"
    >
      <Pressable style={[styles.composerPlus, { backgroundColor: themed.surface, borderColor: themed.border }]} onPress={onAttachments} testID="composer-attachments">
        <Text style={styles.composerPlusText}>+</Text>
      </Pressable>
      <TextInput
        style={[styles.composerInput, { backgroundColor: themed.surface, borderColor: themed.border }]}
        value={draft}
        onChangeText={onDraftChange}
        placeholder="Write a message..."
        placeholderTextColor={themed.textMuted}
        multiline
        editable={!sending}
        testID="composer-input"
      />
      <Pressable style={[styles.composerSend, { backgroundColor: themed.primary }]} onPress={onSend} disabled={sending || draft.trim().length === 0} testID="composer-send">
        {sending ? (
          <ActivityIndicator color={colors.text} size="small" />
        ) : (
          <Text style={styles.composerSendText}>Send</Text>
        )}
      </Pressable>
    </View>
  );
}

export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [header, setHeader] = useState<ChatHeader | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<Message | null>(null);
  const [reacting, setReacting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState('');
  const [actionEditTarget, setActionEditTarget] = useState<Message | null>(null);
  const myUserId = user?.id ?? null;
  const listRef = useRef<FlatList<Message>>(null);
  // M6 realtime: typing partner + peer presence for the header.
  const [typingUsernames, setTypingUsernames] = useState<string[]>([]);
  const [partnerPresence, setPartnerPresence] = useState<{ online: boolean; lastSeenAt: string | null } | null>(null);
  const typingStopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [typingNow, setTypingNow] = useState(false);
  // M8: per-conversation mute for this chat (server-persisted via prefs API).
  const [muted, setMuted] = useState(false);
  // Ref keeps the socket handlers current without re-subscribing on every
  // header change — the subscription lifecycle is tied to the conversation id.
  const headerRef = useRef<ChatHeader | null>(null);
  headerRef.current = header;
  // M7: attachment menu + pending outgoing media (optimistic bubbles).
  const [attachmentMenuVisible, setAttachmentMenuVisible] = useState(false);
  const [uploadingMedia, setUploadingMedia] = useState<
    Array<{ localId: string; localUri: string; kind: 'image' | 'video' | 'voice'; stage: 'pending' | 'uploading' | 'failed'; mimeType: string; durationMs?: number }>
  >([]);
  const voiceRecordingRef = useRef<Audio.Recording | null>(null);
  const [voiceRecording, setVoiceRecording] = useState(false);
  // M7.1: GIF picker — debounced search-as-you-type against the server proxy.
  const [gifPickerVisible, setGifPickerVisible] = useState(false);
  const [gifQuery, setGifQuery] = useState('');
  const [gifResults, setGifResults] = useState<Array<{ id: string; url: string; previewUrl: string; width: number; height: number }>>([]);
  const [gifSearching, setGifSearching] = useState(false);
  const [gifError, setGifError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const token = (await loadSessionToken()) ?? '';
      const [headerRes, history] = await Promise.all([
        fetchChatHeader(token, id),
        fetchMessages(token, id, { limit: 30 }),
      ]);
      setHeader(headerRes.header);
      setMessages(history.messages.reverse()); // oldest first for the FlatList
      setOlderCursor(history.nextBeforeCursor);
      // Mark the newest message read; failures are non-fatal.
      const newest = history.messages[0];
      if (newest) {
        try {
          await markConversationRead(token, id, newest.id);
        } catch {
          // Read-state sync is best-effort; REST history stays authoritative.
        }
      }
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // M6 realtime subscription: typing + presence + message change events.
  // Listeners detach on unmount; the shared socket stays for other screens.
  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    void (async () => {
      const usernameById = new Map<string, string>();
      try {
        const token = (await loadSessionToken()) ?? '';
        const { messages: known } = await fetchMessages(token, id, { limit: 30 });
        for (const m of known) {
          usernameById.set(m.senderId, m.senderDisplayName);
        }
      } catch {
        // Names fall back to userId when history is unavailable.
      }
      if (cancelled) {
        return;
      }
      trackJoinedRoom(id);
      unsubscribe = await subscribeToConversation({
        conversationId: id,
        onTyping: (payload) => {
          if (payload.userId === myUserId || payload.conversationId !== id) {
            return;
          }
          setTypingUsernames((current) => {
            // The list stores display names (fallback: userId), so removal
            // must compare against the resolved name, not the raw id.
            const name = usernameById.get(payload.userId) ?? payload.userId;
            const others = current.filter((u) => u !== name);
            if (payload.isTyping) {
              return [...others, name];
            }
            return others;
          });
        },
        onPresence: (payload) => {
          if (payload.userId === myUserId) {
            return;
          }
          if (headerRef.current?.type === 'circle') {
            return; // group typing is shown; single-partner presence is not
          }
          setPartnerPresence({ online: payload.online, lastSeenAt: payload.lastSeenAt });
        },
      });
    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
      if (typingStopTimer.current) {
        clearTimeout(typingStopTimer.current);
      }
      if (typingRefreshTimer.current) {
        clearTimeout(typingRefreshTimer.current);
      }
      sendTypingStop(id);
    };
  }, [id, myUserId]);

  // M8: toggle this conversation's push mute (server stores the preference).
  const onToggleMute = () => {
    void (async () => {
      try {
        const token = (await loadSessionToken()) ?? '';
        const { pref } = await updateNotificationPref(token, id, { muted: !muted });
        setMuted(pref.muted);
      } catch {
        // Keep the previous state; the server rejection is authoritative.
      }
    })();
  };

  // Load the current mute state when the chat opens.
  useEffect(() => {
    void (async () => {
      try {
        const token = (await loadSessionToken()) ?? '';
        const { pref } = await fetchNotificationPref(token, id);
        setMuted(pref.muted);
      } catch {
        // Default to unmuted when the pref cannot be read.
      }
    })();
  }, [id]);

  const onLoadOlder = useCallback(async () => {
    if (!olderCursor || loadingOlder) {
      return;
    }
    setLoadingOlder(true);
    try {
      const token = (await loadSessionToken()) ?? '';
      const page = await fetchMessages(token, id, { before: olderCursor, limit: 30 });
      setMessages((current) => [...page.messages.reverse(), ...current]);
      setOlderCursor(page.nextBeforeCursor);
    } catch {
      // Keep the loaded history; a retry can fetch older pages again.
    } finally {
      setLoadingOlder(false);
    }
  }, [id, olderCursor, loadingOlder]);

  // M6 typing signals: start on first keystroke, refresh while typing, stop
  // after ~3s idle or on send. The server TTL (6s) backstops missed stops.
  const onDraftChange = (value: string) => {
    setDraft(value);
    if (typingStopTimer.current) {
      clearTimeout(typingStopTimer.current);
    }
    if (value.trim().length === 0) {
      if (typingNow) {
        setTypingNow(false);
        sendTypingStop(id);
      }
      return;
    }
    if (!typingNow) {
      setTypingNow(true);
      sendTypingStart(id);
    } else {
      // Refresh keeps the server TTL from firing while the user is active.
      sendTypingStart(id);
    }
    typingStopTimer.current = setTimeout(() => {
      setTypingNow(false);
      sendTypingStop(id);
    }, 3000);
  };

  const onSend = async () => {
    const body = draft.trim();
    if (body.length === 0 || sending) {
      return;
    }
    if (typingNow) {
      setTypingNow(false);
      sendTypingStop(id);
    }
    setSendError(null);
    setSending(true);
    try {
      const token = (await loadSessionToken()) ?? '';
      const { message } = await sendMessage(token, id, { body, clientMessageId: makeClientMessageId() });
      setMessages((current) => [...current, message]);
      setDraft('');
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    } catch {
      setSendError("Message couldn't be sent. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  };

  const onReact = (message: Message, emoji: string) => {
    setActionMessage(null);
    void (async () => {
      setReacting(true);
      try {
        const token = (await loadSessionToken()) ?? '';
        const mine = message.reactions.find((r) => r.userId === myUserId && r.emoji === emoji);
        const result = mine
          ? await removeReaction(token, message.id, emoji)
          : await addReaction(token, message.id, emoji);
        setMessages((current) => current.map((m) => (m.id === result.message.id ? result.message : m)));
      } catch {
        // Reactions are best-effort in the UI; the server state stays correct.
      } finally {
        setReacting(false);
      }
    })();
  };

  // M10: pin a Circle message to the Circle Pinboard. The server re-checks
  // membership + that the message belongs to this Circle's conversation.
  const onPin = (message: Message) => {
    setActionMessage(null);
    void (async () => {
      if (!header?.circleId) {
        return;
      }
      try {
        const token = (await loadSessionToken()) ?? '';
        await addPin(token, header.circleId, message.id);
        Alert.alert('Pinned', 'Added to the Circle Pinboard.');
      } catch (err) {
        Alert.alert(
          'Pin failed',
          err instanceof ApiError && err.code === 'PIN_EXISTS'
            ? 'This message is already on the Pinboard.'
            : 'Could not pin this message. Try again.',
        );
      }
    })();
  };

  const onDelete = (message: Message) => {
    setActionMessage(null);
    Alert.alert('Delete this message?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          void (async () => {
            try {
              const token = (await loadSessionToken()) ?? '';
              const { message: tombstone } = await deleteMessage(token, message.id);
              setMessages((current) => current.map((m) => (m.id === tombstone.id ? tombstone : m)));
            } catch {
              // Leave the message as-is; the server rejected the delete.
            }
          })(),
      },
    ]);
  };

  const onSaveEdit = async () => {
    if (!actionEditTarget) {
      return;
    }
    const body = editDraft.trim();
    if (body.length === 0) {
      return;
    }
    setEditing(false);
    try {
      const token = (await loadSessionToken()) ?? '';
      const { message } = await editMessage(token, actionEditTarget.id, body);
      setMessages((current) => current.map((m) => (m.id === message.id ? message : m)));
    } catch {
      // Editing stays unchanged if the server rejects (e.g. window expired).
    }
  };

  // ---- M7: attachment picking, voice recording and the upload pipeline ---
  const pickMedia = async (mediaTypes: 'images' | 'videos' | 'all') => {
    setAttachmentMenuVisible(false);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setSendError('Gallery permission denied — allow access in Settings to send media.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes:
        mediaTypes === 'images'
          ? ImagePicker.MediaTypeOptions.Images
          : mediaTypes === 'videos'
            ? ImagePicker.MediaTypeOptions.Videos
            : ImagePicker.MediaTypeOptions.All,
      quality: 0.8,
    });
    if (result.canceled || result.assets.length === 0) {
      return;
    }
    const asset = result.assets[0]!;
    const kind: 'image' | 'video' = asset.type === 'video' ? 'video' : 'image';
    void sendMediaAsset(asset.uri, kind, asset.mimeType ?? (kind === 'video' ? 'video/mp4' : 'image/jpeg'));
  };

  const recordVoice = async () => {
    setAttachmentMenuVisible(false);
    
    const permission = await Audio.requestPermissionsAsync();
    if (!permission.granted) {
      setSendError('Microphone permission denied — allow access in Settings to record voice.');
      return;
    }
    try {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await recording.startAsync();
      voiceRecordingRef.current = recording;
      setVoiceRecording(true);
    } catch {
      setSendError('Recording failed to start. Try again.');
    }
  };

  const stopVoiceRecording = async () => {
    const recording = voiceRecordingRef.current;
    if (!recording) {
      return;
    }
    voiceRecordingRef.current = null;
    setVoiceRecording(false);
    try {
      await recording.stopAndUnloadAsync();
      
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      const uri = recording.getURI();
      if (!uri) {
        return;
      }
      const status = await recording.getStatusAsync();
      void sendMediaAsset(uri, 'voice', 'audio/m4a', status.durationMillis ?? undefined);
    } catch {
      setSendError('Voice message failed. Try again.');
    }
  };

  const sendMediaAsset = (localUri: string, kind: 'image' | 'video' | 'voice', mimeType: string, durationMs?: number) => {
    void (async () => {
      const localId = `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      setUploadingMedia((current) => [...current, { localId, localUri, kind, stage: 'uploading', mimeType, durationMs }]);
      try {
        const token = (await loadSessionToken()) ?? '';
        const blobResponse = await fetch(localUri);
        const bytes = await blobResponse.blob();
        await uploadAndSendMedia({
          token,
          conversationId: id,
          kind,
          mimeType,
          bytes,
          durationMs,
          clientMessageId: localId,
          onProgress: () => {
            // The pipeline only reports uploading/confirming/sending here;
            // failures arrive as the catch below.
            setUploadingMedia((current) =>
              current.map((m) => (m.localId === localId ? { ...m, stage: 'uploading' as const } : m)),
            );
          },
        });
        // The confirmed message arrives via the socket (message:new) or the
        // next history fetch; the optimistic entry is dropped on success.
        setUploadingMedia((current) => current.filter((m) => m.localId !== localId));
      } catch {
        setUploadingMedia((current) =>
          current.map((m) => (m.localId === localId ? { ...m, stage: 'failed' as const } : m)),
        );
      }
    })();
  };

  const retryMedia = (localId: string) => {
    const pending = uploadingMedia.find((m) => m.localId === localId);
    if (pending) {
      setUploadingMedia((current) => current.map((m) => (m.localId === localId ? { ...m, stage: 'uploading' as const } : m)));
      sendMediaAsset(pending.localUri, pending.kind, pending.mimeType, pending.durationMs);
    }
  };

  // M7.1: debounced GIF search + send. GIF bytes never traverse our storage;
  // the provider URL rides the message (visibility is D1-gated server-side).
  const gifSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onGifQueryChange = (value: string) => {
    setGifQuery(value);
    setGifError(null);
    if (gifSearchTimer.current) {
      clearTimeout(gifSearchTimer.current);
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      setGifResults([]);
      return;
    }
    gifSearchTimer.current = setTimeout(() => {
      void (async () => {
        setGifSearching(true);
        try {
          const results = await searchGiphy(trimmed);
          setGifResults(results);
        } catch {
          setGifError(
            "Couldn't search GIFs right now — the service may not be configured or is busy.",
          );
        } finally {
          setGifSearching(false);
        }
      })();
    }, 400);
  };

  const sendGif = (gif: { url: string; width: number; height: number }) => {
    setGifPickerVisible(false);
    void (async () => {
      try {
        const token = (await loadSessionToken()) ?? '';
        const { message } = await sendMessage(token, id, {
          type: 'gif',
          externalUrl: gif.url,
          clientMessageId: `gif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        });
        setMessages((current) => [...current, message]);
        requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
      } catch {
        setSendError("GIF couldn't be sent. Check your connection and try again.");
      }
    })();
  };

  const openActions = (message: Message) => {
    setActionMessage(message);
    const withinWindow = Date.now() - new Date(message.createdAt).getTime() < 24 * 60 * 60 * 1000;
    setActionEditTarget(message.deleted ? null : message.senderId === myUserId && withinWindow ? message : null);
  };

  if (loading) {
    return (
      <View style={styles.centered} testID="conversation-loading">
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (loadError || !header) {
    return (
      <View style={styles.centered} testID="conversation-error">
        <Text style={styles.stateTitle}>Something went wrong.</Text>
        <Text style={styles.stateText}>Couldn't open this chat.</Text>
        <Pressable style={styles.secondaryButton} onPress={() => void load()} testID="conversation-retry">
          <Text style={styles.secondaryButtonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  // M12: the chat inherits the Circle's personalization (theme preset +
  // accent). Defaults apply for direct chats, which have no Circle settings.
  return (
    <CircleThemeGate circleId={header.circleId ?? ''}>
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: 'transparent' }]}
      behavior={Platform.OS === 'android' ? undefined : 'padding'}
    >
      {/* M12: themed Circle backdrop sits behind the whole conversation. */}
      <ThemedSurface />
      <ThemedHeaderBar>
        <Pressable onPress={() => router.back()} hitSlop={12} testID="conversation-back">
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>{header.title}</Text>
          {typingUsernames.length > 0 ? (
            <Text style={styles.typingText} testID="typing-indicator" numberOfLines={1}>
              {typingUsernames.length === 1
                ? `${typingUsernames[0]} is typing…`
                : 'Several people are typing…'}
            </Text>
          ) : header.type === 'direct' && partnerPresence ? (
            <Text
              style={[styles.headerSubtitle, partnerPresence.online && styles.presenceOnline]}
              testID="presence-indicator"
              numberOfLines={1}
            >
              {partnerPresence.online
                ? 'online'
                : partnerPresence.lastSeenAt
                  ? `last seen ${new Date(partnerPresence.lastSeenAt).toLocaleString()}`
                  : 'offline'}
            </Text>
          ) : (
            <Text style={styles.headerSubtitle} numberOfLines={1}>{header.subtitle}</Text>
          )}
        </View>
        <Pressable
          onPress={() => void onToggleMute()}
          hitSlop={8}
          testID="mute-toggle"
        >
          <Text style={[styles.muteIcon, muted && styles.muteIconActive]}>{muted ? '🔇' : '🔔'}</Text>
        </Pressable>
      </ThemedHeaderBar>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <MessageBubble
            message={item}
            isOwn={item.senderId === myUserId}
            showSender={header.type === 'circle'}
            onLongPress={openActions}
          />
        )}
        ListHeaderComponent={
          uploadingMedia.length > 0 ? (
            <View>
              {uploadingMedia.map((pending) => (
                <MessageBubble
                  key={pending.localId}
                  message={{
                    id: pending.localId,
                    conversationId: id,
                    senderId: myUserId ?? '',
                    senderUsername: 'me',
                    senderDisplayName: 'Me',
                    type: pending.kind,
                    body: null,
                    mediaId: null,
                    media: null,
                    replyToId: null,
                    replyPreview: null,
                    editedAt: null,
                    deleted: false,
                    createdAt: new Date().toISOString(),
                    reactions: [],
                  }}
                  isOwn
                  showSender={false}
                  localUri={pending.localUri}
                  uploadStage={pending.stage}
                  onRetry={() => retryMedia(pending.localId)}
                />
              ))}
            </View>
          ) : null
        }
        inverted={false}
        onEndReached={() => void onLoadOlder()}
        onEndReachedThreshold={0.6}
        ListFooterComponent={loadingOlder ? <ActivityIndicator color={colors.accent} style={{ margin: 12 }} /> : null}
        contentContainerStyle={styles.listContent}
        testID="conversation-list"
      />

      {sendError ? (
        <Text style={styles.sendError} testID="conversation-send-error">{sendError}</Text>
      ) : null}

      <ThemedComposer
        draft={draft}
        onDraftChange={onDraftChange}
        onSend={() => void onSend()}
        sending={sending}
        onAttachments={() => setAttachmentMenuVisible(true)}
      />

      <Modal visible={actionMessage !== null} transparent animationType="fade" onRequestClose={() => setActionMessage(null)}>
        {actionMessage ? (
          <View style={styles.modalBackdrop}>
            <ThemedModalCard testID="message-actions">
              <View style={styles.reactionRow}>
                {QUICK_REACTIONS.map((emoji) => (
                  <Pressable
                    key={emoji}
                    style={styles.reactionOption}
                    onPress={() => onReact(actionMessage, emoji)}
                    disabled={reacting}
                    testID={`react-${emoji}`}
                  >
                    <Text style={styles.reactionOptionText}>{emoji}</Text>
                  </Pressable>
                ))}
              </View>
              {actionEditTarget ? (
                <>
                  <TextInput
                    style={styles.editInput}
                    value={editDraft}
                    onChangeText={setEditDraft}
                    multiline
                    maxLength={4000}
                    testID="edit-input"
                  />
                  <Pressable style={styles.menuOption} onPress={() => void onSaveEdit()} testID="edit-save">
                    <Text style={styles.menuOptionText}>Save edit</Text>
                  </Pressable>
                </>
              ) : null}
              {header.type === 'circle' && header.circleId && !actionMessage.deleted ? (
                <Pressable style={styles.menuOption} onPress={() => onPin(actionMessage)} testID="action-pin">
                  <Text style={styles.menuOptionText}>Pin to Pinboard</Text>
                </Pressable>
              ) : null}
              <Pressable
                style={styles.menuOption}
                onPress={() => {
                  const text = actionMessage.body ?? '';
                  setActionMessage(null);
                  if (text) {
                    void import('react-native').then(({ Clipboard }) => Clipboard.setString(text));
                  }
                }}
                testID="action-copy"
              >
                <Text style={styles.menuOptionText}>Copy</Text>
              </Pressable>
              {actionMessage.senderId === myUserId || header.circleRole === 'owner' || header.circleRole === 'admin' ? (
                <Pressable style={styles.menuOptionDanger} onPress={() => onDelete(actionMessage)} testID="action-delete">
                  <Text style={styles.menuOptionDangerText}>Delete</Text>
                </Pressable>
              ) : null}
              <Pressable style={styles.textButton} onPress={() => setActionMessage(null)} testID="actions-close">
                <Text style={styles.textButtonText}>Close</Text>
              </Pressable>
            </ThemedModalCard>
          </View>
        ) : null}
      </Modal>

      <Modal visible={attachmentMenuVisible} transparent animationType="fade" onRequestClose={() => setAttachmentMenuVisible(false)}>
        <View style={styles.modalBackdrop}>
          <ThemedModalCard testID="attachment-menu">
            <Text style={styles.modalTitle}>Attach</Text>
            <Pressable style={styles.menuOption} onPress={() => void pickMedia('images')} testID="attach-image">
              <Text style={styles.menuOptionText}>Photo or GIF</Text>
            </Pressable>
            <Pressable style={styles.menuOption} onPress={() => void pickMedia('videos')} testID="attach-video">
              <Text style={styles.menuOptionText}>Video</Text>
            </Pressable>
            <Pressable style={styles.menuOption} onPress={() => void recordVoice()} testID="attach-voice">
              <Text style={styles.menuOptionText}>Voice message (max 2 min)</Text>
            </Pressable>
            <Pressable
              style={styles.menuOption}
              onPress={() => {
                setAttachmentMenuVisible(false);
                setGifPickerVisible(true);
              }}
              testID="attach-gif"
            >
              <Text style={styles.menuOptionText}>Search GIFs</Text>
            </Pressable>
            <Pressable style={styles.menuOption} disabled testID="attach-sticker">
              <Text style={[styles.menuOptionText, styles.comingSoonText]}>Stickers — coming soon</Text>
            </Pressable>
            <Pressable style={styles.textButton} onPress={() => setAttachmentMenuVisible(false)} testID="attachment-close">
              <Text style={styles.textButtonText}>Cancel</Text>
            </Pressable>
          </ThemedModalCard>
        </View>
      </Modal>

      {voiceRecording ? (
        <Pressable style={styles.voiceRecordingBar} onPress={() => void stopVoiceRecording()} testID="voice-stop">
          <Text style={styles.voiceRecordingText}>● Recording… tap to send</Text>
        </Pressable>
      ) : null}

      <Modal visible={gifPickerVisible} transparent animationType="fade" onRequestClose={() => setGifPickerVisible(false)}>
        <View style={styles.modalBackdrop}>
          <ThemedModalCard testID="gif-picker">
            <Text style={styles.modalTitle}>Search GIFs</Text>
            <TextInput
              style={styles.editInput}
              value={gifQuery}
              onChangeText={onGifQueryChange}
              placeholder="Search GIFs…"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              testID="gif-search-input"
            />
            {gifError ? <Text style={styles.sendError} testID="gif-error">{gifError}</Text> : null}
            {gifSearching ? <ActivityIndicator color={colors.accent} style={{ marginTop: 12 }} /> : null}
            {!gifSearching && gifQuery.trim().length > 0 && gifResults.length === 0 && !gifError ? (
              <Text style={styles.headerSubtitle} testID="gif-empty">No GIFs found.</Text>
            ) : null}
            {gifResults.length > 0 ? (
              // GIPHY ToS: attribution is required whenever results are shown,
              // and results must not be reordered/filtered or mixed with other
              // providers — rendered exactly as returned.
              <Text style={styles.gifAttribution} testID="gif-attribution">
                Powered By GIPHY
              </Text>
            ) : null}
            <FlatList
              data={gifResults}
              keyExtractor={(item) => item.id}
              numColumns={2}
              columnWrapperStyle={{ gap: 8 }}
              contentContainerStyle={{ gap: 8, paddingTop: 8 }}
              style={{ maxHeight: 320 }}
              renderItem={({ item }) => (
                <Pressable onPress={() => sendGif(item)} testID={`gif-${item.id}`}>
                  <Image source={{ uri: item.previewUrl }} style={styles.gifThumb} resizeMode="cover" />
                </Pressable>
              )}
            />
            <Pressable style={styles.textButton} onPress={() => setGifPickerVisible(false)} testID="gif-close">
              <Text style={styles.textButtonText}>Close</Text>
            </Pressable>
          </ThemedModalCard>
        </View>
      </Modal>

      <Modal visible={editing} transparent animationType="fade" onRequestClose={() => setEditing(false)}>
        <View style={styles.modalBackdrop}>
          <ThemedModalCard testID="edit-modal">
            <Text style={styles.modalTitle}>Edit message</Text>
            <TextInput style={styles.editInput} value={editDraft} onChangeText={setEditDraft} multiline maxLength={4000} testID="edit-modal-input" />
            <Pressable style={styles.primaryButton} onPress={() => void onSaveEdit()} testID="edit-modal-save">
              <Text style={styles.primaryButtonText}>Save</Text>
            </Pressable>
            <Pressable style={styles.textButton} onPress={() => setEditing(false)} testID="edit-modal-cancel">
              <Text style={styles.textButtonText}>Cancel</Text>
            </Pressable>
          </ThemedModalCard>
        </View>
      </Modal>
    </KeyboardAvoidingView>
    </CircleThemeGate>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingTop: 56 },
  centered: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: 24 },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backText: { color: colors.accent, fontSize: 28, fontWeight: '700', paddingHorizontal: 6 },
  headerCenter: { marginLeft: 8, flex: 1 },
  headerTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  headerSubtitle: { color: colors.textMuted, fontSize: 12, marginTop: 1 },
  typingText: { color: colors.accent, fontSize: 12, marginTop: 1, fontStyle: 'italic' },
  presenceOnline: { color: colors.success },
  muteIcon: { color: colors.textMuted, fontSize: 18, paddingHorizontal: 4 },
  muteIconActive: { color: colors.accent },
  listContent: { padding: 16, paddingBottom: 8 },
  sendError: { color: colors.error, fontSize: 12, paddingHorizontal: 16, paddingVertical: 4 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 8,
  },
  composerPlus: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.5, // attachments arrive with M7 — intentionally inert
  },
  composerPlusText: { color: colors.textMuted, fontSize: 22, fontWeight: '600' },
  comingSoonText: { color: colors.textMuted, fontStyle: 'italic' },
  voiceRecordingBar: {
    backgroundColor: colors.surface,
    borderColor: colors.error,
    borderWidth: 1,
    borderRadius: 12,
    marginHorizontal: 12,
    marginBottom: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  voiceRecordingText: { color: colors.error, fontSize: 13, fontWeight: '700' },
  gifThumb: { width: 150, height: 110, borderRadius: 10, backgroundColor: colors.surface },
  gifAttribution: { color: colors.textMuted, fontSize: 11, fontWeight: '700', textAlign: 'right', marginTop: 8 },
  composerInput: {
    flex: 1,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 18,
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 8,
    maxHeight: 110,
  },
  composerSend: {
    backgroundColor: colors.primary,
    borderRadius: 19,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  composerSendText: { color: colors.text, fontSize: 14, fontWeight: '700' },
  stateTitle: { color: colors.text, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  stateText: { color: colors.textMuted, fontSize: 13, marginTop: 6, textAlign: 'center' },
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
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(11,7,20,0.8)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 18,
    padding: 20,
    alignSelf: 'stretch',
  },
  modalTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  reactionRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  reactionOption: { padding: 8 },
  reactionOptionText: { fontSize: 26 },
  editInput: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 8,
    minHeight: 70,
    textAlignVertical: 'top',
  },
  menuOption: { paddingVertical: 13, borderTopWidth: 1, borderTopColor: colors.border },
  menuOptionText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  menuOptionDanger: { paddingVertical: 13, borderTopWidth: 1, borderTopColor: colors.border },
  menuOptionDangerText: { color: colors.error, fontSize: 15, fontWeight: '600' },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 14,
  },
  primaryButtonText: { color: colors.text, fontSize: 14, fontWeight: '700' },
  textButton: { alignItems: 'center', marginTop: 10, padding: 6 },
  textButtonText: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
});
