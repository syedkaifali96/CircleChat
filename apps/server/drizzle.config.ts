import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit wiring prepared in M0 but intentionally unused until M1:
 * src/db/schema.ts is empty and no migrations exist yet (docs/DATABASE.md §4).
 * DATABASE_URL always comes from the environment — never committed.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
});
