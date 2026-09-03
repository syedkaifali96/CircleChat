import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Message } from '../lib/api';
import { colors } from '../design/tokens';

/**
 * Chat bubble (design.md §13–§15): outgoing purple / incoming neutral,
 * sender name for group messages, compact reply preview, reaction chips,
 * edited marker, and a tombstone view for deleted messages. Long-press opens
 * the parent-supplied action menu — no permanent row buttons.
 */

interface MessageBubbleProps {
  message: Message;
  isOwn: boolean;
  showSender: boolean;
  onLongPress?: (message: Message) => void;
}

function MessageBubbleImpl({ message, isOwn, showSender, onLongPress }: MessageBubbleProps) {
  if (message.deleted) {
    return (
      <View style={[styles.row, isOwn ? styles.rowOwn : null]} testID={`message-${message.id}`}>
        <View style={[styles.bubble, styles.deletedBubble]}>
          <Text style={styles.deletedText} testID={`message-body-${message.id}`}>
            Message deleted
          </Text>
        </View>
      </View>
    );
  }

  return (
    <Pressable
      style={[styles.row, isOwn ? styles.rowOwn : null]}
      onLongPress={() => onLongPress?.(message)}
      accessibilityLabel={`Message from ${message.senderDisplayName}`}
      testID={`message-${message.id}`}
    >
      <View style={[styles.bubble, isOwn ? styles.ownBubble : styles.incomingBubble]}>
        {showSender && !isOwn ? (
          <Text style={styles.senderName} testID={`message-sender-${message.id}`}>
            {message.senderDisplayName}
          </Text>
        ) : null}
        {message.replyPreview ? (
          <View style={styles.replyPreview} testID={`reply-preview-${message.id}`}>
            <Text style={styles.replyPreviewSender} numberOfLines={1}>
              {message.replyPreview.deleted ? 'Deleted message' : `@${message.replyPreview.senderUsername}`}
            </Text>
            <Text style={styles.replyPreviewBody} numberOfLines={2}>
              {message.replyPreview.deleted ? 'Message deleted' : message.replyPreview.body}
            </Text>
          </View>
        ) : null}
        <Text style={[styles.body, isOwn ? styles.ownBody : null]} testID={`message-body-${message.id}`}>
          {message.body}
        </Text>
        <View style={styles.metaRow}>
          {message.editedAt ? <Text style={styles.metaText} testID={`edited-${message.id}`}>edited</Text> : null}
          {message.reactions.length > 0 ? (
            <View style={styles.reactions} testID={`reactions-${message.id}`}>
              {message.reactions.map((reaction) => (
                <Text key={`${reaction.userId}-${reaction.emoji}`} style={styles.reactionChip}>
                  {reaction.emoji}
                </Text>
              ))}
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

export const MessageBubble = memo(MessageBubbleImpl);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', marginTop: 6, paddingHorizontal: 4 },
  rowOwn: { justifyContent: 'flex-end' },
  bubble: {
    maxWidth: '82%',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  ownBubble: { backgroundColor: colors.primary, borderBottomRightRadius: 6 },
  incomingBubble: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderBottomLeftRadius: 6 },
  senderName: { color: colors.accent, fontSize: 11, fontWeight: '700', marginBottom: 2 },
  replyPreview: {
    borderLeftWidth: 2,
    borderLeftColor: colors.accent,
    paddingLeft: 8,
    marginBottom: 4,
  },
  replyPreviewSender: { color: colors.accent, fontSize: 11, fontWeight: '600' },
  replyPreviewBody: { color: colors.textSecondary, fontSize: 12 },
  body: { color: colors.text, fontSize: 15, lineHeight: 20 },
  ownBody: { color: colors.text },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  metaText: { color: colors.textMuted, fontSize: 10 },
  reactions: { flexDirection: 'row', gap: 4 },
  reactionChip: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    overflow: 'hidden',
    paddingHorizontal: 6,
    paddingVertical: 1,
    fontSize: 12,
    color: colors.text,
  },
  deletedBubble: { backgroundColor: colors.surface, borderStyle: 'dashed', borderWidth: 1, borderColor: colors.border },
  deletedText: { color: colors.textMuted, fontSize: 13, fontStyle: 'italic' },
});
