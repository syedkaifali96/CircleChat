import { and, eq } from 'drizzle-orm';
import type { Database } from '../../db/client';
import { media } from '../../db/schema';
import { mimeFamilyMatches, sniffMimeType, UPLOAD_CAPS } from './validation';
import { avatarStorageKey, chatMediaStorageKey, type StorageGateway } from './storage';
import { generateThumbnail, isImageKind } from './thumbnails';

/**
 * Media lifecycle service (docs/ARCHITECTURE.md §9):
 * intent (pending row + presigned upload) → client PUT → confirm (sniff + size
 * verify → ready) → authorization-checked presigned download.
 * Media bytes never pass through this server.
 */

const PRESIGN_UPLOAD_SECONDS = 300; // 5 minutes (docs/ARCHITECTURE.md §9)
const PRESIGN_DOWNLOAD_SECONDS = 60;

export interface CreatedMediaIntent {
  mediaId: string;
  uploadUrl: string;
  uploadFields: Record<string, string>;
}

export async function createMediaIntent(
  db: Database,
  storage: StorageGateway,
  input: { ownerId: string; kind: string; mimeType: string; sizeBytes: number },
): Promise<CreatedMediaIntent> {
  const key = avatarStorageKey();
  const rows = await db
    .insert(media)
    .values({
      ownerId: input.ownerId,
      kind: input.kind,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      storageKey: key,
      status: 'pending',
    })
    .returning({ id: media.id });
  const mediaId = rows[0]!.id;
  const presigned = await storage.createUploadIntent(
    key,
    input.mimeType,
    input.sizeBytes,
    PRESIGN_UPLOAD_SECONDS,
  );
  // The storage key stays server-side (docs/SECURITY.md §7): clients get the
  // presigned POST target, never the bucket path.
  return { mediaId, ...presigned };
}

export async function getMediaById(db: Database, mediaId: string) {
  const rows = await db.select().from(media).where(eq(media.id, mediaId)).limit(1);
  return rows[0];
}

/**
 * Confirm: the client has PUT the bytes. The server HEADs the object, re-checks
 * the size, sniffs magic bytes against the pinned MIME type, then marks the row
 * ready. Anything suspicious deletes the pending row.
 *
 * M7.1: chat images get a best-effort 400px JPEG thumbnail on confirm.
 * Thumbnail failure is logged and ignored — the message still becomes visible
 * with the original image as fallback (docs/ARCHITECTURE.md §9).
 */
export async function confirmMedia(
  db: Database,
  storage: StorageGateway,
  input: { mediaId: string; ownerId: string; log?: { warn: (obj: unknown, msg: string) => void } },
): Promise<'ready' | 'rejected'> {
  const row = await getMediaById(db, input.mediaId);
  if (!row || row.ownerId !== input.ownerId || row.status !== 'pending') {
    return 'rejected';
  }
  const head = await storage.headObject(row.storageKey);
  if (!head || head.sizeBytes !== row.sizeBytes) {
    await db.delete(media).where(eq(media.id, row.id));
    return 'rejected';
  }
  const prefix = await storage.readObjectBytes(row.storageKey, 32);
  if (!prefix) {
    await db.delete(media).where(eq(media.id, row.id));
    return 'rejected';
  }
  const sniffed = sniffMimeType(prefix);
  if (!sniffed || !mimeFamilyMatches(row.mimeType, sniffed)) {
    await db.delete(media).where(eq(media.id, row.id));
    return 'rejected';
  }
  await db.update(media).set({ status: 'ready' }).where(eq(media.id, row.id));

  if (isImageKind(row.kind)) {
    try {
      const bytes = await storage.getObject(row.storageKey);
      if (!bytes) {
        throw new Error('object unreadable');
      }
      const thumbnail = await generateThumbnail(bytes);
      const thumbnailKey = `${row.storageKey}-thumb`;
      await storage.putObject(thumbnailKey, 'image/jpeg', thumbnail);
      await db
        .update(media)
        .set({ thumbnailKey })
        .where(eq(media.id, row.id));
    } catch (err) {
      input.log?.warn({ err, mediaId: row.id }, 'thumbnail generation failed; falling back to original');
    }
  }
  return 'ready';
}

/**
 * Presigned download URL for media the requester may view. Authorization is
 * caller-specific (profile avatar viewer rules / conversation membership) and
 * is enforced BEFORE calling this; this only issues the short-TTL URL for a
 * READY media object.
 */
export async function issueMediaDownloadUrl(
  db: Database,
  storage: StorageGateway,
  input: { mediaId: string },
): Promise<string | undefined> {
  const row = await getMediaById(db, input.mediaId);
  if (!row || row.status !== 'ready') {
    return undefined;
  }
  return storage.createDownloadUrl(row.storageKey, PRESIGN_DOWNLOAD_SECONDS);
}

export async function findReadyAvatarById(db: Database, mediaId: string) {
  const rows = await db
    .select()
    .from(media)
    .where(and(eq(media.id, mediaId), eq(media.kind, 'avatar'), eq(media.status, 'ready')))
    .limit(1);
  return rows[0];
}

/**
 * Chat-media intent (M7): creates the pending row bound to the conversation
 * and returns the presigned POST. Authorization (sender of this conversation)
 * is enforced by the caller BEFORE this runs. The declared kind/MIME/size
 * were validated against the per-kind caps by the shared schema.
 */
export async function createChatMediaIntent(
  db: Database,
  storage: StorageGateway,
  input: {
    ownerId: string;
    conversationId: string;
    kind: string;
    mimeType: string;
    sizeBytes: number;
    durationMs?: number;
  },
): Promise<CreatedMediaIntent> {
  const key = chatMediaStorageKey(input.kind);
  const rows = await db
    .insert(media)
    .values({
      ownerId: input.ownerId,
      conversationId: input.conversationId,
      kind: input.kind,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      storageKey: key,
      status: 'pending',
      durationMs: input.durationMs ?? null,
    })
    .returning({ id: media.id });
  const mediaId = rows[0]!.id;
  const presigned = await storage.createUploadIntent(
    key,
    input.mimeType,
    UPLOAD_CAPS[input.kind] ?? input.sizeBytes,
    PRESIGN_UPLOAD_SECONDS,
  );
  // Same rule as createMediaIntent: the storage key never leaves the server.
  return { mediaId, ...presigned };
}

/**
 * Conversation-scoped media access (docs/API.md "Media authorization",
 * docs/DATABASE.md §1.9): the requester must be an authorized member of the
 * conversation the media belongs to — `circle_members` for circle media,
 * `conversation_participants` for direct media — or the media's owner.
 * Returns the media row (READY only) when access is granted.
 */
export async function getAccessibleChatMedia(
  db: Database,
  input: {
    mediaId: string;
    requesterId: string;
    canAccessConversation: (conversationId: string, userId: string) => Promise<boolean>;
  },
) {
  const rows = await db.select().from(media).where(eq(media.id, input.mediaId)).limit(1);
  const row = rows[0];
  if (!row || row.status !== 'ready' || !row.conversationId) {
    return undefined;
  }
  if (row.ownerId === input.requesterId) {
    return row;
  }
  const allowed = await input.canAccessConversation(row.conversationId, input.requesterId);
  return allowed ? row : undefined;
}

/**
 * Caller-specific authorization for viewing an avatar media object
 * (docs/API.md "Avatar access", docs/SECURITY.md §7).
 *
 * The M3 profile-visibility rule: the requester may view an avatar only when
 * they are the avatar owner themself, or they share at least one active
 * Circle with the avatar owner (the same rule as the minimal profile).
 * Knowing the media UUID alone never grants access. `sharesActiveCircle`
 * is injected to keep this module free of profile-module imports.
 */
export async function canViewAvatarMedia(
  db: Database,
  input: {
    mediaId: string;
    requesterId: string;
    sharesActiveCircle: (userA: string, userB: string) => Promise<boolean>;
  },
): Promise<boolean> {
  const row = await findReadyAvatarById(db, input.mediaId);
  if (!row) {
    return false;
  }
  if (row.ownerId === input.requesterId) {
    return true;
  }
  return input.sharesActiveCircle(input.requesterId, row.ownerId);
}
