import { relations } from 'drizzle-orm';
import {
  circleMembers,
  circleSettings,
  circles,
  conversationNotificationPrefs,
  conversationParticipants,
  conversations,
  media,
  messageReactions,
  messages,
  notifications,
  pollVotes,
  polls,
  pinboardItems,
  sessions,
  users,
} from './schema';

/**
 * Drizzle relations for the relational query API (docs/DATABASE.md §0).
 * Authorization always goes through circle_members /
 * conversation_participants at the service layer (M4/M5).
 */

export const usersRelations = relations(users, ({ many, one }) => ({
  sessions: many(sessions),
  memberships: many(circleMembers),
  media: many(media),
  messages: many(messages),
  notifications: many(notifications),
  avatar: one(media, { fields: [users.avatarMediaId], references: [media.id] }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const mediaRelations = relations(media, ({ one }) => ({
  owner: one(users, { fields: [media.ownerId], references: [users.id] }),
  conversation: one(conversations, {
    fields: [media.conversationId],
    references: [conversations.id],
  }),
}));

export const circlesRelations = relations(circles, ({ many, one }) => ({
  members: many(circleMembers),
  settings: one(circleSettings, {
    fields: [circles.id],
    references: [circleSettings.circleId],
  }),
  conversation: one(conversations, {
    fields: [circles.id],
    references: [conversations.circleId],
  }),
  pinboardItems: many(pinboardItems),
}));

export const circleMembersRelations = relations(circleMembers, ({ one }) => ({
  circle: one(circles, { fields: [circleMembers.circleId], references: [circles.id] }),
  user: one(users, { fields: [circleMembers.userId], references: [users.id] }),
}));

export const conversationsRelations = relations(conversations, ({ many, one }) => ({
  participants: many(conversationParticipants),
  messages: many(messages),
  polls: many(polls),
  notificationPrefs: many(conversationNotificationPrefs),
  circle: one(circles, { fields: [conversations.circleId], references: [circles.id] }),
}));

export const conversationParticipantsRelations = relations(
  conversationParticipants,
  ({ one }) => ({
    conversation: one(conversations, {
      fields: [conversationParticipants.conversationId],
      references: [conversations.id],
    }),
    user: one(users, {
      fields: [conversationParticipants.userId],
      references: [users.id],
    }),
  }),
);

export const messagesRelations = relations(messages, ({ many, one }) => ({
  reactions: many(messageReactions),
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
  sender: one(users, { fields: [messages.senderId], references: [users.id] }),
  replyTo: one(messages, { fields: [messages.replyToId], references: [messages.id] }),
}));

export const messageReactionsRelations = relations(messageReactions, ({ one }) => ({
  message: one(messages, {
    fields: [messageReactions.messageId],
    references: [messages.id],
  }),
  user: one(users, { fields: [messageReactions.userId], references: [users.id] }),
}));

export const pollsRelations = relations(polls, ({ many, one }) => ({
  votes: many(pollVotes),
  conversation: one(conversations, {
    fields: [polls.conversationId],
    references: [conversations.id],
  }),
}));

export const pollVotesRelations = relations(pollVotes, ({ one }) => ({
  poll: one(polls, { fields: [pollVotes.pollId], references: [polls.id] }),
  user: one(users, { fields: [pollVotes.userId], references: [users.id] }),
}));

export const pinboardItemsRelations = relations(pinboardItems, ({ one }) => ({
  circle: one(circles, { fields: [pinboardItems.circleId], references: [circles.id] }),
  createdBy: one(users, { fields: [pinboardItems.createdBy], references: [users.id] }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
  actor: one(users, { fields: [notifications.actorId], references: [users.id] }),
  circle: one(circles, { fields: [notifications.circleId], references: [circles.id] }),
}));

export const conversationNotificationPrefsRelations = relations(
  conversationNotificationPrefs,
  ({ one }) => ({
    conversation: one(conversations, {
      fields: [conversationNotificationPrefs.conversationId],
      references: [conversations.id],
    }),
    user: one(users, {
      fields: [conversationNotificationPrefs.userId],
      references: [users.id],
    }),
  }),
);
