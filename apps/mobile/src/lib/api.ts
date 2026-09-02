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

/* ---------------------------------------------------- profile (M3) ------ */

export async function updateProfile(
  token: string,
  input: { displayName?: string; bio?: string | null },
): Promise<{ user: PublicUser }> {
  return apiFetch(`${API_BASE_URL}/users/me`, {
    method: 'PATCH',
    token,
    body: {
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      ...(input.bio !== undefined ? { bio: input.bio } : {}),
    },
  });
}

interface UploadIntent {
  mediaId: string;
  uploadUrl: string;
  uploadFields: Record<string, string>;
}

export async function requestAvatarUploadIntent(
  token: string,
  mimeType: string,
  sizeBytes: number,
): Promise<UploadIntent> {
  return apiFetch(`${API_BASE_URL}/media/upload-intent`, {
    method: 'POST',
    token,
    body: { kind: 'avatar', mimeType, sizeBytes },
  });
}

export async function confirmMedia(token: string, mediaId: string): Promise<{ status: string }> {
  return apiFetch(`${API_BASE_URL}/media/${mediaId}/confirm`, { method: 'POST', token });
}

export async function assignAvatar(token: string, mediaId: string): Promise<{ user: PublicUser }> {
  return apiFetch(`${API_BASE_URL}/users/me/avatar`, { method: 'POST', token, body: { mediaId } });
}

/**
 * Avatar upload flow (docs/ARCHITECTURE.md §9): intent → direct POST to
 * private storage (multipart with the presigned fields) → confirm.
 * Bytes never touch the API server.
 */
export async function uploadAndAssignAvatar(
  token: string,
  imageUri: string,
  mimeType: string,
  sizeBytes: number,
): Promise<{ user: PublicUser }> {
  const intent = await requestAvatarUploadIntent(token, mimeType, sizeBytes);
  const fileResponse = await fetch(imageUri);
  const bytes = await fileResponse.blob();
  const form = new FormData();
  for (const [key, value] of Object.entries(intent.uploadFields)) {
    form.append(key, value);
  }
  form.append('file', bytes, 'avatar');
  const uploadResponse = await fetch(intent.uploadUrl, { method: 'POST', body: form });
  if (!uploadResponse.ok) {
    throw new ApiError('UPLOAD_FAILED', uploadResponse.status, 'Upload failed. Try again.');
  }
  await confirmMedia(token, intent.mediaId);
  return assignAvatar(token, intent.mediaId);
}
