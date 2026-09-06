import { z } from 'zod';

/**
 * Circle schemas (M4) — docs/API.md, docs/DATABASE.md §1.2–1.4, §3.
 * Limits mirror the database CHECKs: name 1–40, accent #RRGGBB.
 */

export const circleNameSchema = z.string().trim().min(1).max(40);
export const circleDescriptionSchema = z.string().trim().max(200).nullable();

export const accentColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/);

export const createCircleSchema = z.object({
  name: circleNameSchema,
  description: circleDescriptionSchema.optional(),
  avatarMediaId: z.string().uuid().optional(),
});

export const updateCircleSchema = z
  .object({
    name: circleNameSchema.optional(),
    description: circleDescriptionSchema.optional(),
  })
  .refine((value) => value.name !== undefined || value.description !== undefined, {
    message: 'Nothing to update.',
  });

export const createInviteSchema = z.object({
  expiresInDays: z.number().int().min(1).max(30).default(7),
});

export const joinCircleSchema = z.object({
  inviteCode: z
    .string()
    .transform((value) => value.toUpperCase().replace(/[\s-]/g, ''))
    .pipe(z.string().min(12).max(12)),
});

export const circleRoleSchema = z.enum(['admin', 'member']);

export const ownershipTransferSchema = z.object({
  newOwnerUserId: z.string().uuid(),
});

/** M12 personalization: app-defined Circle theme presets and bundled chat
 * background keys are STABLE identifiers — the client never ships arbitrary
 * style blobs (docs/DATABASE.md §1.4 "app-defined presets"). */
export const THEME_PRESETS = ['dark_purple', 'midnight', 'orchid', 'ember'] as const;
export const BACKGROUND_KEYS = ['none', 'aurora', 'dusk', 'velvet'] as const;
export type ThemePreset = (typeof THEME_PRESETS)[number];
export type BackgroundKey = (typeof BACKGROUND_KEYS)[number];

export const circleSettingsSchema = z
  .object({
    themePreset: z.enum(THEME_PRESETS).optional(),
    accentColor: accentColorSchema.nullable().optional(),
    backgroundKey: z.enum(BACKGROUND_KEYS).nullable().optional(),
  })
  .refine(
    (value) =>
      value.themePreset !== undefined ||
      value.accentColor !== undefined ||
      value.backgroundKey !== undefined,
    { message: 'Nothing to update.' },
  );

export const circleMemberSchema = z.object({
  userId: z.string().uuid(),
  username: z.string(),
  displayName: z.string(),
  role: z.enum(['owner', 'admin', 'member']),
  joinedAt: z.string(),
});

export const circleSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  avatarMediaId: z.string().nullable(),
  membersCount: z.number().int(),
  callerRole: z.enum(['owner', 'admin', 'member']),
  createdAt: z.string(),
  members: z.array(circleMemberSchema),
});

export const circleListItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  avatarMediaId: z.string().nullable(),
  membersCount: z.number().int(),
  callerRole: z.enum(['owner', 'admin', 'member']),
  /** Real values arrive with M5 messaging; M4 always reports 0. */
  unreadCount: z.number().int(),
});

export const invitePreviewSchema = z.object({
  name: z.string(),
  memberCount: z.number().int(),
  avatarMediaId: z.string().nullable(),
  /** Short-TTL presigned URL issued for the valid invite-preview request only. */
  avatarUrl: z.string().nullable(),
});

export type CreateCircleInput = z.infer<typeof createCircleSchema>;
export type UpdateCircleInput = z.infer<typeof updateCircleSchema>;
export type CircleSettingsInput = z.infer<typeof circleSettingsSchema>;

/** M10: pin an eligible Circle message to the Circle Pinboard. Only the
 * message reference is client-supplied — circle, pinner and timestamps are
 * derived server-side from the authenticated request (docs/API.md). */
export const createPinSchema = z.object({
  messageId: z.string().uuid(),
});

export type CreatePinInput = z.infer<typeof createPinSchema>;

/* ------------------------------------------------------------ polls (M11) */

/** M11: create a poll on a Circle conversation (docs/DATABASE.md §1.13 —
 * single-choice, 2–6 options of ≤80 chars, question ≤300 chars). Only the
 * question/option labels are client-controlled; circle, creator, ids and
 * timestamps are derived server-side. */
export const createPollSchema = z.object({
  question: z.string().trim().min(1).max(300),
  options: z
    .array(z.string().trim().min(1).max(80))
    .min(2)
    .max(6)
    .refine((labels) => new Set(labels).size === labels.length, {
      message: 'Options must be distinct.',
    }),
  closesAt: z.string().datetime().optional(),
});

export const pollVoteSchema = z.object({
  /** Index into the poll's options array (MVP polls are single-choice). */
  optionIndex: z.number().int().min(0).max(5),
});

export type CreatePollInput = z.infer<typeof createPollSchema>;
export type PollVoteInput = z.infer<typeof pollVoteSchema>;
