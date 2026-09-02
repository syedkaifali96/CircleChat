import { describe, expect, it } from 'vitest';
import { SERVICE_NAME, buildHealthStatus } from './health';

describe('buildHealthStatus', () => {
  it('returns an ok payload carrying the service name and environment', () => {
    const payload = buildHealthStatus('test');

    expect(payload.status).toBe('ok');
    expect(payload.service).toBe(SERVICE_NAME);
    expect(payload.environment).toBe('test');
    expect(typeof payload.timestamp).toBe('string');
    expect(Number.isNaN(Date.parse(payload.timestamp))).toBe(false);
  });

  it('exposes exactly the documented fields (nothing extra that could leak state)', () => {
    expect(Object.keys(buildHealthStatus('test')).sort()).toEqual([
      'environment',
      'service',
      'status',
      'timestamp',
    ]);
  });
});
