import { describe, expect, it } from 'vitest';
import { generateRecoveryCode, hashSecret, normalizeRecoveryCode, verifySecret } from './crypto';

describe('password hashing (docs/SECURITY.md §4.1)', () => {
  it('produces an Argon2id PHC hash and verifies the correct password', async () => {
    const hash = await hashSecret('correct-horse-battery');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await verifySecret(hash, 'correct-horse-battery')).toBe(true);
  });

  it('rejects wrong passwords', async () => {
    const hash = await hashSecret('correct-horse-battery');
    expect(await verifySecret(hash, 'wrong-password')).toBe(false);
  });

  it('produces unique hashes for identical inputs (salted)', async () => {
    const a = await hashSecret('same-password');
    const b = await hashSecret('same-password');
    expect(a).not.toBe(b);
    expect(await verifySecret(a, 'same-password')).toBe(true);
    expect(await verifySecret(b, 'same-password')).toBe(true);
  });
});

describe('recovery codes (docs/SECURITY.md §4.3)', () => {
  it('generates codes in the documented XXXX-XXXX-XXXX format', () => {
    for (let i = 0; i < 20; i++) {
      const code = generateRecoveryCode();
      expect(code).toMatch(/^[1-9A-HJ-NP-Z]{4}-[1-9A-HJ-NP-Z]{4}-[1-9A-HJ-NP-Z]{4}$/);
    }
  });

  it('generates unique codes (CSPRNG, not sequential)', () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateRecoveryCode()));
    expect(codes.size).toBe(200);
  });

  it('normalizes separators/case before hashing and verification', () => {
    expect(normalizeRecoveryCode('abcd-efgh-jklm')).toBe('ABCDEFGHJKLM');
    expect(normalizeRecoveryCode('ABCD EFGH JKLM')).toBe('ABCDEFGHJKLM');
  });

  it('stores only hashes: verification works after hashing, raw code is not recoverable', async () => {
    const code = generateRecoveryCode();
    const hash = await hashSecret(normalizeRecoveryCode(code));
    expect(hash).not.toContain(code);
    expect(await verifySecret(hash, normalizeRecoveryCode(code))).toBe(true);
    expect(await verifySecret(hash, normalizeRecoveryCode('XXXXXXXXXXXX'))).toBe(false);
  });
});
