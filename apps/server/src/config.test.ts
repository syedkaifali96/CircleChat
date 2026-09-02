import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

describe('loadConfig', () => {
  it('applies documented defaults when the environment is empty', () => {
    const cfg = loadConfig({});

    expect(cfg.nodeEnv).toBe('development');
    expect(cfg.port).toBe(3000);
    expect(cfg.logLevel).toBe('info');
  });

  it('accepts explicit valid values', () => {
    const cfg = loadConfig({ NODE_ENV: 'production', PORT: '8080', LOG_LEVEL: 'warn' });

    expect(cfg.nodeEnv).toBe('production');
    expect(cfg.port).toBe(8080);
    expect(cfg.logLevel).toBe('warn');
  });

  it('fails closed on invalid values (startup must not continue with bad config)', () => {
    expect(() => loadConfig({ PORT: 'not-a-port' })).toThrow(
      /Invalid environment configuration/,
    );
    expect(() => loadConfig({ NODE_ENV: 'staging' })).toThrow(/Invalid environment configuration/);
  });
});
