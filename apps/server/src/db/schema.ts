import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

/**
 * CircleChat database schema — implements docs/DATABASE.md exactly (M1).
 *
 * Conventions: UUID PKs (gen_random_uuid), TIMESTAMPTZ everywhere, snake_case,
 * soft deletes only where the doc specifies (circles.deleted_at, messages.deleted_at).
 *
 * Circular FK note: users.avatar_media_id and circles.avatar_media_id reference
 * media.id but are declared WITHOUT .references() here to avoid a circular
 * CREATE TABLE dependency; the physical foreign keys (ON DELETE SET NULL) are
 * added by the M1 invariants migration.
 *
 * Database-level invariants (triggers + checks) live in the M1 invariants
 * migration: 5-member Circle limit, exactly-one-owner, direct-conversation
 * participant count, polls on Circle conversations only, poll-vote option bound.
 */

/* ------------------------------------------------------------------ users */

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    username: text('username').notNull().unique(),
    displayName: text('display_name').notNull(),
    passwordHash: text('password_hash').notNull(),
    recoveryCodeHash: text('recovery_code_hash').notNull(),
    bio: text('bio'),
    avatarMediaId: uuid('avatar_media_id'),
    notificationsEnabled: boolean('notifications_enabled').notNull().default(true),
    notificationPreview: boolean('notification_preview').notNull().default(true),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('users_username_lower_uq').on(sql`lower(${table.username})`),
    check('users_username_format_ck', sql`${table.username} ~ '^[a-z0-9_]{3,20}$'`),
    check(
      'users_display_name_len_ck',
      sql`char_length(${table.displayName}) BETWEEN 1 AND 40`,
    ),
    check(
      'users_bio_len_ck',
      sql`${table.bio} IS NULL OR char_length(${table.bio}) <= 200`,
    ),
  ],
);

/* --------------------------------------------------------------- sessions */

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    deviceName: text('device_name').notNull(),
    platform: text('platform').notNull(),
    pushToken: text('push_token'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    index('sessions_user_id_idx').on(table.userId),
    check(
      'sessions_platform_ck',
      sql`${table.platform} IN ('android', 'ios', 'other')`,
    ),
  ],
);

/* ------------------------------------------------------------------ media */

export const media = pgTable(
  'media',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id),
    conversationId: uuid('conversation_id'),
    kind: text('kind').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    storageKey: text('storage_key').notNull().unique(),
    status: text('status').notNull(),
    width: integer('width'),
    height: integer('height'),
    durationMs: integer('duration_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('media_conversation_id_idx').on(table.conversationId),
    index('media_owner_status_idx').on(table.ownerId, table.status),
    check(
      'media_kind_ck',
      sql`${table.kind} IN ('image', 'video', 'voice', 'file', 'avatar')`,
    ),
    check('media_size_positive_ck', sql`${table.sizeBytes} > 0`),
    check(
      'media_status_ck',
      sql`${table.status} IN ('pending', 'ready', 'deleted')`,
    ),
  ],
);

/* ---------------------------------------------------------------- circles */

export const circles = pgTable(
  'circles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description'),
    avatarMediaId: uuid('avatar_media_id'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    membersCount: smallint('members_count').notNull().default(1),
    inviteCodeHash: text('invite_code_hash'),
    inviteExpiresAt: timestamp('invite_expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('circles_invite_code_hash_uq')
      .on(table.inviteCodeHash)
      .where(sql`${table.inviteCodeHash} IS NOT NULL`),
    check('circles_name_len_ck', sql`char_length(${table.name}) BETWEEN 1 AND 40`),
    check('circles_members_max_ck', sql`${table.membersCount} <= 5`),
  ],
);

/* ---------------------------------------------------------- circle_members */

export const circleMembers = pgTable(
  'circle_members',
  {
    circleId: uuid('circle_id')
      .notNull()
      .references(() => circles.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.circleId, table.userId] }),
    index('circle_members_user_id_idx').on(table.userId),
    // Exactly one owner per Circle (ownership transfer swaps atomically later).
    uniqueIndex('circle_members_one_owner_uq')
      .on(table.circleId)
      .where(sql`${table.role} = 'owner'`),
    check(
      'circle_members_role_ck',
      sql`${table.role} IN ('owner', 'admin', 'member')`,
    ),
  ],
);

/* --------------------------------------------------------- circle_settings */

export const circleSettings = pgTable(
  'circle_settings',
  {
    circleId: uuid('circle_id')
      .primaryKey()
      .references(() => circles.id, { onDelete: 'cascade' }),
    themePreset: text('theme_preset').notNull().default('dark_purple'),
    accentColor: text('accent_color'),
    backgroundKey: text('background_key'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'circle_settings_accent_ck',
      sql`${table.accentColor} IS NULL OR ${table.accentColor} ~ '^#[0-9A-Fa-f]{6}$'`,
    ),
  ],
);

/* ----------------------------------------------------------- conversations */

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: text('type').notNull(),
    circleId: uuid('circle_id').references(() => circles.id, { onDelete: 'cascade' }),
    // Uniqueness helper only — NEVER an authorization source (docs/DATABASE.md §1.5).
    directKey: text('direct_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('conversations_circle_id_uq')
      .on(table.circleId)
      .where(sql`${table.circleId} IS NOT NULL`),
    uniqueIndex('conversations_direct_key_uq')
      .on(table.directKey)
      .where(sql`${table.directKey} IS NOT NULL`),
    check(
      'conversations_type_ck',
      sql`${table.type} IN ('circle', 'direct')`,
    ),
    check(
      'conversations_type_shape_ck',
      sql`(${table.type} = 'circle' AND ${table.circleId} IS NOT NULL AND ${table.directKey} IS NULL)
        OR (${table.type} = 'direct' AND ${table.directKey} IS NOT NULL AND ${table.circleId} IS NULL)`,
    ),
  ],
);

/* ---------------------------------------------- conversation_participants */

export const conversationParticipants = pgTable(
  'conversation_participants',
  {
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    // Read pointer (M5, docs/API.md POST /conversations/:id/read): the newest
    // message the user has seen in THIS conversation. FK is declared without
    // .references() to avoid a circular CREATE TABLE dependency (messages is
    // defined below); the physical FK lives in migration 0003.
    lastReadMessageId: uuid('last_read_message_id'),
  },
  (table) => [
    primaryKey({ columns: [table.conversationId, table.userId] }),
    index('conversation_participants_user_id_idx').on(table.userId),
  ],
);

/* --------------------------------------------------------------- messages */

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    senderId: uuid('sender_id')
      .notNull()
      .references(() => users.id),
    clientMessageId: text('client_message_id').notNull(),
    type: text('type').notNull(),
    body: text('body'),
    mediaId: uuid('media_id').references((): AnyPgColumn => media.id),
    replyToId: uuid('reply_to_id').references((): AnyPgColumn => messages.id, {
      onDelete: 'set null',
    }),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Idempotent sends: a client retry reuses the same client_message_id.
    uniqueIndex('messages_sender_client_message_uq').on(
      table.conversationId,
      table.senderId,
      table.clientMessageId,
    ),
    index('messages_history_idx').on(table.conversationId, table.createdAt.desc(), table.id),
    index('messages_latest_idx')
      .on(table.conversationId, table.createdAt.desc())
      .where(sql`${table.deletedAt} IS NULL`),
    check(
      'messages_type_ck',
      sql`${table.type} IN ('text', 'image', 'video', 'voice', 'file')`,
    ),
    check(
      'messages_body_len_ck',
      sql`${table.body} IS NULL OR char_length(${table.body}) <= 4000`,
    ),
    check(
      'messages_media_required_ck',
      sql`(${table.type} = 'text' AND ${table.mediaId} IS NULL)
        OR (${table.type} <> 'text' AND ${table.mediaId} IS NOT NULL)`,
    ),
  ],
);

/* ------------------------------------------------------- message_reactions */

export const messageReactions = pgTable(
  'message_reactions',
  {
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    emoji: text('emoji').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.messageId, table.userId, table.emoji] })],
);

/* ------------------------------------------------------------------ polls */

export const polls = pgTable(
  'polls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    question: text('question').notNull(),
    options: jsonb('options').notNull(),
    closesAt: timestamp('closes_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('polls_conversation_idx').on(table.conversationId, table.createdAt.desc()),
    check(
      'polls_question_len_ck',
      sql`char_length(${table.question}) BETWEEN 1 AND 300`,
    ),
    check(
      'polls_options_count_ck',
      sql`jsonb_array_length(${table.options}) BETWEEN 2 AND 6`,
    ),
  ],
);

/* ------------------------------------------------------------- poll_votes */

export const pollVotes = pgTable(
  'poll_votes',
  {
    pollId: uuid('poll_id')
      .notNull()
      .references(() => polls.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    optionIndex: smallint('option_index').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.pollId, table.userId] }),
    check(
      'poll_votes_option_range_ck',
      sql`${table.optionIndex} >= 0 AND ${table.optionIndex} < 6`,
    ),
  ],
);

/* ---------------------------------------------------------- pinboard_items */

export const pinboardItems = pgTable(
  'pinboard_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    circleId: uuid('circle_id')
      .notNull()
      .references(() => circles.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    content: text('content').notNull(),
    pinnedAt: timestamp('pinned_at', { withTimezone: true }).notNull().defaultNow(),
    orderIndex: integer('order_index').notNull().default(0),
  },
  (table) => [
    index('pinboard_items_circle_idx').on(table.circleId, table.pinnedAt.desc()),
    check(
      'pinboard_items_content_len_ck',
      sql`char_length(${table.content}) BETWEEN 1 AND 1000`,
    ),
  ],
);

/* ---------------------------------------------------------- notifications */

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    actorId: uuid('actor_id').references(() => users.id),
    circleId: uuid('circle_id').references(() => circles.id, { onDelete: 'cascade' }),
    payload: jsonb('payload').notNull().default({}),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('notifications_user_created_idx').on(table.userId, table.createdAt.desc()),
    index('notifications_unread_idx')
      .on(table.userId)
      .where(sql`${table.readAt} IS NULL`),
  ],
);

/* ------------------------------------------ conversation_notification_prefs */

export const conversationNotificationPrefs = pgTable(
  'conversation_notification_prefs',
  {
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    enabled: boolean('enabled').notNull().default(true),
    muted: boolean('muted').notNull().default(false),
    mentions: boolean('mentions').notNull().default(true),
    preview: boolean('preview').notNull().default(true),
    soundKey: text('sound_key'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.conversationId, table.userId] }),
    index('conversation_notification_prefs_user_idx').on(table.userId),
  ],
);
