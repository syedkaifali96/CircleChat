# CircleChat — Database Design

> Status: **Proposed — aligned with the approved documentation gate.** PostgreSQL 16, accessed via Drizzle ORM.
> This document is conceptual-but-concrete: names, types, constraints and indexes are the intended
> implementation. Physical tuning happens during implementation.

Conventions: UUID primary keys (`gen_random_uuid()`), `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`,
snake_case names, soft deletes only where specified. All timestamps are UTC.

---

## 0. Entity Overview

```text
users ──< sessions/devices
users ──< circle_members >── circles ─── circle_settings (1:1)
users ──< conversation_participants >── conversations
conversations ──< messages ──< message_reactions
conversations ──< conversation_notification_prefs
conversations ──< polls ──< poll_votes
messages/media ─── media
users ──< notifications
circles ──< pinboard_items
```

A `conversations` table unifies the two messaging types: Circle group chats (`type='circle'`) and
private 1-to-1 chats (`type='direct'`). Direct conversations are **not** modeled as 2-member Circles.
The `conversation_participants` table is the authoritative authorization source for direct chats.
`direct_key` remains only as a uniqueness helper.

---

## 1. Tables

### 1.1 `users`

Purpose: an account. Identity is username-only — no email/phone columns exist.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `username` | TEXT UNIQUE NOT NULL | stored lowercase; `^[a-z0-9_]{3,20}$`; case-insensitive uniqueness via unique index on lower(username) |
| `display_name` | TEXT NOT NULL | shown in UI, 1–40 chars |
| `password_hash` | TEXT NOT NULL | Argon2id string (PHC format) |
| `recovery_code_hash` | TEXT NOT NULL | Argon2id hash of the recovery code |
| `bio` | TEXT NULL | optional, ≤ 200 chars |
| `avatar_media_id` | UUID NULL → `media.id` | profile picture |
| `notifications_enabled` | BOOLEAN NOT NULL DEFAULT true | global push notification enable/disable |
| `notification_preview` | BOOLEAN NOT NULL DEFAULT true | global message-preview privacy default |
| `last_seen_at` | TIMESTAMPTZ NULL | stamped when the user's last socket disconnects (M6 presence); online state is derived from live connections, never persisted |
| `created_at` | TIMESTAMPTZ NOT NULL | |

Username is **fixed after account creation in MVP**; there is no username-change operation.
Relationships: 1→N sessions, circle_members, conversation_participants, messages, media (owner).
No PII beyond what the user typed. No email/phone/contact fields by design.

### 1.2 `circles`

Purpose: a private group of 2–5 members.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `name` | TEXT NOT NULL | 1–40 chars |
| `description` | TEXT NULL | optional |
| `avatar_media_id` | UUID NULL → `media.id` | Circle avatar |
| `created_by` | UUID NOT NULL → `users.id` | initial owner |
| `members_count` | SMALLINT NOT NULL DEFAULT 1 | denormalized counter maintained transactionally/triggered |
| `invite_code_hash` | TEXT UNIQUE NULL | SHA-256 hash of the active invite code; raw code is never stored |
| `invite_expires_at` | TIMESTAMPTZ NULL | active invite expiry |
| `created_at` | TIMESTAMPTZ NOT NULL | |
| `deleted_at` | TIMESTAMPTZ NULL | soft delete |

Relationships: 1→1 `circle_settings`; 1→N `circle_members`, one Circle conversation, pinboard items.
Indexes: `UNIQUE (invite_code_hash)` (partial where not null).

**Invite semantics:** the active invite code is multi-use while it is valid, revocable and the Circle
has capacity. Capacity is inherently limited by the Circle's 5-member invariant; no separate usage
counter is required. The raw invite code is generated and returned once, then only its hash is stored.
Revoking an invite clears `invite_code_hash` and `invite_expires_at`.

### 1.3 `circle_members`

Purpose: Circle membership + role; **the Circle authorization table**.

| Field | Type | Notes |
|---|---|---|
| `circle_id` | UUID, FK → `circles.id` ON DELETE CASCADE | composite PK part 1 |
| `user_id` | UUID, FK → `users.id` ON DELETE CASCADE | composite PK part 2 |
| `role` | TEXT NOT NULL CHECK (`role IN ('owner','admin','member')`) | exactly one owner per Circle |
| `joined_at` | TIMESTAMPTZ NOT NULL | |

Primary key: `(circle_id, user_id)` — a user can never be in a Circle twice.
Additional index: `(user_id)` for "my circles" queries.

**Server-side 5-member limit.** Joining runs in one transaction using all three layers:

1. Lock the Circle row and conditionally insert only when `members_count < 5`.
2. A `BEFORE INSERT` trigger re-counts membership and rejects a sixth member while maintaining the
   denormalized counter on insert/delete.
3. `CHECK (members_count <= 5)` remains the final declarative guard.

The application maps a zero-row conditional join caused by capacity to stable API error
`CIRCLE_FULL` (HTTP 409). Database/trigger violations are also translated to the same stable error.

Creating a Circle inserts the owner as the first member. A Circle may therefore temporarily have one
member immediately after creation, before an invitee joins.

### 1.4 `circle_settings`

Purpose: Circle customization and behavior.

| Field | Type | Notes |
|---|---|---|
| `circle_id` | UUID PK, FK → `circles.id` ON DELETE CASCADE | 1:1 |
| `theme_preset` | TEXT NOT NULL DEFAULT 'dark_purple' | app-defined presets |
| `accent_color` | TEXT NULL | validated `#RRGGBB`, nullable |
| `background_key` | TEXT NULL | reference to bundled background asset |
| `updated_at` | TIMESTAMPTZ NOT NULL | |

`status_text` is intentionally removed. Circle description lives on `circles.description`.
Editable by `owner`/`admin` only (enforced in API).

### 1.5 `conversations`

Purpose: unified message container for Circle chats and private direct chats.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `type` | TEXT NOT NULL CHECK (`type IN ('circle','direct')`) | |
| `circle_id` | UUID NULL → `circles.id` ON DELETE CASCADE | NOT NULL when type='circle'; one conversation per Circle |
| `direct_key` | TEXT NULL UNIQUE | sorted UUID pair; uniqueness helper only |
| `created_at` | TIMESTAMPTZ NOT NULL | |
| `last_message_at` | TIMESTAMPTZ NULL | denormalized chat-list ordering |

Constraints:

```sql
CHECK (
  (type='circle' AND circle_id IS NOT NULL AND direct_key IS NULL)
  OR
  (type='direct' AND direct_key IS NOT NULL AND circle_id IS NULL)
)
```

A `direct` conversation has exactly two rows in `conversation_participants`. **Never authorize a
DM by parsing `direct_key`.** `direct_key` only prevents duplicate direct conversations.

Creating a direct conversation also requires the two users to share at least one active Circle at
the time it is created. The resulting direct conversation remains independent of that Circle.

### 1.6 `conversation_participants`

Purpose: authoritative participants/authorization for `direct` conversations; read-pointer storage for both conversation types.

| Field | Type | Notes |
|---|---|---|
| `conversation_id` | UUID, FK → `conversations.id` ON DELETE CASCADE | composite PK part 1 |
| `user_id` | UUID, FK → `users.id` ON DELETE CASCADE | composite PK part 2 |
| `joined_at` | TIMESTAMPTZ NOT NULL | |
| `last_read_message_id` | UUID NULL, FK → `messages.id` ON DELETE SET NULL | newest message the user has seen in this conversation (M5); NULL/missing row = everything unread |

Primary key: `(conversation_id, user_id)`.

For `type='direct'`, exactly two distinct users must be present. Creation must insert both participant
rows in the same transaction as the conversation. Access to direct messages, reads, reactions, media
and realtime events is authorized by membership in this table. A database trigger/constraint check
must prevent a direct conversation from ending up with anything other than two participants.

Circle conversations do not use this table as their Circle-membership authority; `circle_members`
remains authoritative for Circle-scoped resources. A participant row for a Circle conversation is
created lazily on the first `POST /v1/conversations/:id/read` call (upsert) and serves only as that
user's read pointer; unread counts are always computed server-side from this pointer, never trusted
from clients. Stale/out-of-order read pointers never move the marker backward.

### 1.7 `messages`

Purpose: chat messages for both conversation types.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `conversation_id` | UUID NOT NULL → `conversations.id` ON DELETE CASCADE | |
| `sender_id` | UUID NOT NULL → `users.id` | |
| `client_message_id` | TEXT NOT NULL | client-generated idempotency key, unique per sender/conversation |
| `type` | TEXT NOT NULL CHECK (`type IN ('text','image','video','voice','file')`) | MVP set |
| `body` | TEXT NULL | ≤ 4000 chars; NULL for pure-media messages |
| `media_id` | UUID NULL → `media.id` | NOT NULL when type ≠ text |
| `reply_to_id` | UUID NULL → `messages.id` | one-level reply threading |
| `edited_at` | TIMESTAMPTZ NULL | sender-only edit within approved window |
| `deleted_at` | TIMESTAMPTZ NULL | tombstone |
| `created_at` | TIMESTAMPTZ NOT NULL | ordering clock |

Unique constraint: `(conversation_id, sender_id, client_message_id)`.
This makes REST retries idempotent without allowing two users to collide on the same client key.

Indexes:
- `(conversation_id, created_at DESC, id)` — history pagination + stable ordering.
- `(conversation_id, created_at DESC)` for latest-message lookup where `deleted_at IS NULL`.

`reply_to_id` uses `ON DELETE SET NULL` so deleting a message does not cascade-delete replies.

### 1.8 `message_reactions`

Purpose: emoji reactions on messages.

| Field | Type | Notes |
|---|---|---|
| `message_id` | UUID, FK → `messages.id` ON DELETE CASCADE | composite PK part 1 |
| `user_id` | UUID, FK → `users.id` ON DELETE CASCADE | composite PK part 2 |
| `emoji` | TEXT NOT NULL | server-defined emoji set |
| `created_at` | TIMESTAMPTZ NOT NULL | |

PK `(message_id, user_id, emoji)` — a user may add several different emoji but never the same one twice.

### 1.9 `media`

Purpose: metadata for uploaded files; bytes live in private R2. M7 uses this
table as-is for chat media — chat upload intents set `conversation_id` (the
access scope) and per-kind caps are enforced on the intent (image 10 MB,
video 50 MB, voice 10 MB with a 2-minute server-enforced duration ceiling on
the declared `duration_ms`). No schema change was required.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `owner_id` | UUID NOT NULL → `users.id` | uploader |
| `conversation_id` | UUID NULL → `conversations.id` | access scope for chat media |
| `kind` | TEXT NOT NULL CHECK (`kind IN ('image','video','voice','file','avatar')`) | |
| `mime_type` | TEXT NOT NULL | server-validated/sniffed |
| `size_bytes` | BIGINT NOT NULL CHECK (`size_bytes > 0`) | re-verified at confirm |
| `storage_key` | TEXT NOT NULL UNIQUE | non-guessable R2 object key |
| `status` | TEXT NOT NULL CHECK (`status IN ('pending','ready','deleted')`) | lifecycle |
| `width`/`height` | INTEGER NULL | images/videos |
| `duration_ms` | INTEGER NULL | voice/video |
| `created_at` | TIMESTAMPTZ NOT NULL | |

Indexes: `(conversation_id)` and `(owner_id, status)`.

Access rules are explicit and are enforced before presigning:

- Chat media: owner or an authorized participant/member of the linked conversation.
- Profile avatar: authorized viewers of that user's minimal profile; never a global media bypass.
- Circle avatar: active members of that Circle.
- Invite-preview Circle avatar: only through the specific valid invite-preview flow, with limited
  pre-join fields and no general Circle/member access.

### 1.10 `sessions` (devices)

Purpose: one row per logged-in device; revocable; also holds push tokens.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | UUID NOT NULL → `users.id` ON DELETE CASCADE | |
| `token_hash` | TEXT NOT NULL UNIQUE | SHA-256 of opaque session token |
| `device_name` | TEXT NOT NULL | |
| `platform` | TEXT NOT NULL CHECK (`platform IN ('android','ios','other')`) | |
| `push_token` | TEXT NULL | Expo push token |
| `created_at` | TIMESTAMPTZ NOT NULL | |
| `last_active_at` | TIMESTAMPTZ NOT NULL | refreshed on use, throttled |
| `expires_at` | TIMESTAMPTZ NOT NULL | 30 days sliding |
| `revoked_at` | TIMESTAMPTZ NULL | logout/revoke/recovery/password-change effects |

Indexes: `(user_id)` and `UNIQUE (token_hash)`.

Revoked/expired rows older than the cleanup window may be removed. Revoking a session also disconnects
its live Socket.IO connection(s); a revoked session must not remain authorized over an existing socket.

### 1.11 `conversation_notification_prefs`

Purpose: per-conversation notification controls for both Circle and direct conversations.

| Field | Type | Notes |
|---|---|---|
| `conversation_id` | UUID, FK → `conversations.id` ON DELETE CASCADE | composite PK part 1 |
| `user_id` | UUID, FK → `users.id` ON DELETE CASCADE | composite PK part 2 |
| `enabled` | BOOLEAN NOT NULL DEFAULT true | per-conversation notification enable/disable |
| `muted` | BOOLEAN NOT NULL DEFAULT false | silent/muted state |
| `mentions` | BOOLEAN NOT NULL DEFAULT true | mention notifications where applicable |
| `preview` | BOOLEAN NOT NULL DEFAULT true | whether message text may appear in push preview |
| `sound_key` | TEXT NULL | optional custom notification sound identifier |
| `updated_at` | TIMESTAMPTZ NOT NULL | |

Primary key: `(conversation_id, user_id)`.

Effective push behavior is computed server-side from global user settings plus these per-conversation
preferences. A global disable always suppresses notification delivery. A muted conversation suppresses
normal message pushes; mention behavior is applied only where mentions are applicable. Preview privacy
controls whether message content is included.

### 1.12 `notifications`

Purpose: in-app activity log for Circle activity; pure message pushes are not required to be stored here.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | UUID NOT NULL → `users.id` ON DELETE CASCADE | recipient |
| `type` | TEXT NOT NULL | `poll_created`, `member_joined`, `poll_closed`, … |
| `actor_id` | UUID NULL → `users.id` | |
| `circle_id` | UUID NULL → `circles.id` ON DELETE CASCADE | context |
| `payload` | JSONB NOT NULL DEFAULT '{}' | small display data; no message bodies |
| `read_at` | TIMESTAMPTZ NULL | |
| `created_at` | TIMESTAMPTZ NOT NULL | |

Index: `(user_id, created_at DESC)` plus partial unread index.

### 1.13 `polls`

Purpose: simple Circle polls; direct conversations cannot have polls.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `conversation_id` | UUID NOT NULL → `conversations.id` ON DELETE CASCADE | must be Circle conversation |
| `created_by` | UUID NOT NULL → `users.id` | |
| `question` | TEXT NOT NULL | ≤ 300 chars |
| `options` | JSONB NOT NULL | array of 2–6 strings; each ≤ 80 chars |
| `closes_at` | TIMESTAMPTZ NULL | optional deadline |
| `created_at` | TIMESTAMPTZ NOT NULL | |

`allow_multiple` is intentionally removed. MVP polls are single-choice only.
Constraint: `jsonb_array_length(options) BETWEEN 2 AND 6`; each option length is validated by the
application and/or reviewed trigger as appropriate.

### 1.14 `poll_votes`

Purpose: one member's vote on a poll.

| Field | Type | Notes |
|---|---|---|
| `poll_id` | UUID, FK → `polls.id` ON DELETE CASCADE | composite PK part 1 |
| `user_id` | UUID, FK → `users.id` ON DELETE CASCADE | composite PK part 2 |
| `option_index` | SMALLINT NOT NULL CHECK (`option_index >= 0 AND option_index < 6`) | validated against current options |
| `created_at` | TIMESTAMPTZ NOT NULL | |

PK `(poll_id, user_id)` guarantees one vote per user. Vote changes are a delete+insert transaction while
open. Results are visible to Circle members as defined by the product rules.

### 1.15 `pinboard_items`

Purpose: Circle-level shared pins.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `circle_id` | UUID NOT NULL → `circles.id` ON DELETE CASCADE | |
| `created_by` | UUID NOT NULL → `users.id` | |
| `content` | TEXT NOT NULL | ≤ 1000 chars |
| `pinned_at` | TIMESTAMPTZ NOT NULL | |
| `order_index` | INTEGER NOT NULL DEFAULT 0 | |

Index: `(circle_id, pinned_at DESC)`.

---

## 2. Future Tables (V2 — named now, built later)

`memories`, `events`, `moods`, `circle_status_history`, `saved_messages` — see Build Plan future scope.
They will follow the same conventions; nothing in the MVP schema requires implementing them now.

Account deletion is **post-MVP** and therefore has no deletion-specific table or API requirement in the MVP schema.

## 3. Integrity & Performance Notes

- **No client-only authorization.** Circle membership uses `circle_members`; direct authorization uses `conversation_participants`.
- **5-member limit:** the join transaction locks the Circle row; conditional insert + trigger + `CHECK` provide layered enforcement. A failed capacity join maps to `CIRCLE_FULL`.
- **Direct participant invariant:** a direct conversation must have exactly two participants, created atomically with the conversation. `direct_key` is not an authorization source.
- **Ownership transfer:** transfer must run as one transaction: lock the Circle, verify the current caller is owner and the target is an active member, demote the old owner, promote the target, and preserve the exactly-one-owner invariant. The caller cannot leave/demote the owner role in a way that leaves no owner.
- **Invite lifecycle:** create/revoke/expiry updates the hashed invite fields atomically. Preview validates the supplied code against its hash, expiry, revocation state and Circle capacity before returning limited preview data.
- **Idempotent messages:** `(conversation_id, sender_id, client_message_id)` prevents duplicate messages caused by retries.
- All writes spanning tables run in transactions with row locks on contested parent rows.
- Pagination uses keyset ordering; no OFFSET scans for message history.
- Expected scale is tiny (≤5 members/Circle), so indexes above are sufficient; no partitioning/read replicas for MVP.

## 4. Migration Policy

- Drizzle Kit generates SQL migrations; every migration is committed with the change that required it.
- Migrations run automatically on deploy (and manually with a documented command otherwise); they are
  reviewed like code, especially anything touching `circle_members`, `conversation_participants`, or
  ownership-transfer invariants.
- Integration tests run against a **PostgreSQL service container in GitHub Actions** (`services: postgres`) — no external database dependency or CI secret required for tests.
- Neon branching remains an optional extra for preview environments; it is not required for CI.
- Schema changes that remove `circle_settings.status_text` or `polls.allow_multiple` must include the
  corresponding migration and constraint/index updates; no compatibility column should be silently kept.
