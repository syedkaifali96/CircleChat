import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { config } from './config';
import { healthRoutes } from './routes/health';

/**
 * Fastify application bootstrap (M0 foundation only).
 *
 * M1+ will register domain modules here (auth, circles, messages, …) and the
 * database plugin per docs/ARCHITECTURE.md §5. Nothing product-specific exists.
 */
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      // Tests stay silent; runtime logs honor LOG_LEVEL.
      level: config.nodeEnv === 'test' ? 'silent' : config.logLevel,
      // Never log credentials or tokens (docs/SECURITY.md §11).
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie'],
        censor: '[REDACTED]',
      },
    },
  });

  await app.register(healthRoutes);

  app.setErrorHandler(async (error: FastifyError, _request, reply) => {
    const statusCode = error.statusCode ?? 500;
    if (statusCode >= 500) {
      // Full details stay server-side; clients get a generic message (docs/SECURITY.md §12).
      app.log.error({ err: error }, 'unhandled error');
    }
    await reply.code(statusCode).send({
      code: statusCode >= 500 ? 'INTERNAL_ERROR' : (error.code ?? 'REQUEST_ERROR'),
      message: statusCode >= 500 ? 'Internal server error' : error.message,
    });
  });

  app.setNotFoundHandler((request, reply) => {
    void reply
      .code(404)
      .send({ code: 'NOT_FOUND', message: `Route ${request.method} ${request.url} not found` });
  });

  return app;
}
