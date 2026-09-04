import type { PublicUser } from '@circlechat/shared';
import { loadSessionToken } from '../auth/session';

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
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
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

/* ---------------------------------------------------- circles (M4) ------ */

export type CircleRole = 'owner' | 'admin' | 'member';

export interface CircleListItem {
  id: string;
  name: string;
  description: string | null;
  avatarMediaId: string | null;
  membersCount: number;
  callerRole: CircleRole;
  unreadCount: number;
}

export interface CircleMember {
  userId: string;
  username: string;
  displayName: string;
  role: CircleRole;
  joinedAt: string;
}

export interface CircleSummary {
  id: string;
  name: string;
  description: string | null;
  avatarMediaId: string | null;
  membersCount: number;
  callerRole: CircleRole;
  createdAt: string;
  members: CircleMember[];
}

export interface InvitePreview {
  name: string;
  memberCount: number;
  avatarMediaId: string | null;
  avatarUrl: string | null;
}

export interface CircleSettings {
  themePreset: string;
  accentColor: string | null;
  backgroundKey: string | null;
}

export async function listCircles(token: string): Promise<{ circles: CircleListItem[] }> {
  return apiFetch(`${API_BASE_URL}/circles`, { method: 'GET', token });
}

export async function createCircle(
  token: string,
  input: { name: string; description?: string | null },
): Promise<{ circle: { id: string; name: string; membersCount: number; callerRole: CircleRole } }> {
  return apiFetch(`${API_BASE_URL}/circles`, {
    method: 'POST',
    token,
    body: {
      name: input.name,
      ...(input.description !== undefined ? { description: input.description } : {}),
    },
  });
}

export async function fetchCircle(token: string, circleId: string): Promise<{ circle: CircleSummary }> {
  return apiFetch(`${API_BASE_URL}/circles/${circleId}`, { method: 'GET', token });
}

export async function updateCircle(
  token: string,
  circleId: string,
  input: { name?: string; description?: string | null },
): Promise<{ circle: { id: string; name: string; description: string | null; callerRole: CircleRole } }> {
  return apiFetch(`${API_BASE_URL}/circles/${circleId}`, {
    method: 'PATCH',
    token,
    body: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
    },
  });
}

export async function deleteCircle(token: string, circleId: string): Promise<{ ok: boolean }> {
  return apiFetch(`${API_BASE_URL}/circles/${circleId}`, { method: 'DELETE', token });
}

/** Raw invite code is shown exactly once; the server stores only its hash. */
export async function createInvite(
  token: string,
  circleId: string,
  expiresInDays = 7,
): Promise<{ inviteCode: string }> {
  return apiFetch(`${API_BASE_URL}/circles/${circleId}/invite`, {
    method: 'POST',
    token,
    body: { expiresInDays },
  });
}

export async function revokeInvite(token: string, circleId: string): Promise<{ ok: boolean }> {
  return apiFetch(`${API_BASE_URL}/circles/${circleId}/invite`, { method: 'DELETE', token });
}

/** Public pre-join preview — no token; limited fields only (docs/API.md). */
export async function fetchInvitePreview(code: string): Promise<{ preview: InvitePreview }> {
  return apiFetch(`${API_BASE_URL}/circles/invite-preview?code=${encodeURIComponent(code)}`, {
    method: 'GET',
  });
}

export async function joinCircle(token: string, inviteCode: string): Promise<{ circleId: string }> {
  return apiFetch(`${API_BASE_URL}/circles/join`, {
    method: 'POST',
    token,
    body: { inviteCode },
  });
}

export async function leaveCircle(token: string, circleId: string): Promise<{ ok: boolean }> {
  return apiFetch(`${API_BASE_URL}/circles/${circleId}/members/me`, { method: 'DELETE', token });
}

export async function removeMember(
  token: string,
  circleId: string,
  userId: string,
): Promise<{ ok: boolean }> {
  return apiFetch(`${API_BASE_URL}/circles/${circleId}/members/${userId}`, {
    method: 'DELETE',
    token,
  });
}

export async function updateMemberRole(
  token: string,
  circleId: string,
  userId: string,
  role: 'admin' | 'member',
): Promise<{ ok: boolean }> {
  return apiFetch(`${API_BASE_URL}/circles/${circleId}/members/${userId}`, {
    method: 'PATCH',
    token,
    body: { role },
  });
}

export async function transferOwnership(
  token: string,
  circleId: string,
  newOwnerUserId: string,
): Promise<{ ok: boolean }> {
  return apiFetch(`${API_BASE_URL}/circles/${circleId}/ownership-transfer`, {
    method: 'POST',
    token,
    body: { newOwnerUserId },
  });
}

export async function fetchCircleSettings(
  token: string,
  circleId: string,
): Promise<{ settings: CircleSettings }> {
  return apiFetch(`${API_BASE_URL}/circles/${circleId}/settings`, { method: 'GET', token });
}

export async function updateCircleSettings(
  token: string,
  circleId: string,
  patch: { themePreset?: string; accentColor?: string | null; backgroundKey?: string | null },
): Promise<{ settings: CircleSettings }> {
  return apiFetch(`${API_BASE_URL}/circles/${circleId}/settings`, {
    method: 'PATCH',
    token,
    body: {
      ...(patch.themePreset !== undefined ? { themePreset: patch.themePreset } : {}),
      ...(patch.accentColor !== undefined ? { accentColor: patch.accentColor } : {}),
      ...(patch.backgroundKey !== undefined ? { backgroundKey: patch.backgroundKey } : {}),
    },
  });
}

/* ------------------------------------------ messaging (M5, text-only) ---- */

export interface ConversationListItem {
  id: string;
  type: 'circle' | 'direct';
  circleId: string | null;
  circleName: string | null;
  circleAvatarMediaId: string | null;
  partnerUsername: string | null;
  partnerDisplayName: string | null;
  partnerAvatarMediaId: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unreadCount: number;
}

export interface MessageReaction {
  emoji: string;
  userId: string;
  username: string;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  senderUsername: string;
  senderDisplayName: string;
  type: 'text' | 'image' | 'video' | 'voice' | 'file';
  body: string | null;
  mediaId: string | null;
  /** M7: metadata from the media row (mime, dimensions, duration). */
  media: MediaInfo | null;
  replyToId: string | null;
  replyPreview: { id: string; senderUsername: string; body: string | null; deleted: boolean } | null;
  editedAt: string | null;
  deleted: boolean;
  createdAt: string;
  reactions: MessageReaction[];
}

export interface ChatHeader {
  type: 'circle' | 'direct';
  title: string;
  avatarMediaId: string | null;
  subtitle: string;
  circleRole: string | null;
}

export async function listConversations(token: string): Promise<{ conversations: ConversationListItem[] }> {
  return apiFetch(`${API_BASE_URL}/conversations`, { method: 'GET', token });
}

export async function createDirectConversation(
  token: string,
  username: string,
): Promise<{ conversationId: string; created: boolean }> {
  return apiFetch(`${API_BASE_URL}/conversations/direct`, {
    method: 'POST',
    token,
    body: { username },
  });
}

export async function fetchChatHeader(token: string, conversationId: string): Promise<{ header: ChatHeader }> {
  return apiFetch(`${API_BASE_URL}/conversations/${conversationId}/header`, { method: 'GET', token });
}

export async function fetchMessages(
  token: string,
  conversationId: string,
  options: { before?: string; limit?: number } = {},
): Promise<{ messages: Message[]; nextBeforeCursor: string | null }> {
  const params = new URLSearchParams();
  if (options.before) {
    params.set('before', options.before);
  }
  if (options.limit) {
    params.set('limit', String(options.limit));
  }
  const qs = params.toString();
  return apiFetch(`${API_BASE_URL}/conversations/${conversationId}/messages${qs ? `?${qs}` : ''}`, {
    method: 'GET',
    token,
  });
}

export async function sendMessage(
  token: string,
  conversationId: string,
  input: {
    type?: 'text' | 'image' | 'video' | 'voice' | 'file' | 'gif';
    body?: string;
    mediaId?: string;
    externalUrl?: string;
    replyToId?: string;
    clientMessageId: string;
  },
): Promise<{ message: Message; created: boolean }> {
  return apiFetch(`${API_BASE_URL}/conversations/${conversationId}/messages`, {
    method: 'POST',
    token,
    body: {
      type: input.type ?? 'text',
      ...(input.body !== undefined ? { body: input.body } : {}),
      ...(input.mediaId !== undefined ? { mediaId: input.mediaId } : {}),
      ...(input.externalUrl !== undefined ? { externalUrl: input.externalUrl } : {}),
      ...(input.replyToId ? { replyToId: input.replyToId } : {}),
      clientMessageId: input.clientMessageId,
    },
  });
}

export async function editMessage(token: string, messageId: string, body: string): Promise<{ message: Message }> {
  return apiFetch(`${API_BASE_URL}/messages/${messageId}`, { method: 'PATCH', token, body: { body } });
}

export async function deleteMessage(token: string, messageId: string): Promise<{ message: Message }> {
  return apiFetch(`${API_BASE_URL}/messages/${messageId}`, { method: 'DELETE', token });
}

export async function addReaction(token: string, messageId: string, emoji: string): Promise<{ message: Message }> {
  return apiFetch(`${API_BASE_URL}/messages/${messageId}/reactions`, {
    method: 'PUT',
    token,
    body: { emoji },
  });
}

export async function removeReaction(token: string, messageId: string, emoji: string): Promise<{ message: Message }> {
  return apiFetch(
    `${API_BASE_URL}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`,
    { method: 'DELETE', token },
  );
}

export async function markConversationRead(
  token: string,
  conversationId: string,
  lastReadMessageId: string,
): Promise<{ unreadCount: number; lastReadMessageId: string | null }> {
  return apiFetch(`${API_BASE_URL}/conversations/${conversationId}/read`, {
    method: 'POST',
    token,
    body: { lastReadMessageId },
  });
}

export async function updateNotificationPref(
  token: string,
  conversationId: string,
  patch: { enabled?: boolean; muted?: boolean; mentions?: boolean; preview?: boolean },
): Promise<{ pref: { enabled: boolean; muted: boolean; mentions: boolean; preview: boolean } }> {
  return apiFetch(`${API_BASE_URL}/conversations/${conversationId}/notification-pref`, {
    method: 'PATCH',
    token,
    body: {
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.muted !== undefined ? { muted: patch.muted } : {}),
      ...(patch.mentions !== undefined ? { mentions: patch.mentions } : {}),
      ...(patch.preview !== undefined ? { preview: patch.preview } : {}),
    },
  });
}

/* ------------------------------------------- media messaging (M7) -------- */

export type ChatMediaKind = 'image' | 'video' | 'voice' | 'file';

export interface MediaInfo {
  kind: string;
  mimeType: string;
  sizeBytes: number;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  /** M7.1: external GIFs render directly from the provider URL. */
  externalUrl: string | null;
  /** M7.1: true when a 400px thumbnail exists for this image. */
  hasThumbnail: boolean | null;
}

export interface MediaUploadIntent {
  mediaId: string;
  uploadUrl: string;
  uploadFields: Record<string, string>;
}

/**
 * Presigned upload URL for a chat attachment. The server validates kind,
 * MIME, size and voice duration against the per-kind caps BEFORE issuing
 * anything — and only for members of this conversation.
 */
export async function requestChatMediaUploadUrl(
  token: string,
  conversationId: string,
  input: { kind: ChatMediaKind; mimeType: string; sizeBytes: number; durationMs?: number },
): Promise<MediaUploadIntent> {
  return apiFetch(`${API_BASE_URL}/conversations/${conversationId}/media/upload-url`, {
    method: 'POST',
    token,
    body: input,
  });
}

/** Direct PUT of the bytes to private storage (never through the API server). */
export async function uploadBytesToStorage(
  intent: MediaUploadIntent,
  bytes: Blob,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  const form = new FormData();
  for (const [key, value] of Object.entries(intent.uploadFields)) {
    form.append(key, value);
  }
  form.append('file', bytes);
  // fetch has no upload progress; report coarse stages around the transfer.
  onProgress?.(0.1);
  const response = await fetch(intent.uploadUrl, { method: 'POST', body: form });
  if (!response.ok) {
    throw new ApiError('UPLOAD_FAILED', response.status, 'Upload failed. Try again.');
  }
  onProgress?.(1);
}

export async function confirmMediaUpload(token: string, mediaId: string): Promise<{ status: string }> {
  return apiFetch(`${API_BASE_URL}/media/${mediaId}/confirm`, { method: 'POST', token });
}

/** Short-TTL presigned download URL, issued only after the D1 access check.
 * variant='thumb' serves the 400px thumbnail when one exists (M7.1). */
export async function fetchMediaDownloadUrl(
  mediaId: string,
  options: { variant?: 'thumb' } = {},
): Promise<string> {
  const token = (await loadSessionToken()) ?? '';
  const qs = options.variant ? `?variant=${options.variant}` : '';
  const res = await apiFetch<{ url: string }>(`${API_BASE_URL}/media/${mediaId}/url${qs}`, {
    method: 'GET',
    token,
  });
  return res.url;
}
