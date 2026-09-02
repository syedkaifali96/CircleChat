import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

describe('loadConfig', () => {
  it('applies documented defaults when the environment is empty', () => {
    const cfg = loadConfig({});

    expect(cfg.nodeEnv).toBe('development');
    expect(cfg.port).toBe(3000);
    expect(cfg.logLevel).toBe('info');
    expect(cfg.databaseUrl).toBeUndefined();
    expect(cfg.sessionTtlDays).toBe(30);
  });

  it('accepts explicit valid values', () => {
    const cfg = loadConfig({
      NODE_ENV: 'production',
      PORT: '8080',
      LOG_LEVEL: 'warn',
      DATABASE_URL: 'postgres://localhost:5432/circlechat',
      SESSION_TTL_DAYS: '14',
    });

    expect(cfg.nodeEnv).toBe('production');
    expect(cfg.port).toBe(8080);
    expect(cfg.logLevel).toBe('warn');
    expect(cfg.databaseUrl).toBe('postgres://localhost:5432/circlechat');
    expect(cfg.sessionTtlDays).toBe(14);
  });

  it('fails closed on invalid values (startup must not continue with bad config)', () => {
    expect(() => loadConfig({ PORT: 'not-a-port' })).toThrow(
      /Invalid environment configuration/,
    );
    expect(() => loadConfig({ NODE_ENV: 'staging' })).toThrow(/Invalid environment configuration/);
    expect(() => loadConfig({ SESSION_TTL_DAYS: '0' })).toThrow(/Invalid environment configuration/);
  });

  it('reads DATABASE_URL for the database connection (docs/DEPLOYMENT.md §3)', () => {
    const cfg = loadConfig({ DATABASE_URL: 'postgres://user:secret@localhost:5432/circlechat' });
    expect(cfg.databaseUrl).toBe('postgres://user:secret@localhost:5432/circlechat');
  });

  it('never includes raw values in validation failure messages', () => {
    try {
      loadConfig({ PORT: 'not-a-port' });
      expect.unreachable('loadConfig should have thrown');
    } catch (err) {
      expect(err instanceof Error).toBe(true);
      expect((err as Error).message).not.toContain('not-a-port');
    }
  });
});
