import { describe, expect, it } from 'vitest';
import { generateSessionToken, hashSessionToken, hashesMatch } from './tokens';

describe('session tokens (docs/SECURITY.md §3)', () => {
  it('generates 256-bit opaque base64url tokens', () => {
    const token = generateSessionToken();
    // 32 bytes → 43 base64url characters, URL-safe alphabet only.
    expect(token).toHaveLength(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('never generates the same token twice', () => {
    const tokens = new Set(Array.from({ length: 500 }, () => generateSessionToken()));
    expect(tokens.size).toBe(500);
  });

  it('stores only a deterministic SHA-256 hash, never the raw token', () => {
    const token = generateSessionToken();
    const hash = hashSessionToken(token);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).toBe(hashSessionToken(token));
    expect(hash).not.toContain(token);
  });

  it('compares hashes timing-safely', () => {
    const token = generateSessionToken();
    const hash = hashSessionToken(token);
    expect(hashesMatch(hash, hashSessionToken(token))).toBe(true);
    expect(hashesMatch(hash, hashSessionToken(generateSessionToken()))).toBe(false);
    expect(hashesMatch(hash, 'short')).toBe(false);
  });
});
