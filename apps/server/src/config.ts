import { z } from 'zod';

/**
 * Environment configuration foundation (M0).
 *
 * Parsed and validated with Zod at boot; invalid or missing configuration must
 * fail startup (docs/ARCHITECTURE.md §5, docs/DEPLOYMENT.md §3).
 * No secret has a default — secrets are supplied via the environment only.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  // docs/DEPLOYMENT.md §3: required in production; local dev provides it via .env.
  DATABASE_URL: z.string().min(1).optional(),
  // docs/SECURITY.md §3: 30-day sliding session lifetime.
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
});

export interface AppConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly port: number;
  readonly logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  readonly databaseUrl: string | undefined;
  readonly sessionTtlDays: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  return Object.freeze({
    nodeEnv: parsed.data.NODE_ENV,
    port: parsed.data.PORT,
    logLevel: parsed.data.LOG_LEVEL,
    databaseUrl: parsed.data.DATABASE_URL,
    sessionTtlDays: parsed.data.SESSION_TTL_DAYS,
  });
}

export const config: AppConfig = loadConfig();
