import { Client } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import * as schema from './schema';

/**
 * Infrastructure-only helpers for PostgreSQL integration tests (M1).
 * - Uses TEST_DATABASE_URL or DATABASE_URL (the CI service container).
 * - Safety guard: refuses non-local databases unless ALLOW_REMOTE_TEST_DB=1.
 * - With no URL configured, starts an ephemeral embedded PostgreSQL so the
 *   suite runs hermetically on developer machines (no Docker required).
 * - Applies the real committed Drizzle migrations, then truncates all tables
 *   between tests for a clean state.
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export function resolveTestDatabaseUrl(): string | undefined {
  const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    return undefined;
  }
  const parsed = new URL(url);
  if (!LOCAL_HOSTS.has(parsed.hostname) && process.env.ALLOW_REMOTE_TEST_DB !== '1') {
    throw new Error(
      `Refusing to run database integration tests against non-local host "${parsed.hostname}". ` +
        'Point TEST_DATABASE_URL at a local PostgreSQL or set ALLOW_REMOTE_TEST_DB=1 explicitly.',
    );
  }
  return url;
}

import EmbeddedPostgres from 'embedded-postgres';

export async function startEmbeddedPostgres(): Promise<{
  url: string;
  stop: () => Promise<void>;
}> {
  const port = 30000 + Math.floor(Math.random() * 20000);
  const pg = new EmbeddedPostgres({
    databaseDir: `circlechat-pg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: false,
    // Windows hosts default to a WIN1252 server encoding; force UTF-8 so the
    // cluster matches CI (postgres:16) and can store the documented emoji set.
    initdbFlags: ['--encoding=UTF8', '--no-locale'],
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('circlechat_test');
  return {
    url: `postgres://postgres:postgres@127.0.0.1:${port}/circlechat_test`,
    stop: () => pg.stop(),
  };
}

/** Applies the committed Drizzle migrations to the test database. */
export async function migrateTestDatabase(client: Client): Promise<void> {
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: 'drizzle' });
}

/** Clean state between tests: wipe every product table. */
export async function resetTestDatabase(client: Client): Promise<void> {
  await client.query(`
    TRUNCATE TABLE
      conversation_notification_prefs,
      notifications,
      poll_votes,
      polls,
      pinboard_items,
      message_reactions,
      messages,
      media,
      conversation_participants,
      conversations,
      circle_settings,
      circle_members,
      circles,
      sessions,
      users
    CASCADE
  `);
}

export { schema };
