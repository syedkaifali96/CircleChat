/**
 * Database barrel: schema (tables), relations, and the Drizzle client.
 * Import from '@circlechat/server' db surface via this index — the runtime
 * schema object in client.ts includes BOTH tables and relations.
 */
export * from './client';
export * from './relations';
export * from './schema';
