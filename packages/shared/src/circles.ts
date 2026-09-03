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

export const circleSettingsSchema = z
  .object({
    themePreset: z.string().trim().min(1).max(40).optional(),
    accentColor: accentColorSchema.nullable().optional(),
    backgroundKey: z.string().trim().min(1).max(60).nullable().optional(),
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
