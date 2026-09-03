import { z } from 'zod';

/**
 * Message schemas (M5, text-only) — docs/API.md, docs/DATABASE.md §1.7–1.8.
 * Limits mirror the database CHECKs: body ≤ 4000 chars, text needs no media,
 * non-text requires media (media sending itself arrives with M7).
 */

export const messageBodySchema = z.string().trim().min(1).max(4000);

export const sendMessageSchema = z
  .object({
    type: z.literal('text').default('text'),
    body: messageBodySchema.optional(),
    replyToId: z.string().uuid().optional(),
    clientMessageId: z.string().trim().min(1).max(64),
  })
  .refine((value) => value.type !== 'text' || (value.body !== undefined && value.body.length > 0), {
    message: 'Text messages require a body.',
  });

export const editMessageSchema = z.object({
  body: messageBodySchema,
});

export const addReactionSchema = z.object({
  emoji: z.enum(['❤️', '😂', '👍', '😮', '😢', '🔥']),
});

export const messageReactionSchema = z.object({
  emoji: z.enum(['❤️', '😂', '👍', '😮', '😢', '🔥']),
  userId: z.string().uuid(),
  username: z.string(),
});

export const messageSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  senderId: z.string().uuid(),
  senderUsername: z.string(),
  senderDisplayName: z.string(),
  type: z.enum(['text', 'image', 'video', 'voice', 'file']),
  body: z.string().nullable(),
  mediaId: z.string().uuid().nullable(),
  replyToId: z.string().uuid().nullable(),
  /** Compact preview of the referenced message for reply UI. */
  replyPreview: z
    .object({
      id: z.string().uuid(),
      senderUsername: z.string(),
      body: z.string().nullable(),
      deleted: z.boolean(),
    })
    .nullable(),
  editedAt: z.string().nullable(),
  /** Tombstoned messages keep their row but never expose body/media. */
  deleted: z.boolean(),
  createdAt: z.string(),
  reactions: z.array(messageReactionSchema),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type Message = z.infer<typeof messageSchema>;
