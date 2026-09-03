import { z } from 'zod';

/**
 * Conversation schemas (M5) — docs/API.md, docs/DATABASE.md §1.5–1.6, §1.11.
 * Direct chats are authorized by `conversation_participants` only; `direct_key`
 * is a uniqueness helper and never appears in (or authorizes) any response.
 */

export const directUsernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(20)
  .regex(/^[a-z0-9_]+$/);

export const conversationListItemSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(['circle', 'direct']),
  /** Present when type='circle'. */
  circleId: z.string().uuid().nullable(),
  circleName: z.string().nullable(),
  circleAvatarMediaId: z.string().uuid().nullable(),
  /** Direct partner's minimal identity; null for circle conversations. */
  partnerUsername: z.string().nullable(),
  partnerDisplayName: z.string().nullable(),
  partnerAvatarMediaId: z.string().uuid().nullable(),
  lastMessageAt: z.string().nullable(),
  lastMessagePreview: z.string().nullable(),
  unreadCount: z.number().int().min(0),
});

export const conversationMessagesQuerySchema = z.object({
  before: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const reactionEmojiSchema = z.enum(['❤️', '😂', '👍', '😮', '😢', '🔥']);

export const conversationReadSchema = z.object({
  lastReadMessageId: z.string().uuid(),
});

export const notificationPrefSchema = z
  .object({
    enabled: z.boolean().optional(),
    muted: z.boolean().optional(),
    mentions: z.boolean().optional(),
    preview: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.enabled !== undefined ||
      value.muted !== undefined ||
      value.mentions !== undefined ||
      value.preview !== undefined,
    { message: 'Nothing to update.' },
  );

export type ConversationListItem = z.infer<typeof conversationListItemSchema>;
export type NotificationPrefInput = z.infer<typeof notificationPrefSchema>;
