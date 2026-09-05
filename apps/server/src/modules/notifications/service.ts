import { and, eq, isNull, ne } from 'drizzle-orm';
import type { Database } from '../../db/client';
import {
  conversationNotificationPrefs,
  conversations,
  circleMembers,
  circles,
  conversationParticipants,
  sessions,
  users,
} from '../../db/schema';
import type { ExpoPushGateway, ExpoPushMessage } from './expo';

/**
 * Notification service (M8, docs/ARCHITECTURE.md §10).
 *
 * Source of truth is the server: on every persisted message it determines
 * eligibility and constructs push payloads here — never on the client.
 *
 * Eligibility for a recipient (docs/API.md Notifications):
 *   1. not the sender
 *   2. global notifications enabled (users.notifications_enabled)
 *   3. conversation pref not muted and enabled (defaults: enabled, unmuted)
 * Push is a delivery nicety — any failure here is logged and swallowed; the
 * message itself is already persisted and realtime has already fanned out.
 */

export const PREVIEW_MAX_CHARS = 200;

export interface PushPayload {
  to: string;
  title: string;
  body: string;
  data: { conversationId: string; messageId: string; type: string };
}

export interface RecipientNotificationContext {
  userId: string;
  globalEnabled: boolean;
  globalPreview: boolean;
  conversationMuted: boolean;
  conversationEnabled: boolean;
  conversationPreview: boolean;
}

/** Body preview honoring per-user + per-conversation preview privacy. */
export function buildPreviewBody(input: {
  messageType: 'text' | 'image' | 'video' | 'voice' | 'file' | 'gif';
  body: string | null;
  previewAllowed: boolean;
}): string {
  if (!input.previewAllowed) {
    return 'New message';
  }
  if (input.messageType !== 'text' || !input.body) {
    switch (input.messageType) {
      case 'image':
      case 'gif':
        return 'Sent a photo';
      case 'video':
        return 'Sent a video';
      case 'voice':
        return 'Sent a voice message';
      default:
        return 'Sent an attachment';
    }
  }
  const trimmed = input.body.trim();
  return trimmed.length > PREVIEW_MAX_CHARS ? `${trimmed.slice(0, PREVIEW_MAX_CHARS)}…` : trimmed;
}

/** Pure eligibility + payload construction — unit-testable without a DB. */
export function buildPushPayload(input: {
  recipient: RecipientNotificationContext;
  senderDisplayName: string;
  circleName: string | null;
  messageType: 'text' | 'image' | 'video' | 'voice' | 'file' | 'gif';
  messageBody: string | null;
  conversationId: string;
  messageId: string;
  pushToken: string;
}): PushPayload | undefined {
  const recipient = input.recipient;
  if (!recipient.globalEnabled) {
    return undefined; // global disable suppresses push entirely
  }
  if (recipient.conversationMuted || !recipient.conversationEnabled) {
    return undefined; // muted conversations stay silent
  }
  const previewAllowed = recipient.globalPreview && recipient.conversationPreview;
  return {
    to: input.pushToken,
    title: input.circleName ?? input.senderDisplayName,
    body: buildPreviewBody({
      messageType: input.messageType,
      body: input.messageBody,
      previewAllowed,
    }),
    data: {
      conversationId: input.conversationId,
      messageId: input.messageId,
      type: input.messageType,
    },
  };
}

/** Recipients for a conversation, excluding the sender, with their context. */
async function loadEligibleRecipients(
  db: Database,
  input: { conversationId: string; senderId: string; type: 'circle' | 'direct'; circleId: string | null },
): Promise<RecipientNotificationContext[]> {
  let userIds: string[] = [];
  let circleName: string | null = null;
  if (input.type === 'circle' && input.circleId) {
    const rows = await db
      .select({ userId: circleMembers.userId, circleName: circles.name })
      .from(circleMembers)
      .innerJoin(circles, eq(circles.id, circleMembers.circleId))
      .where(and(eq(circleMembers.circleId, input.circleId), isNull(circles.deletedAt)));
    circleName = rows[0]?.circleName ?? null;
    userIds = [...new Set(rows.map((r) => r.userId))];
  } else {
    const rows = await db
      .select({ userId: conversationParticipants.userId })
      .from(conversationParticipants)
      .where(eq(conversationParticipants.conversationId, input.conversationId));
    userIds = rows.map((r) => r.userId);
  }

  const recipients: RecipientNotificationContext[] = [];
  for (const userId of userIds) {
    if (userId === input.senderId) {
      continue; // senders never get notified about their own message
    }
    const userRows = await db
      .select({
        notificationsEnabled: users.notificationsEnabled,
        notificationPreview: users.notificationPreview,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const user = userRows[0];
    if (!user) {
      continue;
    }
    const prefRows = await db
      .select({
        muted: conversationNotificationPrefs.muted,
        enabled: conversationNotificationPrefs.enabled,
        preview: conversationNotificationPrefs.preview,
      })
      .from(conversationNotificationPrefs)
      .where(
        and(
          eq(conversationNotificationPrefs.conversationId, input.conversationId),
          eq(conversationNotificationPrefs.userId, userId),
        ),
      )
      .limit(1);
    recipients.push({
      userId,
      globalEnabled: user.notificationsEnabled,
      globalPreview: user.notificationPreview,
      conversationMuted: prefRows[0]?.muted ?? false,
      conversationEnabled: prefRows[0]?.enabled ?? true,
      conversationPreview: prefRows[0]?.preview ?? true,
    });
  }
  void circleName;
  return recipients;
}

/**
 * Post-send notification fan-out (docs/ARCHITECTURE.md §8, §10): called AFTER
 * the message is persisted and realtime has fanned out. Never throws — push
 * is a nicety, message persistence is the source of truth.
 */
export async function notifyNewMessage(
  db: Database,
  expo: ExpoPushGateway,
  input: {
    conversationId: string;
    messageId: string;
    senderId: string;
    senderDisplayName: string;
    messageType: 'text' | 'image' | 'video' | 'voice' | 'file' | 'gif';
    messageBody: string | null;
    log?: { warn: (obj: unknown, msg: string) => void };
  },
): Promise<void> {
  try {
    const convRows = await db
      .select({ type: conversations.type, circleId: conversations.circleId })
      .from(conversations)
      .where(eq(conversations.id, input.conversationId))
      .limit(1);
    const conversation = convRows[0];
    if (!conversation) {
      return;
    }
    let circleName: string | null = null;
    if (conversation.type === 'circle' && conversation.circleId) {
      const circleRows = await db
        .select({ name: circles.name })
        .from(circles)
        .where(eq(circles.id, conversation.circleId))
        .limit(1);
      circleName = circleRows[0]?.name ?? null;
    }

    const recipients = await loadEligibleRecipients(db, {
      conversationId: input.conversationId,
      senderId: input.senderId,
      type: conversation.type as 'circle' | 'direct',
      circleId: conversation.circleId,
    });
    if (recipients.length === 0) {
      return;
    }

    const messages: Array<ExpoPushMessage & { userId: string; tokenSessionIds: string[] }> = [];
    for (const recipient of recipients) {
      // Push tokens ride the user's live sessions (device = session, M1).
      const tokenRows = await db
        .select({ id: sessions.id, pushToken: sessions.pushToken })
        .from(sessions)
        .where(and(eq(sessions.userId, recipient.userId), isNull(sessions.revokedAt), ne(sessions.pushToken, '')));
      const seen = new Set<string>();
      for (const row of tokenRows) {
        if (!row.pushToken || seen.has(row.pushToken)) {
          continue;
        }
        seen.add(row.pushToken);
        const payload = buildPushPayload({
          recipient,
          senderDisplayName: input.senderDisplayName,
          circleName,
          messageType: input.messageType,
          messageBody: input.messageBody,
          conversationId: input.conversationId,
          messageId: input.messageId,
          pushToken: row.pushToken,
        });
        if (payload) {
          messages.push({ ...payload, userId: recipient.userId, tokenSessionIds: [row.id] });
        }
      }
    }
    if (messages.length === 0) {
      return;
    }

    const tickets = await expo.send(messages);
    // Invalid-token cleanup: Expo reports DeviceNotRegistered per ticket.
    for (let i = 0; i < tickets.length && i < messages.length; i++) {
      const ticket = tickets[i];
      const message = messages[i];
      if (!ticket || !message) {
        continue;
      }
      if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
        for (const sessionId of message.tokenSessionIds) {
          await db
            .update(sessions)
            .set({ pushToken: null })
            .where(and(eq(sessions.id, sessionId), eq(sessions.pushToken, message.to)));
        }
        input.log?.warn({ userId: message.userId }, 'push token unregistered (DeviceNotRegistered)');
      }
    }
  } catch (err) {
    // Push must never break messaging: log and move on.
    input.log?.warn({ err }, 'push notification fan-out failed');
  }
}

/** The caller's session push token (auth plugin exposes the session). */
export async function setSessionPushToken(
  db: Database,
  input: { sessionId: string; userId: string; pushToken: string | null },
): Promise<void> {
  if (input.pushToken) {
    // A token identifies ONE device: registering it here moves it off any
    // other session that previously held it (duplicate-token safety).
    await db
      .update(sessions)
      .set({ pushToken: null })
      .where(and(eq(sessions.pushToken, input.pushToken), ne(sessions.id, input.sessionId)));
  }
  await db
    .update(sessions)
    .set({ pushToken: input.pushToken, lastActiveAt: new Date() })
    .where(and(eq(sessions.id, input.sessionId), eq(sessions.userId, input.userId)));
}
