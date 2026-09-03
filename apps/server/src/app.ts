import Fastify, { type FastifyError, type FastifyInstance, type FastifyServerOptions } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import type { Database } from './db/client';
import { AppError } from './errors';
import { config, type AppConfig } from './config';
import { registerAuthPlugin } from './plugins/auth';
import { authRoutes } from './modules/auth/routes';
import { usersRoutes } from './modules/users/routes';
import { circleRoutes } from './modules/circles/routes';
import { conversationRoutes } from './modules/conversations/routes';
import { messageRoutes } from './modules/messages/routes';
import { profileRoutes } from './modules/profile/routes';
import { sharesActiveCircle } from './modules/profile/service';
import { mediaRoutes } from './modules/media/routes';
import { R2StorageGateway, readR2StorageConfig, type StorageGateway } from './modules/media/storage';
import { healthRoutes } from './routes/health';

/** Client-facing error body: stable machine code + generic human message. */
export interface ClientErrorBody {
  readonly code: string;
  readonly message: string;
}

/**
 * Status → generic client-facing messages (docs/SECURITY.md §12).
 * Internal error messages, stack traces and Fastify internals never reach the
 * client; full details stay in server-side logs for 5xx only.
 */
const STATUS_TO_CODE: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'VALIDATION_FAILED',
  429: 'RATE_LIMITED',
};

const STATUS_TO_MESSAGE: Record<number, string> = {
  400: 'Bad request.',
  401: 'Authentication required.',
  403: 'You do not have access to this resource.',
  404: 'Resource not found.',
  405: 'Method not allowed.',
  409: 'Conflict.',
  413: 'Payload too large.',
  415: 'Unsupported media type.',
  422: 'Validation failed.',
  429: 'Too many requests. Try again later.',
};

export function buildClientErrorBody(statusCode: number): ClientErrorBody {
  if (statusCode >= 500) {
    return { code: 'INTERNAL_ERROR', message: 'Internal server error. Try again later.' };
  }
  return {
    code: STATUS_TO_CODE[statusCode] ?? 'REQUEST_ERROR',
    message: STATUS_TO_MESSAGE[statusCode] ?? 'Request failed.',
  };
}

/** Concrete logger options shape (testable; assignable to Fastify's logger option). */
export interface LoggerOptions {
  level: AppConfig['logLevel'] | 'silent';
  redact: { paths: string[]; censor: string };
}

/**
 * Runtime logger options: tests stay silent; runtime honors LOG_LEVEL.
 * Credentials and tokens are redacted from every log line (docs/SECURITY.md §11).
 */
export function loggerOptionsFor(
  nodeEnv: AppConfig['nodeEnv'],
  logLevel: AppConfig['logLevel'],
): LoggerOptions {
  return {
    level: nodeEnv === 'test' ? 'silent' : logLevel,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.body.password',
        'req.body.newPassword',
        'req.body.currentPassword',
        'req.body.recoveryCode',
        'req.headers.recoveryCode',
      ],
      censor: '[REDACTED]',
    },
  };
}

/**
 * Fastify application bootstrap.
 *
 * M2: registers the authentication module (signup, login, change-password,
 * recovery-reset, logout, sessions) plus /users/me and username availability,
 * the requireAuth preHandler and optional rate limiting. `db` is optional only
 * so bootstrap unit tests can run without a database; the real entrypoint
 * always provides it (docs/ARCHITECTURE.md §5).
 * `options.logger` exists purely for test instrumentation.
 */
export async function buildApp(
  options: {
    logger?: FastifyServerOptions['logger'];
    db?: Database;
    rateLimit?: boolean;
    storage?: StorageGateway;
    /** M5: change-notification publisher (wired to Socket.IO in index/tests). */
    publish?: (event: string, payload: unknown) => void;
  } = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? loggerOptionsFor(config.nodeEnv, config.logLevel),
  });

  if (options.rateLimit === true) {
    await app.register(rateLimit, {
      global: true,
      max: 120,
      timeWindow: '1 minute',
    });
  }

  await app.register(healthRoutes);
  if (options.db) {
    const db = options.db;
    app.decorate('db', db);
    registerAuthPlugin(app, config.sessionTtlDays);
    await app.register(authRoutes, { db, ttlDays: config.sessionTtlDays });
    await app.register(usersRoutes, { db });
    // Private storage: R2 when configured, in-memory only for tests.
    const storage = options.storage ?? (readR2StorageConfig() ? new R2StorageGateway(readR2StorageConfig()!) : undefined);
    // Circles never touch object storage directly; storage is optional and only
    // used for invite-preview avatar URLs.
    await app.register(circleRoutes, { db, storage });
    // Messaging (M5): REST writes are the source of truth; `publish` fans out
    // change notifications when a Socket.IO server is attached.
    const publish = options.publish ?? (() => undefined);
    await app.register(conversationRoutes, { db, publish });
    await app.register(messageRoutes, { db, publish });
    if (storage) {
      await app.register(profileRoutes, { db, storage });
      await app.register(mediaRoutes, {
        db,
        storage,
        sharesActiveCircle: (userA: string, userB: string) => sharesActiveCircle(db, userA, userB),
      });
    }
  }

  app.setErrorHandler(async (error: FastifyError, _request, reply) => {
    const statusCode = error.statusCode ?? 500;
    if (statusCode >= 500) {
      // Full details stay server-side; clients get a generic message only.
      app.log.error({ err: error }, 'unhandled error');
    }
    if (error instanceof AppError) {
      // App-authored code + safe message (docs/SECURITY.md §12).
      await reply.code(error.statusCode).send({ code: error.code, message: error.message });
      return;
    }
    if (statusCode === 429) {
      await reply.code(429).send(buildClientErrorBody(429));
      return;
    }
    await reply.code(statusCode).send(buildClientErrorBody(statusCode));
  });

  app.setNotFoundHandler((request, reply) => {
    void reply
      .code(404)
      .send({ code: 'NOT_FOUND', message: `Route ${request.method} ${request.url} not found` });
  });

  return app;
}
