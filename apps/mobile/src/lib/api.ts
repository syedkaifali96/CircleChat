import type { PublicUser } from '@circlechat/shared';

/**
 * Minimal typed API client for authentication (M2).
 * `EXPO_PUBLIC_API_URL` is the per-build server base URL (docs/DEPLOYMENT.md §3);
 * the app never embeds secrets — only this public endpoint address.
 * Errors surface as ApiError with the server's stable machine code and a safe
 * human message; network failures map to a generic code.
 */

const API_BASE_URL = `${process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000'}/v1`;

export class ApiError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, statusCode: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  token?: string;
}

export async function apiFetch<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  if (options.token) {
    headers.authorization = `Bearer ${options.token}`;
  }
  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiError('NETWORK_ERROR', 0, 'Cannot reach the server. Check your connection.');
  }
  const payload = (await response.json().catch(() => null)) as
    | (Record<string, unknown> & { code?: string; message?: string })
    | null;
  if (!response.ok) {
    throw new ApiError(
      payload?.code ?? 'REQUEST_ERROR',
      response.status,
      payload?.message ?? 'Request failed.',
    );
  }
  return payload as T;
}

export async function login(username: string, password: string): Promise<{ token: string; user: PublicUser }> {
  return apiFetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    body: { username, password, platform: 'android', deviceName: 'CircleChat device' },
  });
}

export async function signup(
  username: string,
  displayName: string,
  password: string,
): Promise<{ token: string; recoveryCode: string; user: PublicUser }> {
  return apiFetch(`${API_BASE_URL}/auth/signup`, {
    method: 'POST',
    body: { username, displayName, password, platform: 'android', deviceName: 'CircleChat device' },
  });
}

export async function fetchCurrentUser(token: string): Promise<{ user: PublicUser }> {
  return apiFetch(`${API_BASE_URL}/users/me`, { method: 'GET', token });
}

export async function logout(token: string): Promise<void> {
  await apiFetch(`${API_BASE_URL}/auth/logout`, { method: 'POST', token });
}
