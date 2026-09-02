import type { FastifyInstance } from 'fastify';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp, buildClientErrorBody, loggerOptionsFor } from './app';

const INTERNAL_DETAIL = 'internal-detail-do-not-leak';

describe('M0 server scaffold', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    // Test-only routes that simulate errors; no product endpoints exist in M0.
    app.get('/test/forbidden', async () => {
      throw Object.assign(new Error(INTERNAL_DETAIL), { statusCode: 403 });
    });
    app.get('/test/crash', async () => {
      throw new Error(INTERNAL_DETAIL);
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health returns ok without authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body['status']).toBe('ok');
    expect(body['service']).toBe('circlechat');
    expect(body['environment']).toBe('test');
    expect(typeof body['timestamp']).toBe('string');
  });

  it('GET /health leaks no configuration, secrets or stack details', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.headers['content-type']).toContain('application/json');
    const raw = res.body;
    expect(raw).not.toContain('postgres://');
    expect(raw).not.toContain('DATABASE_URL');
    expect(raw).not.toContain('at '); // no stack frames
    expect(Object.keys(res.json()).sort()).toEqual([
      'environment',
      'service',
      'status',
      'timestamp',
    ]);
  });

  it('4xx errors return a stable code and generic message, never the internal error message', async () => {
    const res = await app.inject({ method: 'GET', url: '/test/forbidden' });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual(buildClientErrorBody(403));
    expect(res.json().code).toBe('FORBIDDEN');
    expect(res.json().message).toBe('You do not have access to this resource.');
    expect(res.body).not.toContain(INTERNAL_DETAIL);
  });

  it('5xx errors return INTERNAL_ERROR with a generic message and no internal details', async () => {
    const res = await app.inject({ method: 'GET', url: '/test/crash' });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ code: 'INTERNAL_ERROR', message: 'Internal server error. Try again later.' });
    expect(res.body).not.toContain(INTERNAL_DETAIL);
    expect(res.body).not.toContain('at '); // no stack traces
  });

  it('unknown routes return a structured 404 without stack traces', async () => {
    const res = await app.inject({ method: 'GET', url: '/does-not-exist' });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: 'NOT_FOUND' });
    expect(String(res.json().message)).toContain('/does-not-exist');
    expect(res.body).not.toContain('at ');
  });

  it('request logs never contain authorization or cookie secrets', async () => {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(String(chunk));
        callback();
      },
    });
    const logApp = await buildApp({
      logger: { ...loggerOptionsFor('production', 'info'), stream },
    });
    try {
      const res = await logApp.inject({
        method: 'GET',
        url: '/health',
        headers: {
          authorization: 'Bearer sekrit-token-leak-check',
          cookie: 'session=sekrit-cookie-leak-check',
        },
      });
      expect(res.statusCode).toBe(200);
      const output = chunks.join('');
      expect(output.length).toBeGreaterThan(0);
      // Default Fastify serializers omit headers entirely, and loggerOptionsFor
      // additionally redacts req.headers.authorization / cookie if ever present.
      expect(output).not.toContain('sekrit-token-leak-check');
      expect(output).not.toContain('sekrit-cookie-leak-check');
      expect(output).not.toContain('authorization');
    } finally {
      await logApp.close();
    }
  });

  it('logger options always redact credentials', () => {
    for (const nodeEnv of ['development', 'test', 'production'] as const) {
      const options = loggerOptionsFor(nodeEnv, 'info');
      expect(options.redact.paths).toContain('req.headers.authorization');
      expect(options.redact.paths).toContain('req.headers.cookie');
      expect(options.redact.censor).toBe('[REDACTED]');
    }
    expect(loggerOptionsFor('test', 'info').level).toBe('silent');
    expect(loggerOptionsFor('production', 'warn').level).toBe('warn');
  });
});
