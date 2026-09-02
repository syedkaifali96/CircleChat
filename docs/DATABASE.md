# CircleChat — Database Design

> Status: **Proposed — awaiting approval.** PostgreSQL 16, accessed via Drizzle ORM.
> This document is conceptual-but-concrete: names, types, constraints and indexes are the
> intended implementation. Physical tuning happens during implementation.

Conventions: UUID primary keys (`gen_random_uuid()`), `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`,
snake_case names, soft deletes only where specified. All timestamps are UTC.

---

## 0. Entity Overview

```text
users ──< sessions/devices
users ──< circle_members >── circles ─── circle_settings (1:1)
                              circles ─── pinboard_items
users ──< conversations (as participants) >── conversations
conversations ──< messages ──< message_reactions
conversations ──< polls ──< poll_votes
messages/media ─── media
users ──< notifications
```

**Design decision (needs approval):** a `conversations` table is introduced on top of the
tables listed in the spec. Reason: the product has **two conversation types** (Circle group chat
and private 1-to-1 chat) and both need messages, reactions, read states and typing. Modeling
both as `conversations` (type `circle` or `direct`) keeps `messages`, reactions and read-state
logic unified, while `conversations.type` and the absence of Circle features for `direct`
conversations keep the two product concepts distinct. Private chats are **not** modeled as
2-member Circles.

---

## 1. Tables

### 1.1 `users`

Purpose: an account. Identity is username-only — no email/phone columns exist.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `username` | TEXT UNIQUE NOT NULL | stored lowercase; `^[a-z0-9_]{3,20}$`; case-insensitive uniqueness enforced via unique index on lower(username) |
| `display_name` | TEXT NOT NULL | shown in UI, 1–40 chars |
| `password_hash` | TEXT NOT NULL | Argon2id string (PHC format) |
| `recovery_code_hash` | TEXT NOT NULL | Argon2id hash of the recovery code |
| `bio` | TEXT NULL | optional, ≤ 200 chars |
| `avatar_media_id` | UUID NULL → `media.id` | profile picture |
| `last_seen_at` | TIMESTAMPTZ NULL | updated at most every 60s (presence) |
| `created_at` | TIMESTAMPTZ NOT NULL | |

Relationships: 1→N sessions, circle_members, messages; 1→N media (owner).
Indexes: `UNIQUE (lower(username))`. Reserved usernames blocked in app logic (`admin`, `circlechat`, `support`, …).
No PII beyond what the user typed. No email/phone/contact fields by design.

### 1.2 `circles`

Purpose: a private group of 2–5 members.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `name` | TEXT NOT NULL | 1–40 chars |
| `description` | TEXT NULL | optional |
| `avatar_media_id` | UUID NULL → `media.id` | |
| `created_by` | UUID NOT NULL → `users.id` | initial owner |
| `members_count` | SMALLINT NOT NULL DEFAULT 1 | **denormalized counter maintained by trigger**; enables cheap limit checks and display; kept consistent transactionally |
| `invite_code_hash` | TEXT UNIQUE NULL | SHA-256 hash of the active invite code (raw code never stored); NULL when invites disabled/expired |
| `invite_expires_at` | TIMESTAMPTZ NULL | |
| `created_at` | TIMESTAMPTZ NOT NULL | |
| `deleted_at` | TIMESTAMPTZ NULL | soft delete so "circle was deleted" can be shown gracefully |

Relationships: 1→1 `circle_settings`; 1→N `circle_members`, conversations (type=circle), pinboard_items.
Indexes: `UNIQUE (invite_code_hash)` (partial where not null).

### 1.3 `circle_members`

Purpose: membership + role in a Circle; **the authorization table**.

| Field | Type | Notes |
|---|---|---|
| `circle_id` | UUID, FK → `circles.id` ON DELETE CASCADE | composite PK part 1 |
| `user_id` | UUID, FK → `users.id` ON DELETE CASCADE | composite PK part 2 |
| `role` | TEXT NOT NULL CHECK (`role IN ('owner','admin','member')`) | exactly one `owner` per circle (partial unique index) |
| `joined_at` | TIMESTAMPTZ NOT NULL | |

Primary key: `(circle_id, user_id)` — a user can never be in a circle twice.
Additional index: `(user_id)` for "my circles" queries.

**Server-side 5-member limit (must never be client-enforced only).** Joining runs in one
transaction using **all three layers**:

1. **Conditional insert** (primary guard):
   ```sql
   INSERT INTO circle_members (circle_id, user_id, role)
   SELECT $circleId, $userId, 'member'
   WHERE (SELECT members_count FROM circles WHERE id = $circleId FOR UPDATE) < 5;
   ```
   `FOR UPDATE` locks the circle row so two concurrent joins cannot both pass the check.
2. **Trigger** `trg_circle_members_guard`: `BEFORE INSERT` re-counts `circle_members` and raises
   an exception at 5; also maintains `circles.members_count` on insert/delete (belt-and-braces
   against any code path bypassing the helper).
3. **`CHECK (members_count <= 5)`** on `circles` — final declarative guarantee.

Creating a circle inserts the owner as the first member (count = 1), so a Circle can have 1
member only in the window between creation and the first invite — the *joinable* state of any
circle is always 2–5.

### 1.4 `circle_settings`

Purpose: Circle identity/customization (spec: name/avatar/theme/accent/background + per-circle behavior).

| Field | Type | Notes |
|---|---|---|
| `circle_id` | UUID PK, FK → `circles.id` ON DELETE CASCADE | 1:1 |
| `theme_preset` | TEXT NOT NULL DEFAULT 'dark_purple' | one of app-defined presets |
| `accent_color` | TEXT NULL | validated `#RRGGBB`, nullable |
| `background_key` | TEXT NULL | reference to bundled background asset |
| `status_text` | TEXT NULL | Circle status (V2 field, kept nullable) |
| `updated_at` | TIMESTAMPTZ NOT NULL | |

Editable by `owner`/`admin` only (enforced in API, not DB).

### 1.5 `conversations`

Purpose: unifies the two conversation types for messaging.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `type` | TEXT NOT NULL CHECK (`type IN ('circle','direct')`) | |
| `circle_id` | UUID NULL → `circles.id` ON DELETE CASCADE | NOT NULL when type='circle'; **partial unique index** (one circle-conversation per circle) |
| `direct_key` | TEXT NULL UNIQUE | for type='direct': `sorted(userA,userB)` UUID pair string; prevents duplicate private chats |
| `created_at` | TIMESTAMPTZ NOT NULL | |
| `last_message_at` | TIMESTAMPTZ NULL | denormalized for chat-list ordering |

Constraints: `CHECK ((type='circle' AND circle_id IS NOT NULL AND direct_key IS NULL) OR (type='direct' AND direct_key IS NOT NULL AND circle_id IS NULL))`.
Membership for `direct` conversations = the two users encoded in `direct_key` (parsed and re-verified server-side on every access; additionally enforced by a `conversation_participants` helper view/table during implementation if parsing proves error-prone — final decision at implementation).

### 1.6 `messages`

Purpose: chat messages for both conversation types.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `conversation_id` | UUID NOT NULL → `conversations.id` ON DELETE CASCADE | |
| `sender_id` | UUID NOT NULL → `users.id` | |
| `type` | TEXT NOT NULL CHECK (`type IN ('text','image','video','voice','file')`) | MVP set |
| `body` | TEXT NULL | text content; ≤ 4000 chars; NULL for pure-media messages |
| `media_id` | UUID NULL → `media.id` | NOT NULL when type ≠ text |
| `reply_to_id` | UUID NULL → `messages.id` | reply threading (1 level, no deep threads) |
| `edited_at` | TIMESTAMPTZ NULL | edit allowed to sender only, within 24h window (product rule) |
| `deleted_at` | TIMESTAMPTZ NULL | soft delete → tombstone ("message deleted") for other members |
| `created_at` | TIMESTAMPTZ NOT NULL | ordering clock |

Indexes:
- `(conversation_id, created_at DESC, id)` — history pagination + stable ordering.
- `(conversation_id, last-message lookup)` partial index `WHERE deleted_at IS NULL`.
- `ON DELETE` for reply_to: `SET NULL` (a deleted message does not cascade-delete replies).

### 1.7 `message_reactions`

Purpose: emoji reactions on messages.

| Field | Type | Notes |
|---|---|---|
| `message_id` | UUID, FK → `messages.id` ON DELETE CASCADE | composite PK part 1 |
| `user_id` | UUID, FK → `users.id` ON DELETE CASCADE | composite PK part 2 |
| `emoji` | TEXT NOT NULL | composite PK part 3; restricted to a server-defined emoji set |
| `created_at` | TIMESTAMPTZ NOT NULL | |

PK `(message_id, user_id, emoji)` — a user may add several different emoji but never the same one twice.

### 1.8 `media`

Purpose: metadata for uploaded files (bytes live in R2, never in the DB).

| Field | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `owner_id` | UUID NOT NULL → `users.id` | uploader |
| `conversation_id` | UUID NULL → `conversations.id` | access scope for chat media |
| `kind` | TEXT NOT NULL CHECK (`kind IN ('image','video','voice','file','avatar')`) | |
| `mime_type` | TEXT NOT NULL | server-sniffed, from allowlist only |
| `size_bytes` | BIGINT NOT NULL CHECK (`size_bytes > 0`) | re-verified at confirm |
| `storage_key` | TEXT NOT NULL UNIQUE | R2 object key (`media/{uuid}/{kind}/{random}` — non-guessable) |
| `status` | TEXT NOT NULL CHECK (`status IN ('pending','ready','deleted')`) | lifecycle (§9 of ARCHITECTURE) |
| `width`/`height` | INTEGER NULL | images/videos |
| `duration_ms` | INTEGER NULL | voice/video |
| `created_at` | TIMESTAMPTZ NOT NULL | |

Indexes: `(conversation_id)` for gallery queries; `(owner_id, status)` for cleanup jobs.
Access rule: downloadable by the owner, or by a member of the linked conversation (server checks at presign time).

### 1.9 `sessions` (devices)

Purpose: one row per logged-in device; revocable; also holds push tokens.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | UUID NOT NULL → `users.id` ON DELETE CASCADE | |
| `token_hash` | TEXT NOT NULL UNIQUE | SHA-256 of the opaque session token (raw token never stored) |
| `device_name` | TEXT NOT NULL | e.g. "Kaif's Pixel" |
| `platform` | TEXT NOT NULL CHECK (`platform IN ('android','ios','other')`) | |
| `push_token` | TEXT NULL | Expo push token for this device |
| `created_at` | TIMESTAMPTZ NOT NULL | |
| `last_active_at` | TIMESTAMPTZ NOT NULL | refreshed on use (throttled) |
| `expires_at` | TIMESTAMPTZ NOT NULL | 30 days, sliding |
| `revoked_at` | TIMESTAMPTZ NULL | set on logout/revoke/"log out everywhere" |

Indexes: `(user_id)` for device list; `UNIQUE (token_hash)` is the login lookup.
Cleanup job removes expired/revoked rows older than 30 days.

### 1.10 `notifications`

Purpose: in-app activity log (Activity tab) + record of push delivery decisions.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | UUID NOT NULL → `users.id` ON DELETE CASCADE | recipient |
| `type` | TEXT NOT NULL | `poll_created`, `member_joined`, `poll_closed`, … (not per-message) |
| `actor_id` | UUID NULL → `users.id` | who caused it |
| `circle_id` | UUID NULL → `circles.id` ON DELETE CASCADE | context |
| `payload` | JSONB NOT NULL DEFAULT '{}' | small display data (names, poll question) — **no message bodies** |
| `read_at` | TIMESTAMPTZ NULL | |
| `created_at` | TIMESTAMPTZ NOT NULL | |

Index: `(user_id, created_at DESC)`; partial unread index `WHERE read_at IS NULL`.
Per-device push state (mutes, preview privacy) lives on `sessions` + a `circle_members.notification_pref` column (`'all' | 'mentions' | 'muted'`, default `'all'`).

### 1.11 `polls`

Purpose: simple Circle polls (MVP feature; Circle-only — `direct` conversations cannot have polls).

| Field | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `conversation_id` | UUID NOT NULL → `conversations.id` ON DELETE CASCADE | must be type='circle' (API-enforced + trigger check) |
| `created_by` | UUID NOT NULL → `users.id` | |
| `question` | TEXT NOT NULL | ≤ 300 chars |
| `options` | JSONB NOT NULL | array of 2–6 strings, `CHECK (jsonb_array_length(options) BETWEEN 2 AND 6)`, each ≤ 80 chars |
| `allow_multiple` | BOOLEAN NOT NULL DEFAULT false | MVP: false (single choice) |
| `closes_at` | TIMESTAMPTZ NULL | optional deadline |
| `created_at` | TIMESTAMPTZ NOT NULL | |

Index: `(conversation_id, created_at DESC)`.

### 1.12 `poll_votes`

Purpose: one member's vote on a poll.

| Field | Type | Notes |
|---|---|---|
| `poll_id` | UUID, FK → `polls.id` ON DELETE CASCADE | composite PK part 1 |
| `user_id` | UUID, FK → `users.id` ON DELETE CASCADE | composite PK part 2 |
| `option_index` | SMALLINT NOT NULL CHECK (`option_index >= 0 AND option_index < 6`) | exact bound (2–6) re-validated against `polls.options` in the vote transaction |
| `created_at` | TIMESTAMPTZ NOT NULL | |

PK `(poll_id, user_id)` — **one vote per user** guaranteed by the primary key; vote changes
allowed while poll is open (delete + insert in one transaction). Results visible to members;
anonymous vote contents are never exposed, only tallies (product can decide to show who voted what later — V2).

### 1.13 `pinboard_items` (addition, MVP feature per spec)

| Field | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `circle_id` | UUID NOT NULL → `circles.id` ON DELETE CASCADE | |
| `created_by` | UUID NOT NULL → `users.id` | |
| `content` | TEXT NOT NULL | ≤ 1000 chars (text pins in MVP) |
| `pinned_at` | TIMESTAMPTZ NOT NULL | |
| `order_index` | INTEGER NOT NULL DEFAULT 0 | manual ordering |

Index: `(circle_id, pinned_at DESC)`.

---

## 2. Future Tables (V2 — named now, built later)

`memories`, `events`, `moods`, `circle_status_history`, `saved_messages` — see Build Plan §9.
They will follow the same conventions; nothing in the MVP schema blocks them.

## 3. Integrity & Performance Notes

- **No cascading message deletion** from circles: a soft-deleted Circle keeps message rows for a defined grace period so members see a clear state; hard purge is a later, explicit decision.
- All writes that span tables (join circle, vote, edit message) run in **transactions** with row locks on the contested parent row (`circles`, `polls`).
- Pagination everywhere (`keyset` on `(created_at, id)`), no OFFSET scans.
- Expected scale is tiny (≤ 5 members/circle), so indexes above are sufficient; no partitioning, no read replicas for MVP.

## 4. Migration Policy

- Drizzle Kit generates SQL migrations; every migration is committed with the change that required it.
- Migrations run automatically on deploy (and manually with a documented command otherwise); they are reviewed like code — especially anything touching `circle_members`.
- Neon branching gives every PR/test run an isolated database copy.
