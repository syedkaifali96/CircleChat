import { drizzle, type NodePgClient, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as relations from './relations';
import * as tables from './schema';

/**
 * Complete runtime Drizzle schema object: tables AND relations.
 * Relations must be present here for the relational query API
 * (db.query.*) to work — a relations file alone is not enough.
 */
export const schema = { ...tables, ...relations };

export type Database = NodePgDatabase<typeof schema> & { $client: NodePgClient };

/**
 * PostgreSQL connection foundation (M1). Intentionally NOT wired into the
 * Fastify app yet — M2 (Authentication) introduces the request-scoped usage
 * and the health database ping per docs/DEPLOYMENT.md §5.
 * Credentials always come from the environment (DATABASE_URL); never committed.
 */
export function createDatabase(connectionString: string): Database {
  return drizzle(connectionString, { schema });
}
