import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyServerOptions,
} from 'fastify';
import { config, type AppConfig } from './config';
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
      paths: ['req.headers.authorization', 'req.headers.cookie'],
      censor: '[REDACTED]',
    },
  };
}

/**
 * Fastify application bootstrap (M0 foundation only).
 *
 * M1+ will register domain modules here (auth, circles, messages, …) and the
 * database plugin per docs/ARCHITECTURE.md §5. Nothing product-specific exists.
 * `options.logger` exists purely for test instrumentation.
 */
export async function buildApp(
  options: { logger?: FastifyServerOptions['logger'] } = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? loggerOptionsFor(config.nodeEnv, config.logLevel),
  });

  await app.register(healthRoutes);

  app.setErrorHandler(async (error: FastifyError, _request, reply) => {
    const statusCode = error.statusCode ?? 500;
    if (statusCode >= 500) {
      // Full details stay server-side; clients get a generic message only.
      app.log.error({ err: error }, 'unhandled error');
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
