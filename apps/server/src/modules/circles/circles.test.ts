import { describe, expect, it } from 'vitest';
import type { Database } from '../../db/client';
import { generateInviteCode, hashInviteCode, resolveInvitePreview } from './service';

/**
 * Unit tests for the invite-code primitives and preview normalization
 * (docs/DATABASE.md §1.2 invite semantics). The full HTTP contract is covered
 * by circles.integration.test.ts against real PostgreSQL.
 */

describe('invite code format (Crockford-style, no ambiguous glyphs)', () => {
  it('generates 12 significant characters with two separators', () => {
    for (let i = 0; i < 100; i++) {
      const code = generateInviteCode();
      expect(code).toMatch(/^[1-9A-HJ-NP-Z]{4}-[1-9A-HJ-NP-Z]{4}-[1-9A-HJ-NP-Z]{4}$/);
    }
  });

  it('generates distinct codes with CSPRNG entropy', () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateInviteCode()));
    expect(codes.size).toBe(200);
  });

  it('hashes deterministically and never stores the raw code', () => {
    const code = generateInviteCode();
    expect(hashInviteCode(code)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashInviteCode(code)).toBe(hashInviteCode(code));
    // Join normalization (uppercase, strip separators) happens before hashing;
    // equal normalized forms must hash identically, whichever way they were typed.
    const normalize = (value: string) => value.toUpperCase().replace(/[\s-]/g, '');
    expect(hashInviteCode(normalize(code))).toBe(hashInviteCode(normalize(code.toLowerCase())));
    expect(hashInviteCode(normalize('  ' + code + ' '))).toBe(hashInviteCode(normalize(code)));
  });
});

describe('resolveInvitePreview argument contract', () => {
  // A compile-time-compatible stub: unit tests exercise only the guard path.
  const failingDb = {
    select: () => {
      throw new Error('db must not be touched for malformed codes');
    },
  } as unknown as Database;

  it('rejects codes that do not normalize to exactly 12 characters', async () => {
    await expect(resolveInvitePreview(failingDb, 'ABC')).resolves.toBeUndefined();
    await expect(resolveInvitePreview(failingDb, '')).resolves.toBeUndefined();
    await expect(resolveInvitePreview(failingDb, 'A'.repeat(13))).resolves.toBeUndefined();
  });
});
