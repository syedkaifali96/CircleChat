import { z } from 'zod';

/**
 * Profile + media schemas (M3) — docs/DATABASE.md §1.1/§1.9, docs/SECURITY.md §7.
 * Server limits mirror the database CHECKs and ARCHITECTURE.md §9 upload caps.
 * Client-side use is UX only; the server re-validates everything.
 */

export const displayNameSchema = z.string().trim().min(1).max(40);

/** bio is optional and clearable: null clears it, omission leaves it unchanged. */
export const bioSchema = z.string().trim().max(200).nullable();

export const profileUpdateSchema = z
  .object({
    displayName: displayNameSchema.optional(),
    bio: bioSchema.optional(),
  })
  .refine((value) => value.displayName !== undefined || value.bio !== undefined, {
    message: 'Nothing to update.',
  });

export const usernameParamSchema = z.string().regex(/^[a-z0-9_]{3,20}$/);

/** Minimal profile of ANOTHER user: display name + avatar only (docs/API.md). */
export const minimalProfileSchema = z.object({
  username: z.string(),
  displayName: z.string(),
  avatarMediaId: z.string().uuid().nullable(),
});

/** M3 media uploads: avatar images only (chat media arrives with M5). */
export const MEDIA_KINDS = ['avatar'] as const;
export const MEDIA_KIND = z.enum(MEDIA_KINDS);

export const AVATAR_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024; // docs/ARCHITECTURE.md §9: avatars 2 MB

export const mediaUploadIntentSchema = z.object({
  kind: MEDIA_KIND,
  mimeType: z.enum(AVATAR_MIME_TYPES),
  sizeBytes: z.number().int().min(1).max(AVATAR_MAX_BYTES),
});

export const avatarAssignSchema = z.object({
  mediaId: z.string().uuid(),
});

export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;
export type MediaUploadIntentInput = z.infer<typeof mediaUploadIntentSchema>;
export type MinimalProfile = z.infer<typeof minimalProfileSchema>;
