/**
 * Ambient types for `embedded-postgres` (dev/test-only dependency).
 * The package ships ESM-only type exports that TypeScript's `node`
 * moduleResolution cannot read from a CommonJS project, so we declare the
 * minimal surface the test helper uses — no `any` involved.
 */
declare module 'embedded-postgres' {
  export interface EmbeddedPostgresOptions {
    databaseDir: string;
    user: string;
    password: string;
    port: number;
    persistent: boolean;
    /** Additional initdb flags, e.g. UTF-8 encoding on Windows hosts. */
    initdbFlags?: string[];
  }

  export interface EmbeddedPostgres {
    initialise(): Promise<void>;
    start(): Promise<void>;
    createDatabase(name: string): Promise<void>;
    stop(): Promise<void>;
  }

  const EmbeddedPostgres: new (options: EmbeddedPostgresOptions) => EmbeddedPostgres;
  export default EmbeddedPostgres;
}
