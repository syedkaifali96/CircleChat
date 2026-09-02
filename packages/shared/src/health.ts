/**
 * Minimal scaffold-level shared helper proving the package resolves from both
 * workspaces. M1+ will add product schemas (auth, circles, messages) here per
 * docs/DATABASE.md — intentionally nothing product-specific exists in M0.
 */

export const SERVICE_NAME = 'circlechat';

export type Environment = 'development' | 'test' | 'production';

export interface HealthStatusPayload {
  service: string;
  status: 'ok';
  environment: Environment;
  timestamp: string;
}

export function buildHealthStatus(environment: Environment): HealthStatusPayload {
  return {
    service: SERVICE_NAME,
    status: 'ok',
    environment,
    timestamp: new Date().toISOString(),
  };
}
