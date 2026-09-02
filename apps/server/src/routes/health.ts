import type { FastifyInstance } from 'fastify';
import { buildHealthStatus } from '@circlechat/shared';
import { config } from '../config';

/**
 * M0: process-level health only — unauthenticated, no external dependencies.
 * M1 adds the database ping per docs/DEPLOYMENT.md §5.
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => buildHealthStatus(config.nodeEnv));
}
