import { and, eq } from 'drizzle-orm';
import type { Database } from '../../db/client';
import { media } from '../../db/schema';
import { mimeFamilyMatches, sniffMimeType } from './validation';
import { avatarStorageKey, type StorageGateway } from './storage';

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
  key: string;
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
  return { mediaId, key, ...presigned };
}

export async function getMediaById(db: Database, mediaId: string) {
  const rows = await db.select().from(media).where(eq(media.id, mediaId)).limit(1);
  return rows[0];
}

/**
 * Confirm: the client has PUT the bytes. The server HEADs the object, re-checks
 * the size, sniffs magic bytes against the pinned MIME type, then marks the row
 * ready. Anything suspicious deletes the pending row.
 */
export async function confirmMedia(
  db: Database,
  storage: StorageGateway,
  input: { mediaId: string; ownerId: string },
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
