import { createHash } from 'node:crypto';
import { and, asc, desc, eq, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Database } from '../../db/client';
import {
  circleMembers,
  circles,
  conversationNotificationPrefs,
  conversationParticipants,
  conversations,
  messages,
  users,
} from '../../db/schema';
import { AppError, notFound } from '../../errors';

/**
 * Conversations service (M5) — docs/DATABASE.md §1.5–1.6, docs/API.md.
 *
 * Authorization invariants:
 * - Direct conversations are authorized ONLY through
 *   `conversation_participants`; `direct_key` is a find-or-create uniqueness
 *   helper (sorted UUID pair, SHA-256) and is never read for access decisions.
 * - Circle conversations are authorized through `circle_members`.
 * - Direct creation requires the two users to share ≥1 active Circle (D1).
 *   Failure is a generic 404 so the target's existence is not leaked.
 * - Unread counts are computed server-side from the read pointer
 *   (`conversation_participants.last_read_message_id`), never trusted from
 *   the client.
 */

export interface ConversationAccess {
  conversation: typeof conversations.$inferSelect;
  /** Caller's role when the conversation is a Circle conversation. */
  circleRole: string | null;
}

/** Sorted UUID pair hashed to the unique direct_key (uniqueness helper only). */
export function buildDirectKey(userA: string, userB: string): string {
  const pair = [userA, userB].sort().join(':');
  return createHash('sha256').update(pair, 'utf8').digest('hex');
}

/**
 * Authorizes the caller for a conversation and returns it with Circle role
 * context. Non-member failures are generic 404s — existence is hidden.
 */
export async function requireConversationAccess(
  db: Database,
  conversationId: string,
  userId: string,
): Promise<ConversationAccess> {
  const rows = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  const conversation = rows[0];
  if (!conversation) {
    throw notFound('Conversation not found.');
  }
  if (conversation.type === 'circle') {
    const membership = await db
      .select({ role: circleMembers.role })
      .from(circleMembers)
      .innerJoin(circles, eq(circles.id, circleMembers.circleId))
      .where(
        and(
          eq(circleMembers.circleId, conversation.circleId!),
          eq(circleMembers.userId, userId),
          isNull(circles.deletedAt),
        ),
      )
      .limit(1);
    if (membership.length === 0) {
      throw notFound('Conversation not found.');
    }
    return { conversation, circleRole: membership[0]!.role };
  }
  const participant = await db
    .select({ userId: conversationParticipants.userId })
    .from(conversationParticipants)
    .where(
      and(
        eq(conversationParticipants.conversationId, conversationId),
        eq(conversationParticipants.userId, userId),
      ),
    )
    .limit(1);
  if (participant.length === 0) {
    throw notFound('Conversation not found.');
  }
  return { conversation, circleRole: null };
}

/**
 * Find-or-create a direct conversation with `targetUsername` (docs/API.md).
 * The two participant rows insert in the same transaction as the conversation
 * (docs/DATABASE.md §1.6). Duplicate creation returns the existing
 * conversation via the direct_key uniqueness helper. Without a shared active
 * Circle this fails with a generic 404 (no existence leak).
 */
export async function findOrCreateDirectConversation(
  db: Database,
  input: { callerId: string; targetUsername: string },
): Promise<{ conversationId: string; created: boolean }> {
  return db.transaction(async (tx) => {
    const target = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, input.targetUsername))
      .limit(1);
    const targetUser = target[0];
    if (!targetUser || targetUser.id === input.callerId) {
      // Unknown user and self-target are the same generic failure.
      throw notFound('User not found.');
    }

    // D1 rule: both users must currently share at least one active Circle.
    const callerCircleIds = await tx
      .select({ circleId: circleMembers.circleId })
      .from(circleMembers)
      .innerJoin(circles, eq(circles.id, circleMembers.circleId))
      .where(and(eq(circleMembers.userId, input.callerId), isNull(circles.deletedAt)));
    if (callerCircleIds.length > 0) {
      const shared = await tx
        .select({ circleId: circleMembers.circleId })
        .from(circleMembers)
        .where(
          and(
            eq(circleMembers.userId, targetUser.id),
            inArray(
              circleMembers.circleId,
              callerCircleIds.map((row) => row.circleId),
            ),
          ),
        )
        .limit(1);
      if (shared.length === 0) {
        throw notFound('User not found.');
      }
    } else {
      throw notFound('User not found.');
    }

    const directKey = buildDirectKey(input.callerId, targetUser.id);
    const existing = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.directKey, directKey))
      .limit(1);
    if (existing[0]) {
      return { conversationId: existing[0].id, created: false };
    }

    const inserted = await tx
      .insert(conversations)
      .values({ type: 'direct', directKey })
      .returning({ id: conversations.id });
    const conversation = inserted[0]!;
    await tx.insert(conversationParticipants).values([
      { conversationId: conversation.id, userId: input.callerId },
      { conversationId: conversation.id, userId: targetUser.id },
    ]);
    return { conversationId: conversation.id, created: true };
  });
}

/** Server-computed unread count: messages after the caller's read pointer. */
async function unreadCountFor(
  db: Database,
  conversationId: string,
  userId: string,
): Promise<number> {
  // A missing participant row (circle conversations never create one on join)
  // or a NULL pointer both mean "nothing read yet" — everything unread.
  const rows = await db.execute<{ count: number }>(sql`
    SELECT count(*)::int AS count
    FROM messages m
    WHERE m.conversation_id = ${conversationId}
      AND m.deleted_at IS NULL
      AND m.sender_id <> ${userId}
      AND m.created_at > COALESCE(
        (
          SELECT msg.created_at
          FROM conversation_participants p
          LEFT JOIN messages msg ON msg.id = p.last_read_message_id
          WHERE p.conversation_id = ${conversationId} AND p.user_id = ${userId}
        ),
        '-infinity'::timestamptz
      )
  `);
  return Number(rows.rows[0]?.count ?? 0);
}

interface LastMessageRow {
  id: string;
  body: string | null;
  createdAt: Date;
  senderId: string;
}

async function lastMessageFor(db: Database, conversationId: string): Promise<LastMessageRow | undefined> {
  const rows = await db
    .select({
      id: messages.id,
      body: messages.body,
      createdAt: messages.createdAt,
      senderId: messages.senderId,
    })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), isNull(messages.deletedAt)))
    .orderBy(desc(messages.createdAt))
    .limit(1);
  return rows[0];
}

/** Caller-scoped conversation list: last message + server-side unread count. */
export async function listConversationsFor(db: Database, userId: string) {
  const circleRows = await db
    .select({
      conversationId: conversations.id,
      circleId: circles.id,
      circleName: circles.name,
      circleAvatarMediaId: circles.avatarMediaId,
      lastMessageAt: conversations.lastMessageAt,
    })
    .from(conversations)
    .innerJoin(circles, eq(circles.id, conversations.circleId))
    .innerJoin(circleMembers, eq(circleMembers.circleId, circles.id))
    .where(and(eq(circleMembers.userId, userId), isNull(circles.deletedAt)));

  const otherParticipant = alias(conversationParticipants, 'other');
  const directRows = await db
    .select({
      conversationId: conversations.id,
      partnerId: users.id,
      partnerUsername: users.username,
      partnerDisplayName: users.displayName,
      partnerAvatarMediaId: users.avatarMediaId,
      lastMessageAt: conversations.lastMessageAt,
    })
    .from(conversationParticipants)
    .innerJoin(conversations, eq(conversations.id, conversationParticipants.conversationId))
    .innerJoin(
      otherParticipant,
      and(
        eq(otherParticipant.conversationId, conversationParticipants.conversationId),
        sql`${otherParticipant.userId} <> ${conversationParticipants.userId}`,
      ),
    )
    .innerJoin(users, eq(users.id, otherParticipant.userId))
    .where(eq(conversationParticipants.userId, userId));

  const items = [];
  for (const row of circleRows) {
    const [last, unread] = await Promise.all([
      lastMessageFor(db, row.conversationId),
      unreadCountFor(db, row.conversationId, userId),
    ]);
    items.push({
      id: row.conversationId,
      type: 'circle' as const,
      circleId: row.circleId,
      circleName: row.circleName,
      circleAvatarMediaId: row.circleAvatarMediaId,
      partnerUsername: null,
      partnerDisplayName: null,
      partnerAvatarMediaId: null,
      lastMessageAt: last ? last.createdAt.toISOString() : null,
      lastMessagePreview: last?.body ?? null,
      unreadCount: unread,
    });
  }
  for (const row of directRows) {
    const [last, unread] = await Promise.all([
      lastMessageFor(db, row.conversationId),
      unreadCountFor(db, row.conversationId, userId),
    ]);
    items.push({
      id: row.conversationId,
      type: 'direct' as const,
      circleId: null,
      circleName: null,
      circleAvatarMediaId: null,
      partnerUsername: row.partnerUsername,
      partnerDisplayName: row.partnerDisplayName,
      partnerAvatarMediaId: row.partnerAvatarMediaId,
      lastMessageAt: last ? last.createdAt.toISOString() : null,
      lastMessagePreview: last?.body ?? null,
      unreadCount: unread,
    });
  }
  // Most recently active first; never-messaged conversations last, stable by id.
  items.sort((a, b) => {
    if (a.lastMessageAt && b.lastMessageAt) {
      return b.lastMessageAt.localeCompare(a.lastMessageAt);
    }
    if (a.lastMessageAt) {
      return -1;
    }
    if (b.lastMessageAt) {
      return 1;
    }
    return a.id.localeCompare(b.id);
  });
  return items;
}

/**
 * Advances the caller's read pointer. The referenced message must belong to
 * this conversation (FK alone does not prove conversation membership).
 * Stale/older pointers are ignored so out-of-order reads never regress;
 * the response always reports the server-side unread count.
 */
export async function markConversationRead(
  db: Database,
  input: { conversationId: string; userId: string; lastReadMessageId: string },
): Promise<{ unreadCount: number; lastReadMessageId: string | null }> {
  const target = await db
    .select({ id: messages.id, createdAt: messages.createdAt })
    .from(messages)
    .where(
      and(eq(messages.id, input.lastReadMessageId), eq(messages.conversationId, input.conversationId)),
    )
    .limit(1);
  const targetMessage = target[0];
  if (!targetMessage) {
    throw new AppError(
      'INVALID_READ_POINTER',
      400,
      'The read pointer must reference a message in this conversation.',
    );
  }

  await db.transaction(async (tx) => {
    // Circle conversations have no participant row until the first read —
    // upsert one. (The M1 direct-guard trigger only restricts direct rows.)
    const current = await tx
      .select({ lastReadMessageId: conversationParticipants.lastReadMessageId })
      .from(conversationParticipants)
      .where(
        and(
          eq(conversationParticipants.conversationId, input.conversationId),
          eq(conversationParticipants.userId, input.userId),
        ),
      )
      .limit(1);
    const pointer = current[0]?.lastReadMessageId;
    if (pointer) {
      const previous = await tx
        .select({ createdAt: messages.createdAt })
        .from(messages)
        .where(eq(messages.id, pointer))
        .limit(1);
      // Ignore stale/out-of-order pointers: never move the read marker back.
      if (previous[0] && previous[0].createdAt > targetMessage.createdAt) {
        return;
      }
    }
    await tx
      .insert(conversationParticipants)
      .values({
        conversationId: input.conversationId,
        userId: input.userId,
        lastReadMessageId: input.lastReadMessageId,
      })
      .onConflictDoUpdate({
        target: [conversationParticipants.conversationId, conversationParticipants.userId],
        set: { lastReadMessageId: input.lastReadMessageId },
      });
  });

  return {
    unreadCount: await unreadCountFor(db, input.conversationId, input.userId),
    lastReadMessageId: input.lastReadMessageId,
  };
}

/** True when the two users are the two participants of an existing direct conversation. */
export async function sharesDirectConversationWith(
  db: Database,
  userA: string,
  userB: string,
): Promise<boolean> {
  const other = alias(conversationParticipants, 'other');
  const rows = await db
    .select({ conversationId: conversations.id })
    .from(conversationParticipants)
    .innerJoin(conversations, eq(conversations.id, conversationParticipants.conversationId))
    .innerJoin(
      other,
      and(
        eq(other.conversationId, conversationParticipants.conversationId),
        eq(other.userId, userB),
      ),
    )
    .where(and(eq(conversationParticipants.userId, userA), eq(conversations.type, 'direct')))
    .limit(1);
  return rows.length > 0;
}

/** The caller's own per-conversation notification preference (defaults when unset). */
export async function getNotificationPref(
  db: Database,
  input: { conversationId: string; userId: string },
): Promise<{ enabled: boolean; muted: boolean; mentions: boolean; preview: boolean }> {
  const existing = await db
    .select()
    .from(conversationNotificationPrefs)
    .where(
      and(
        eq(conversationNotificationPrefs.conversationId, input.conversationId),
        eq(conversationNotificationPrefs.userId, input.userId),
      ),
    )
    .limit(1);
  return {
    enabled: existing[0]?.enabled ?? true,
    muted: existing[0]?.muted ?? false,
    mentions: existing[0]?.mentions ?? true,
    preview: existing[0]?.preview ?? true,
  };
}

/** Caller's own per-conversation notification preference (upsert). */
export async function updateNotificationPref(
  db: Database,
  input: {
    conversationId: string;
    userId: string;
    enabled?: boolean;
    muted?: boolean;
    mentions?: boolean;
    preview?: boolean;
  },
): Promise<{ enabled: boolean; muted: boolean; mentions: boolean; preview: boolean }> {
  const existing = await db
    .select()
    .from(conversationNotificationPrefs)
    .where(
      and(
        eq(conversationNotificationPrefs.conversationId, input.conversationId),
        eq(conversationNotificationPrefs.userId, input.userId),
      ),
    )
    .limit(1);
  const desired = {
    enabled: input.enabled ?? existing[0]?.enabled ?? true,
    muted: input.muted ?? existing[0]?.muted ?? false,
    mentions: input.mentions ?? existing[0]?.mentions ?? true,
    preview: input.preview ?? existing[0]?.preview ?? true,
  };
  await db
    .insert(conversationNotificationPrefs)
    .values({
      conversationId: input.conversationId,
      userId: input.userId,
      ...desired,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        conversationNotificationPrefs.conversationId,
        conversationNotificationPrefs.userId,
      ],
      set: { ...desired, updatedAt: new Date() },
    });
  return desired;
}

/** Keyset cursor helper shared with the messages module (exported for reuse). */
export function messageCursorFilter(beforeMessageId: string | undefined) {
  if (!beforeMessageId) {
    return undefined;
  }
  return beforeMessageId;
}

// Re-exports keep the messages module imports shallow without cross-module reach-in.
export { and, asc, desc, eq, gt, inArray, isNull, lt, or };
