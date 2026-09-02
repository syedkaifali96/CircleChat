import { Algorithm, hash, verify } from '@node-rs/argon2';
import { randomBytes } from 'node:crypto';

/**
 * Password and recovery-code hashing (docs/SECURITY.md §4).
 * Argon2id via @node-rs/argon2 — the single centralized parameter constant.
 * OWASP-recommended baseline: 19 MiB memory, 2 iterations, parallelism 1.
 * No custom cryptography anywhere in this project.
 */
const ARGON2ID_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashSecret(plain: string): Promise<string> {
  return hash(plain, ARGON2ID_OPTIONS);
}

export async function verifySecret(hashValue: string, plain: string): Promise<boolean> {
  return verify(hashValue, plain);
}

/**
 * Recovery code (docs/SECURITY.md §4.3): CSPRNG, ~60 bits, Crockford-style
 * base32 without ambiguous characters, formatted XXXX-XXXX-XXXX, shown once
 * and stored only as an Argon2id hash.
 */
const RECOVERY_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function generateRecoveryCode(): string {
  const bytes = randomBytes(12);
  let code = '';
  for (let i = 0; i < 12; i++) {
    code += RECOVERY_ALPHABET[bytes[i]! % RECOVERY_ALPHABET.length];
    if (i === 3 || i === 7) {
      code += '-';
    }
  }
  return code;
}

export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[\s-]/g, '');
}
