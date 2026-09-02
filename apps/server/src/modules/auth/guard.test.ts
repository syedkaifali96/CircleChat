import { afterEach, describe, expect, it } from 'vitest';
import { clearFailures, isBlocked, recordFailure, resetLoginGuard } from './guard';

describe('login failure guard (docs/SECURITY.md §6)', () => {
  afterEach(() => {
    resetLoginGuard();
  });

  it('does not block below the failure threshold', () => {
    for (let i = 0; i < 4; i++) {
      recordFailure('user_a');
    }
    expect(isBlocked('user_a')).toBe(0);
  });

  it('locks a username after 5 consecutive failures (15-minute lockout)', () => {
    for (let i = 0; i < 5; i++) {
      recordFailure('user_b');
    }
    const seconds = isBlocked('user_b');
    expect(seconds).toBeGreaterThan(0);
    expect(seconds).toBeLessThanOrEqual(15 * 60);
  });

  it('tracks usernames independently and case-insensitively', () => {
    for (let i = 0; i < 5; i++) {
      recordFailure('User_C');
    }
    expect(isBlocked('user_c')).toBeGreaterThan(0);
    expect(isBlocked('user_d')).toBe(0);
  });

  it('clears failures on successful login', () => {
    for (let i = 0; i < 5; i++) {
      recordFailure('user_e');
    }
    clearFailures('user_e');
    expect(isBlocked('user_e')).toBe(0);
  });
});
