import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from '../../db/client';
import {
  circleMembers,
  circles,
  conversationParticipants,
  conversations,
  media,
  messageReactions,
  messages,
  users,
} from '../../db/schema';
import { AppError, forbidden, notFound } from '../../errors';
import { requireConversationAccess, type ConversationAccess } from '../conversations/service';

/**
 * Messages service (M5, text-only) — docs/DATABASE.md §1.7–1.8, docs/API.md.
 *
 * Invariants:
 * - Sends are idempotent on (conversation_id, sender_id, client_message_id);
 *   concurrent duplicate inserts resolve to the single stored row.
 * - History is keyset-paginated on (created_at, id) — never OFFSET.
 * - Edit: sender only, ≤24h, never a tombstoned message.
 * - Delete: sender always; a Circle admin may tombstone another Circle
 *   member's message; direct non-senders can never delete.
 * - Tombstones keep the row but never expose body/media again.
 * - Reactions accept only the documented emoji set; one row per
 *   (message, user, emoji).
 */

const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;
export const HISTORY_PAGE_MAX = 50;

interface SenderRow {
  username: string;
  displayName: string;
}

async function senderInfoFor(db: Database, senderId: string): Promise<SenderRow> {
  const rows = await db
    .select({ username: users.username, displayName: users.displayName })
    .from(users)
    .where(eq(users.id, senderId))
    .limit(1);
  return rows[0] ?? { username: 'unknown', displayName: 'Unknown' };
}

/** Reactions for a batch of messages, shaped for the shared message schema. */
async function reactionsFor(db: Database, messageIds: string[]) {
  const map = new Map<string, Array<{ emoji: string; userId: string; username: string }>>();
  if (messageIds.length === 0) {
    return map;
  }
  const rows = await db
    .select({
      messageId: messageReactions.messageId,
      emoji: messageReactions.emoji,
      userId: messageReactions.userId,
      username: users.username,
    })
    .from(messageReactions)
    .innerJoin(users, eq(users.id, messageReactions.userId))
    .where(inArray(messageReactions.messageId, messageIds))
    .orderBy(asc(messageReactions.createdAt));
  for (const row of rows) {
    const list = map.get(row.messageId) ?? [];
    list.push({ emoji: row.emoji, userId: row.userId, username: row.username });
    map.set(row.messageId, list);
  }
  return map;
}

async function replyPreviewFor(db: Database, replyToId: string | null) {
  if (!replyToId) {
    return null;
  }
  const rows = await db
    .select({
      id: messages.id,
      body: messages.body,
      deletedAt: messages.deletedAt,
      senderUsername: users.username,
    })
    .from(messages)
    .innerJoin(users, eq(users.id, messages.senderId))
    .where(eq(messages.id, replyToId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    senderUsername: row.senderUsername,
    // Tombstoned previews never expose the original body.
    body: row.deletedAt ? null : row.body,
    deleted: row.deletedAt !== null,
  };
}

export interface MessageRow {
  id: string;
  conversationId: string;
  senderId: string;
  type: string;
  body: string | null;
  mediaId: string | null;
  replyToId: string | null;
  editedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
}

/** Serializes a message row for the API (tombstone-safe, reply + reactions). */
export async function serializeMessage(db: Database, row: MessageRow) {
  const [sender, reactions, replyPreview] = await Promise.all([
    senderInfoFor(db, row.senderId),
    reactionsFor(db, [row.id]),
    replyPreviewFor(db, row.replyToId),
  ]);
  const deleted = row.deletedAt !== null;
  // Media metadata (M7): mime/dimensions/duration come from the media row so
  // clients can render without a second fetch; download URLs stay separate,
  // short-lived and authorization-checked. M7.1 adds externalUrl (external GIFs
  // render directly; no bucket object) and hasThumbnail for image bubbles.
  let mediaInfo: {
    kind: string;
    mimeType: string;
    sizeBytes: number;
    durationMs: number | null;
    width: number | null;
    height: number | null;
    externalUrl: string | null;
    hasThumbnail: boolean;
  } | null = null;
  if (row.mediaId && !deleted) {
    const mediaRows = await db
      .select({
        kind: media.kind,
        mimeType: media.mimeType,
        sizeBytes: media.sizeBytes,
        durationMs: media.durationMs,
        width: media.width,
        height: media.height,
        externalUrl: media.externalUrl,
        thumbnailKey: media.thumbnailKey,
      })
      .from(media)
      .where(and(eq(media.id, row.mediaId), eq(media.status, 'ready')))
      .limit(1);
    if (mediaRows[0]) {
      mediaInfo = {
        kind: mediaRows[0].kind,
        mimeType: mediaRows[0].mimeType,
        sizeBytes: mediaRows[0].sizeBytes,
        durationMs: mediaRows[0].durationMs,
        width: mediaRows[0].width,
        height: mediaRows[0].height,
        externalUrl: mediaRows[0].externalUrl,
        hasThumbnail: mediaRows[0].thumbnailKey !== null,
      };
    }
  }
  return {
    id: row.id,
    conversationId: row.conversationId,
    senderId: row.senderId,
    senderUsername: sender.username,
    senderDisplayName: sender.displayName,
    type: row.type as 'text' | 'image' | 'video' | 'voice' | 'file' | 'gif',
    body: deleted ? null : row.body,
    mediaId: deleted ? null : row.mediaId,
    media: mediaInfo,
    replyToId: row.replyToId,
    replyPreview,
    editedAt: row.editedAt ? row.editedAt.toISOString() : null,
    deleted,
    createdAt: row.createdAt.toISOString(),
    reactions: reactions.get(row.id) ?? [],
  };
}

/**
 * Idempotent send (M5 text + M7 media). Retries with the same clientMessageId
 * return the original message; the unique index arbitrates concurrent
 * duplicates. Media messages must reference a READY media row owned by the
 * sender and bound to this conversation — pending/foreign media is rejected,
 * so no participant ever sees a message whose bytes are not actually there.
 */
export async function sendMessage(
  db: Database,
  input: {
    conversationId: string;
    senderId: string;
    type: 'text' | 'image' | 'video' | 'voice' | 'file' | 'gif';
    body?: string;
    mediaId?: string;
    externalUrl?: string;
    replyToId?: string;
    clientMessageId: string;
  },
): Promise<{ message: Awaited<ReturnType<typeof serializeMessage>>; created: boolean }> {
  // Membership authorization happens here; the result is only the gate.
  await requireConversationAccess(db, input.conversationId, input.senderId);

  if (input.type !== 'text') {
    if (input.type === 'gif') {
      // External GIFs (M7.1): no storage round-trip — the provider URL rides
      // the message. The URL is validated for shape only; visibility stays
      // gated by the conversation membership check above.
      if (!input.externalUrl || !/^https:\/\/[a-z0-9.-]+\//i.test(input.externalUrl)) {
        throw new AppError('MEDIA_REQUIRED', 400, 'GIF messages require a valid GIF URL.');
      }
    } else {
      if (!input.mediaId) {
        throw new AppError('MEDIA_REQUIRED', 400, 'Media messages require an uploaded attachment.');
      }
      const mediaRows = await db
        .select({
          id: media.id,
          ownerId: media.ownerId,
          conversationId: media.conversationId,
          status: media.status,
          kind: media.kind,
        })
        .from(media)
        .where(eq(media.id, input.mediaId))
        .limit(1);
      const mediaRow = mediaRows[0];
      // Foreign owner, other conversation, or not-yet-confirmed upload: all the
      // same client error (no media existence leak, no pending media messages).
      if (
        !mediaRow ||
        mediaRow.ownerId !== input.senderId ||
        mediaRow.conversationId !== input.conversationId ||
        mediaRow.status !== 'ready'
      ) {
        throw new AppError(
          'MEDIA_NOT_READY',
          400,
          'The attachment upload is not complete for this conversation.',
        );
      }
    }
  } else if (input.mediaId) {
    throw new AppError('MEDIA_NOT_ALLOWED', 400, 'Text messages cannot carry an attachment.');
  }

  if (input.replyToId) {
    const reply = await db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(eq(messages.id, input.replyToId), eq(messages.conversationId, input.conversationId)),
      )
      .limit(1);
    // Cross-conversation and nonexistent replies are the same client error.
    if (!reply[0]) {
      throw new AppError('INVALID_REPLY_TARGET', 400, 'The replied-to message was not found.');
    }
  }

  // M7.1 external GIFs: a READY media row (external_url, no bucket object)
  // is created inline so the message keeps the normal media-metadata shape.
  // Only on the created path — a retry must not re-insert (unique storageKey).
  let mediaIdForInsert = input.mediaId ?? null;
  if (input.type === 'gif' && input.externalUrl) {
    const existingDuplicate = await db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, input.conversationId),
          eq(messages.senderId, input.senderId),
          eq(messages.clientMessageId, input.clientMessageId),
        ),
      )
      .limit(1);
    if (!existingDuplicate[0]) {
      const created = await db
        .insert(media)
        .values({
          ownerId: input.senderId,
          conversationId: input.conversationId,
          kind: 'gif',
          mimeType: 'image/gif',
          sizeBytes: 1, // CHECK requires > 0; byte size lives at the provider
          storageKey: `external/${input.senderId}/${input.clientMessageId}`,
          status: 'ready',
          externalUrl: input.externalUrl,
        })
        .onConflictDoNothing()
        .returning({ id: media.id });
      if (created[0]) {
        mediaIdForInsert = created[0].id;
      } else {
        // Concurrent duplicate: reuse the media row another request made.
        const reused = await db
          .select({ id: media.id })
          .from(media)
          .where(eq(media.storageKey, `external/${input.senderId}/${input.clientMessageId}`))
          .limit(1);
        mediaIdForInsert = reused[0]?.id ?? null;
      }
    } else {
      // Return the duplicate's media for serialization consistency.
      const dup = await db
        .select({ mediaId: messages.mediaId })
        .from(messages)
        .where(eq(messages.id, existingDuplicate[0].id))
        .limit(1);
      mediaIdForInsert = dup[0]?.mediaId ?? null;
    }
  }

  const inserted = await db
    .insert(messages)
    .values({
      conversationId: input.conversationId,
      senderId: input.senderId,
      clientMessageId: input.clientMessageId,
      type: input.type,
      body: input.body ?? null,
      mediaId: mediaIdForInsert,
      replyToId: input.replyToId ?? null,
    })
    .onConflictDoNothing({
      target: [messages.conversationId, messages.senderId, messages.clientMessageId],
    })
    .returning();

  let row = inserted[0];
  let created = true;
  if (!row) {
    // Retry or concurrent duplicate: return the already-stored message.
    created = false;
    const existing = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, input.conversationId),
          eq(messages.senderId, input.senderId),
          eq(messages.clientMessageId, input.clientMessageId),
        ),
      )
      .limit(1);
    row = existing[0];
  }
  if (!row) {
    throw new AppError('INTERNAL_ERROR', 500, 'Message could not be stored.');
  }

  if (created) {
    await db
      .update(conversations)
      .set({ lastMessageAt: row.createdAt })
      .where(eq(conversations.id, input.conversationId));
  }

  return { message: await serializeMessage(db, row), created };
}

export interface HistoryPage {
  messages: Array<Awaited<ReturnType<typeof serializeMessage>>>;
  /** Pass as ?before= to fetch the next older page; null means no more. */
  nextBeforeCursor: string | null;
}

/** Keyset-paginated history, newest page first (docs/API.md). */
export async function listMessages(
  db: Database,
  input: { conversationId: string; userId: string; before?: string; limit: number },
): Promise<HistoryPage> {
  await requireConversationAccess(db, input.conversationId, input.userId);
  const limit = Math.min(input.limit, HISTORY_PAGE_MAX);

  let cursorCreatedAt: Date | undefined;
  if (input.before) {
    const cursor = await db
      .select({ createdAt: messages.createdAt })
      .from(messages)
      .where(
        and(eq(messages.id, input.before), eq(messages.conversationId, input.conversationId)),
      )
      .limit(1);
    if (!cursor[0]) {
      throw new AppError('INVALID_CURSOR', 400, 'The pagination cursor is not valid.');
    }
    cursorCreatedAt = cursor[0].createdAt;
  }

  const rows = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, input.conversationId),
        cursorCreatedAt
          ? // Deterministic keyset: strictly older than the cursor message.
            sql`(${messages.createdAt} < ${cursorCreatedAt.toISOString()} OR (${messages.createdAt} = ${cursorCreatedAt.toISOString()} AND ${messages.id} < ${input.before}))`
          : undefined,
      ),
    )
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const serialized = await Promise.all(page.map((row) => serializeMessage(db, row)));
  return {
    messages: serialized,
    nextBeforeCursor: hasMore ? page[page.length - 1]!.id : null,
  };
}

/**
 * Sender-only edit within the 24h window (docs/API.md D2). Circle admins
 * CANNOT edit other members' messages; deleted messages are never editable.
 */
export async function editMessage(
  db: Database,
  input: { messageId: string; callerId: string; body: string },
): Promise<Awaited<ReturnType<typeof serializeMessage>>> {
  const row = await requireEditableMessage(db, input.messageId, input.callerId);
  if (row.createdAt.getTime() < Date.now() - EDIT_WINDOW_MS) {
    throw new AppError('EDIT_WINDOW_EXPIRED', 409, 'This message can no longer be edited.');
  }
  const updated = await db
    .update(messages)
    .set({ body: input.body, editedAt: new Date() })
    .where(and(eq(messages.id, row.id), sql`${messages.deletedAt} IS NULL`))
    .returning();
  return serializeMessage(db, updated[0]!);
}

/** Sender always; a Circle conversation admin may tombstone others' messages. */
export async function deleteMessage(
  db: Database,
  input: { messageId: string; callerId: string },
): Promise<Awaited<ReturnType<typeof serializeMessage>>> {
  const row = await db
    .select()
    .from(messages)
    .where(eq(messages.id, input.messageId))
    .limit(1);
  const message = row[0];
  if (!message || message.deletedAt) {
    // Deleting a missing or already-deleted message is a stable no-op view.
    if (message) {
      return serializeMessage(db, message);
    }
    throw notFound('Message not found.');
  }
  const access: ConversationAccess = await requireConversationAccess(
    db,
    message.conversationId,
    input.callerId,
  );
  const isSender = message.senderId === input.callerId;
  const isAdminInCircle =
    access.conversation.type === 'circle' &&
    (access.circleRole === 'owner' || access.circleRole === 'admin');
  if (!isSender && !isAdminInCircle) {
    throw forbidden('You can only delete your own messages.');
  }

  // Tombstone: keep the row, drop the content (docs/API.md).
  const updated = await db
    .update(messages)
    .set({ deletedAt: new Date(), body: null, mediaId: null })
    .where(eq(messages.id, message.id))
    .returning();
  return serializeMessage(db, updated[0]!);
}

async function requireEditableMessage(db: Database, messageId: string, callerId: string) {
  const rows = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
  const row = rows[0];
  if (!row || row.deletedAt) {
    throw notFound('Message not found.');
  }
  // Editing is strictly sender-only — no role overrides this.
  if (row.senderId !== callerId) {
    const access = await requireConversationAccess(db, row.conversationId, callerId);
    void access; // membership proven; still not allowed to edit another's message
    throw forbidden('You can only edit your own messages.');
  }
  await requireConversationAccess(db, row.conversationId, callerId);
  return row;
}

/** Add a reaction (one per user/emoji/message). Idempotent on duplicates. */
export async function addReaction(
  db: Database,
  input: { messageId: string; callerId: string; emoji: string },
): Promise<Awaited<ReturnType<typeof serializeMessage>>> {
  const row = await requireReactableMessage(db, input.messageId, input.callerId);
  await db
    .insert(messageReactions)
    .values({ messageId: row.id, userId: input.callerId, emoji: input.emoji })
    .onConflictDoNothing();
  const fresh = await db.select().from(messages).where(eq(messages.id, row.id)).limit(1);
  return serializeMessage(db, fresh[0]!);
}

/** Remove the caller's reaction for one emoji on a message. */
export async function removeReaction(
  db: Database,
  input: { messageId: string; callerId: string; emoji: string },
): Promise<Awaited<ReturnType<typeof serializeMessage>>> {
  const row = await requireReactableMessage(db, input.messageId, input.callerId);
  await db
    .delete(messageReactions)
    .where(
      and(
        eq(messageReactions.messageId, row.id),
        eq(messageReactions.userId, input.callerId),
        eq(messageReactions.emoji, input.emoji),
      ),
    );
  const fresh = await db.select().from(messages).where(eq(messages.id, row.id)).limit(1);
  return serializeMessage(db, fresh[0]!);
}

async function requireReactableMessage(db: Database, messageId: string, callerId: string) {
  const rows = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
  const row = rows[0];
  if (!row || row.deletedAt) {
    throw notFound('Message not found.');
  }
  await requireConversationAccess(db, row.conversationId, callerId);
  return row;
}

/**
 * Metadata for a conversation's chat screen: circle identity or direct
 * partner identity. Authorization happens via requireConversationAccess.
 */
export async function conversationChatHeader(db: Database, conversationId: string, userId: string) {
  const access = await requireConversationAccess(db, conversationId, userId);
  if (access.conversation.type === 'circle') {
    const rows = await db
      .select({
        circleId: circles.id,
        name: circles.name,
        avatarMediaId: circles.avatarMediaId,
        membersCount: circles.membersCount,
      })
      .from(circles)
      .where(eq(circles.id, access.conversation.circleId!))
      .limit(1);
    const circle = rows[0]!;
    return {
      type: 'circle' as const,
      title: circle.name,
      avatarMediaId: circle.avatarMediaId,
      subtitle: circle.membersCount === 1 ? '1 member' : `${circle.membersCount} members`,
      circleRole: access.circleRole,
    };
  }
  const partner = await db
    .select({
      username: users.username,
      displayName: users.displayName,
      avatarMediaId: users.avatarMediaId,
    })
    .from(conversationParticipants)
    .innerJoin(users, eq(users.id, conversationParticipants.userId))
    .where(
      and(
        eq(conversationParticipants.conversationId, conversationId),
        sql`${conversationParticipants.userId} <> ${userId}`,
      ),
    )
    .limit(1);
  const partnerRow = partner[0]!;
  return {
    type: 'direct' as const,
    title: partnerRow.displayName,
    avatarMediaId: partnerRow.avatarMediaId,
    subtitle: `@${partnerRow.username}`,
    circleRole: null,
  };
}

// circleMembers/circles re-imports keep this module the single messaging entry point.
export { circleMembers, circles };
