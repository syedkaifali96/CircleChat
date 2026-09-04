import { z } from 'zod';

/**
 * Message schemas (M5 text + M7 media) — docs/API.md, docs/DATABASE.md §1.7–1.8.
 * Limits mirror the database CHECKs: body ≤ 4000 chars, text needs no media,
 * non-text requires media (uploaded and confirmed BEFORE the message row).
 */

export const messageBodySchema = z.string().trim().min(1).max(4000);

/* ------------------------------------------------ chat media (M7) ------- */

/** GIF-as-image upload rides the image kind (docs/API.md); the GIF search
 * picker/provider itself remains V2 per the product spec. External (Tenor)
 * GIFs ride the dedicated 'gif' kind with external_url (M7.1). */
export const CHAT_MEDIA_KINDS = ['image', 'video', 'voice', 'file', 'gif'] as const;
export const CHAT_MEDIA_KIND = z.enum(CHAT_MEDIA_KINDS);

/** Per-kind upload caps (docs/SECURITY.md §7). */
export const CHAT_MEDIA_MAX_BYTES: Record<(typeof CHAT_MEDIA_KINDS)[number], number> = {
  image: 10 * 1024 * 1024,
  video: 50 * 1024 * 1024,
  voice: 10 * 1024 * 1024,
  file: 10 * 1024 * 1024,
  // External GIFs bypass the storage pipeline; the cap only guards uploads.
  gif: 10 * 1024 * 1024,
};

/** Voice messages: hard server-enforced ceiling on the declared duration. */
export const VOICE_MAX_DURATION_MS = 2 * 60 * 1000;

const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
const VIDEO_MIME_TYPES = ['video/mp4'] as const;
const VOICE_MIME_TYPES = ['audio/aac', 'audio/m4a', 'audio/mp4'] as const;

export const CHAT_MEDIA_MIME_TYPES: Record<(typeof CHAT_MEDIA_KINDS)[number], readonly string[]> = {
  image: IMAGE_MIME_TYPES,
  video: VIDEO_MIME_TYPES,
  voice: VOICE_MIME_TYPES,
  file: [], // generic file uploads stay out of the MVP scope
  gif: ['image/gif'], // external URLs only; never uploaded through storage
};

const chatMediaIntentBase = z.object({
  kind: CHAT_MEDIA_KIND,
  mimeType: z.string(),
  sizeBytes: z.number().int().min(1),
  durationMs: z.number().int().min(1).optional(),
});

/** Per-kind MIME/size/duration validation, applied server-side on the intent. */
export const chatMediaUploadSchema = chatMediaIntentBase
  .refine((v) => (CHAT_MEDIA_MIME_TYPES[v.kind] as readonly string[]).includes(v.mimeType), {
    message: 'MIME type is not allowed for this media kind.',
  })
  .refine((v) => v.sizeBytes <= CHAT_MEDIA_MAX_BYTES[v.kind], {
    message: 'File exceeds the size limit for this media kind.',
  })
  .refine((v) => v.kind !== 'voice' || (v.durationMs !== undefined && v.durationMs <= VOICE_MAX_DURATION_MS), {
    message: 'Voice messages are limited to 2 minutes.',
  })
  .refine((v) => v.kind === 'voice' || v.durationMs === undefined || v.durationMs <= 30 * 60 * 1000, {
    message: 'Duration is out of range.',
  });

/** M5 send schema extended (M7 + M7.1): media sends reference a CONFIRMED
 * media row; GIF sends carry the provider URL (external_url). */
export const sendMessageSchema = z
  .object({
    type: z.enum(['text', 'image', 'video', 'voice', 'file', 'gif']).default('text'),
    body: messageBodySchema.optional(),
    mediaId: z.string().uuid().optional(),
    externalUrl: z.string().url().max(1000).optional(),
    replyToId: z.string().uuid().optional(),
    clientMessageId: z.string().trim().min(1).max(64),
  })
  .refine((v) => (v.type === 'text' ? v.body !== undefined && v.body.length > 0 : true), {
    message: 'Text messages require a body.',
  })
  .refine((v) => (v.type === 'gif' ? v.externalUrl !== undefined && v.mediaId === undefined : true), {
    message: 'GIF messages require an externalUrl and cannot carry a mediaId.',
  })
  .refine((v) => (v.type === 'text' ? v.mediaId === undefined && v.externalUrl === undefined : true), {
    message: 'Text messages cannot carry media fields.',
  })
  .refine((v) => (v.type !== 'text' && v.type !== 'gif' ? v.mediaId !== undefined : true), {
    message: 'Media messages require a mediaId.',
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

export const messageMediaSchema = z.object({
  kind: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  durationMs: z.number().int().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  /** M7.1: set for external GIFs (Tenor) — rendered directly, no signed URL. */
  externalUrl: z.string().nullable(),
  /** M7.1: true when a 400px thumbnail exists for this image. */
  hasThumbnail: z.boolean().nullable(),
});

export const messageSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  senderId: z.string().uuid(),
  senderUsername: z.string(),
  senderDisplayName: z.string(),
  type: z.enum(['text', 'image', 'video', 'voice', 'file', 'gif']),
  body: z.string().nullable(),
  mediaId: z.string().uuid().nullable(),
  /** M7: metadata from the READY media row (mime, dimensions, duration). */
  media: messageMediaSchema.nullable(),
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
export type ChatMediaUploadInput = z.infer<typeof chatMediaUploadSchema>;
