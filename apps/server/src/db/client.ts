import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;

/**
 * PostgreSQL connection foundation (M1). Intentionally NOT wired into the
 * Fastify app yet — M2 (Authentication) introduces the request-scoped usage
 * and the health database ping per docs/DEPLOYMENT.md §5.
 * Credentials always come from the environment (DATABASE_URL); never committed.
 */
export function createDatabase(connectionString: string): Database {
  return drizzle(connectionString, { schema });
}
