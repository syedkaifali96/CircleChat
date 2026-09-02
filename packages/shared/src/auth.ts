import { z } from 'zod';

/**
 * Authentication validation schemas shared by the mobile app and the server
 * (docs/API.md, docs/SECURITY.md §4.2). Server enforces the same rules again —
 * client-side validation is UX only, never a security control.
 */

/** Database rule (docs/DATABASE.md §1.1): ^[a-z0-9_]{3,20}$, stored lowercase. */
export const usernameSchema = z.string().regex(/^[a-z0-9_]{3,20}$/);

/** docs/SECURITY.md §4.2: minimum 10, maximum 128, no composition rules. */
export const passwordSchema = z.string().min(10).max(128);

export const displayNameSchema = z.string().trim().min(1).max(40);

export const recoveryCodeSchema = z
  .string()
  .transform((value) => value.toUpperCase().replace(/[\s-]/g, ''))
  .pipe(z.string().length(12));

export const signupSchema = z.object({
  username: usernameSchema,
  displayName: displayNameSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({
  username: z.string().min(3).max(20),
  password: z.string().min(1).max(128),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});

export const recoveryResetSchema = z.object({
  username: z.string().min(3).max(20),
  recoveryCode: recoveryCodeSchema,
  newPassword: passwordSchema,
});

/** Public user shape returned by auth endpoints — never includes hashes. */
export const publicUserSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  displayName: z.string(),
  bio: z.string().nullable(),
  avatarMediaId: z.string().nullable(),
  createdAt: z.string(),
});

export type Username = z.infer<typeof usernameSchema>;
export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type RecoveryResetInput = z.infer<typeof recoveryResetSchema>;
export type PublicUser = z.infer<typeof publicUserSchema>;
