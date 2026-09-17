import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Message } from '../lib/api';
import { colors, typography } from '../design/tokens';
import { useCircleTheme } from '../design/CircleTheme';
import { MediaContent } from './MediaContent';

/**
 * Chat bubble (design.md §13–§15): warm outgoing / quiet incoming,
 * sender name for group messages, compact reply preview, reaction chips,
 * edited marker, and a tombstone view for deleted messages. Media content
 * (M7) renders inline with upload progress/retry for outgoing sends.
 * Long-press opens the parent-supplied action menu — no permanent buttons.
 *
 * M12: bubble fills and accent details resolve through the Circle theme —
 * direct chats (no Circle settings) get the default brand roles unchanged.
 */

interface MessageBubbleProps {
  message: Message;
  isOwn: boolean;
  showSender: boolean;
  /** Outgoing optimistic media: local preview + upload state. */
  localUri?: string;
  uploadStage?: 'pending' | 'uploading' | 'failed';
  onRetry?: (message: Message) => void;
  onLongPress?: (message: Message) => void;
}

function MessageBubbleImpl({ message, isOwn, showSender, localUri, uploadStage, onRetry, onLongPress }: MessageBubbleProps) {
  const themed = useCircleTheme().colors;

  if (message.deleted) {
    return (
      <View style={[styles.row, isOwn ? styles.rowOwn : null]} testID={`message-${message.id}`}>
        <View style={[styles.bubble, styles.deletedBubble, { backgroundColor: themed.surface, borderColor: themed.border }]}>
          <Text style={styles.deletedText} testID={`message-body-${message.id}`}>
            Message deleted
          </Text>
        </View>
      </View>
    );
  }

  const hasMedia = message.mediaId !== null || uploadStage !== undefined;

  return (
    <Pressable
      style={[styles.row, isOwn ? styles.rowOwn : null]}
      onLongPress={() => onLongPress?.(message)}
      accessibilityLabel={`Message from ${message.senderDisplayName}`}
      testID={`message-${message.id}`}
    >
      <View
        style={[
          styles.bubble,
          isOwn
            ? [styles.ownBubble, { backgroundColor: themed.bubbleOwn }]
            : [styles.incomingBubble, { backgroundColor: themed.bubbleOther, borderColor: themed.border }],
        ]}
      >
        {showSender && !isOwn ? (
          <Text style={[styles.senderName, { color: themed.accent }]} testID={`message-sender-${message.id}`}>
            {message.senderDisplayName}
          </Text>
        ) : null}
        {message.replyPreview ? (
          <View style={[styles.replyPreview, { borderLeftColor: themed.accent }]} testID={`reply-preview-${message.id}`}>
            <Text style={[styles.replyPreviewSender, { color: themed.accent }]} numberOfLines={1}>
              {message.replyPreview.deleted ? 'Deleted message' : `@${message.replyPreview.senderUsername}`}
            </Text>
            <Text style={[styles.replyPreviewBody, isOwn && { color: themed.bubbleOwnText }]} numberOfLines={2}>
              {message.replyPreview.deleted ? 'Message deleted' : message.replyPreview.body}
            </Text>
          </View>
        ) : null}
        {hasMedia ? (
          <MediaContent
            message={message}
            localUri={localUri}
            uploadStage={uploadStage}
            onRetry={onRetry}
          />
        ) : null}
        {message.body ? (
          <Text
            style={[styles.body, isOwn ? [styles.ownBody, { color: themed.bubbleOwnText }] : null]}
            testID={`message-body-${message.id}`}
          >
            {message.body}
          </Text>
        ) : null}
        <View style={styles.metaRow}>
          {message.editedAt ? <Text style={[styles.metaText, isOwn && { color: themed.bubbleOwnText }]} testID={`edited-${message.id}`}>edited</Text> : null}
          {message.reactions.length > 0 ? (
            <View style={styles.reactions} testID={`reactions-${message.id}`}>
              {message.reactions.map((reaction) => (
                <Text
                  key={`${reaction.userId}-${reaction.emoji}`}
                  style={[styles.reactionChip, { backgroundColor: themed.background, borderColor: themed.border }]}
                >
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
  row: { flexDirection: 'row', marginTop: 7, paddingHorizontal: 2 },
  rowOwn: { justifyContent: 'flex-end' },
  bubble: {
    maxWidth: '80%',
    borderRadius: 18,
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  ownBubble: { backgroundColor: colors.primary, borderBottomRightRadius: 5 },
  incomingBubble: { backgroundColor: colors.surface, borderBottomLeftRadius: 5 },
  senderName: { ...typography.captionStrong, color: colors.accent, fontSize: 11, marginBottom: 2 },
  replyPreview: {
    borderLeftWidth: 2,
    borderLeftColor: colors.accent,
    paddingLeft: 8,
    marginBottom: 4,
  },
  replyPreviewSender: { ...typography.captionStrong, color: colors.accent, fontSize: 11 },
  replyPreviewBody: { ...typography.caption, color: colors.textSecondary },
  body: { ...typography.body, color: colors.text },
  ownBody: { color: colors.primaryContent },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  metaText: { ...typography.caption, color: colors.textMuted, fontSize: 10 },
  reactions: { flexDirection: 'row', gap: 4 },
  reactionChip: {
    ...typography.caption,
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
  deletedText: { ...typography.caption, color: colors.textMuted, fontSize: 13, fontStyle: 'italic' },
});
