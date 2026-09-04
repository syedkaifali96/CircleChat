# CircleChat — Changelog

## Unreleased

### M6 — Realtime Typing + Presence

- Realtime (docs/API.md Realtime): `typing:start`/`typing:stop` (client → server) with per-user/per-conversation rate limiting (~30/10s) and server-side TTL auto-expiry (~6s without refresh) broadcasting `typing:update`; presence derived from live connections — first socket broadcasts `presence:online` to authorized rooms, the LAST disconnect stamps `users.last_seen_at` and broadcasts `presence:offline`. Revoked sessions disconnect (M2 hooks) and take the user offline.
- Authorization: conversation-scoped fan-out only — typing/presence events reach room members whose access was re-checked server-side; REST `GET /v1/users/:id/presence` follows the D1 rule (self, ≥1 shared active Circle, or an existing direct conversation; otherwise a generic 404 so existence never leaks).
- Storage decision: typing is in-memory per socket-server process (ephemeral, never persisted — Redis only if multi-node arrives, post-MVP); presence needs no new migration (`is_online` is derived, `users.last_seen_at` existed since M1).
- Mobile (Expo): shared `socket.io-client` singleton (session-token handshake, reconnect with room-join replay), chat-screen typing indicator ("X is typing…"), composer typing signals with ~3s idle auto-stop, direct-chat header online/last-seen indicator, listener cleanup on unmount.
- Tests: 11 server tests over real Socket.IO + PostgreSQL (typing broadcast scoping, non-member rejection, TTL expiry, rate limiting, online/offline lifecycle, multi-device counting, last_seen_at persistence, REST presence authorized/unauthorized/DM cases, revocation) + 6 mobile tests (typing debounce, indicator rendering, presence header, cleanup).

### M5 — Direct + Circle Messaging

- Server (docs/API.md contract): POST /v1/conversations/direct (find-or-create, both users must share ≥1 active Circle — D1; existence hidden behind generic 404; duplicates return the same conversation), GET /v1/conversations (caller-scoped circles + directs with last message preview + server-computed unread), POST /v1/conversations/:id/read (server-side read pointer; stale pointers never regress), PATCH /v1/conversations/:id/notification-pref (caller-only upsert).
- Messages (docs/DATABASE.md §1.7–1.8): POST /v1/conversations/:id/messages (text-only, idempotent via (conversation_id, sender_id, client_message_id) — concurrent duplicates resolve to one row), GET keyset-paginated history (newest-first, ≤50/page, no OFFSET), PATCH /v1/messages/:id (sender-only, ≤24h window, tombstones never editable), DELETE /v1/messages/:id (sender, or Circle owner/admin for member messages; direct non-senders rejected; tombstone keeps the row but body/media are never exposed again), PUT/DELETE /v1/messages/:id/reactions (server-validated emoji set; one per user/emoji/message).
- Realtime (minimal, docs/ARCHITECTURE.md §8): conversation rooms with server-side access re-check on every join; message:new, message:updated, message:deleted, reaction:changed, read:update change notifications after committed DB writes; REST remains the source of truth. Typing/presence stay deferred to M6.
- Database: migration 0003 adds conversation_participants.last_read_message_id (FK → messages, ON DELETE SET NULL); unread = messages newer than the pointer (missing row/NULL = all unread).
- Mobile (Expo): Chats list (circle + direct rows, last-message preview, unread badges, loading/empty/error states, private-chat start by username), conversation screen (header with circle/direct identity, MessageBubble with own/incoming styles, sender name, reply preview, edited marker, tombstones, reaction chips), composer (text-only; attachment control intentionally inert until M7), keyset pagination upward, long-press actions (react/copy/edit-within-24h/permission-gated delete), read marking on open.
- Tests: 31 server tests (direct rules incl. duplicate + existence hiding, idempotent + concurrent sends, reply validation, keyset pagination, edit window, tombstone + delete permissions, reactions, read pointers, prefs, revoked sessions) + 6 realtime tests (authorized join, non-member rejection, all five events, revocation disconnect) + 11 mobile tests (bubble states, chats list, private-chat start, send flow, permission-gated actions).

### M4 — Circles

- Server (docs/API.md contract): create/list/get/update/delete Circle (soft delete, owner-only), multi-use capacity-limited expiring revocable invites (CSPRNG codes shown once; only SHA-256 hashes stored, normalized so typed codes match), join with the layered 5-member enforcement (FOR UPDATE row lock + conditional insert + BEFORE INSERT trigger + CHECK — a documented concurrent-join test proves 10 racing joins yield exactly 4 successes and a 5-member cap), leave (owner must transfer first), owner/admin member removal, owner-only role changes, atomic ownership transfer, per-Circle settings, Circle Home payload.
- Server: invite-preview endpoint (public; limited pre-join fields + short-TTL presigned avatar URL; members never exposed).
- Mobile (Expo): Home with Circle cards + empty/loading/error states, Create Circle, Join Circle (code → preview → confirm), Circle Home (members, role badges, invite modal with one-time code + revoke, role menu, transfer, leave), Circle Settings (rename, owner-only delete). API client extended for circles.
- Tests: 22 server tests (create, invite lifecycle incl. hash-only storage + expiry bounds, join/preview, sixth-join rejection, concurrent joins never exceeding 5 members, owner-leave block, removal/role rules, atomic transfer, cross-circle lockout, revoked sessions) + 9 mobile tests.

### M3 Follow-up — Authorized media download endpoint

- Implemented the documented GET /v1/media/:id/url: authenticated, READY-avatar-only, avatar-visibility rule enforced (self or >=1 shared active Circle with the avatar owner) BEFORE the short-TTL presigned GET is issued; generic 404 on every failure (existence not leaked); Cache-Control no-store; storage keys/credentials never in responses. Deleted Circles lose access. In-memory gateway download URLs are opaque tokens (mirroring R2). 12 integration tests.

### M3 — Profiles

- Server (docs/API.md contract): PATCH /v1/users/me (displayName/bio, explicit update schema, username immutable), POST /v1/users/me/avatar (own READY avatar media only), GET /v1/users/:username (minimal profile: display name + avatar; viewer rule = self or ≥1 shared active Circle, existence hidden), GET /v1/users/me/avatar-url (short-TTL presigned GET for the caller's avatar).
- Media lifecycle (docs/ARCHITECTURE.md §9): POST /v1/media/upload-intent (avatar kind, MIME allowlist, 2 MB cap, non-guessable storage key, presigned POST with pinned Content-Type + content-length-range) and POST /v1/media/:id/confirm (HEAD + size re-check + magic-byte sniff via file-type; failures delete the pending row). Private R2 gateway via S3 API; in-memory gateway for tests; profile/media routes only registered when storage is configured.
- Privacy: shared-cache protection (Cache-Control: no-store on all private profile responses), avatar access requires minimal-profile view permission, no sensitive fields in any response.
- Mobile (Expo): profile screen (avatar placeholder/upload, display name, username read-only, bio, empty states), edit flow (validation, saving state, success/back), avatar picker via expo-image-picker with the full intent→direct-upload→confirm→assign flow; AuthContext gains updateUser so /users/me stays the single identity source.
- Tests: 15 new server integration tests (upload lifecycle, ownership, viewer rules, secret leakage, no-store headers, revoked sessions) + 5 mobile profile tests.

### M2 Follow-up — Revoked-session socket disconnect

- Closed the SECURITY.md §3 gap: change-password, revoke-all-other-sessions and recovery-reset now disconnect the live Socket.IO connections of every revoked session (logout and single-session revoke already did). Revocation helpers return the revoked session IDs; the DB revocation stays authoritative and socket disconnect happens after it, outside the transaction.
- Tests: real Socket.IO clients prove other-session sockets die while the current one survives (change-password, revoke-all), and that recovery-reset disconnects every socket; route-level tests prove the exact revoked session IDs are passed (never the current session's).

### M2 — Authentication

- Server (Fastify + Argon2id + opaque session tokens), implementing docs/API.md exactly:
  - POST /v1/auth/signup → 201 with token, one-time recovery code, user; rate-limited 5/hour.
  - POST /v1/auth/login → token + user; generic INVALID_CREDENTIALS, timing-equalized unknown-username verification, per-username lockout guard (5 failures → 15 min), rate-limited 10/min.
  - POST /v1/auth/change-password (auth) → verifies current password, rehashes, revokes all other sessions; current session stays valid.
  - POST /v1/auth/recovery-reset → verifies recovery-code hash, rotates the code, revokes ALL sessions.
  - POST /v1/auth/logout (auth) → revokes the current session.
  - GET /v1/auth/sessions (auth) with current flag; DELETE /v1/auth/sessions/:id (own only, foreign → 404); DELETE /v1/auth/sessions → revoke all others.
  - GET /v1/users/me (auth) for session bootstrap; GET /v1/users/username-available (rate-limited).
- Security: Argon2id (OWASP baseline, single constant), 256-bit CSPRNG tokens stored as SHA-256 hashes with timing-safe comparison, sliding 30-day expiry, passwords/recovery codes/tokens never logged (logger redact list extended), stable error codes with app-authored messages only.
- Realtime foundation: Socket.IO handshake requires a valid session token; per-session rooms; session revocation force-disconnects that session's sockets. No product events (M5).
- requireAuth opt-in preHandler (config.auth: true); identity derived exclusively from the validated bearer token.
- Mobile (Expo): AuthProvider bootstrap (secure token restore → server validation → authenticated/login routing), login, registration, one-time recovery-code screen, authenticated home placeholder with logout; session token stored only in expo-secure-store; typed API client with stable error surfacing.
- Tests: 80 server (unit: crypto/tokens/guard/config; integration: full auth flows, rate limiting, expiry/revocation, secret-leak prevention) + 8 mobile — all against real PostgreSQL.

### M1 Final Fixes (post-implementation audit)

- Wired Drizzle relations into the runtime schema object (`client.ts` now passes tables + relations; added `db/index.ts` barrel) — relational queries (`db.query.*`) are fully functional and covered by behavioral tests.
- Closed the poll-vote update-path loophole: new trigger (migration `0002_poll_vote_integrity`) rejects options updates that would invalidate existing votes (`POLL_OPTIONS_INVALIDATE_VOTES`); safe updates (question, closes_at, options changes that keep votes valid) remain allowed.
- Circle-capacity concurrency documented with evidence: a deterministic test proves the `FOR UPDATE` circle-row lock serializes competing joins (the trigger is the independent single-writer guard, not the serialization mechanism).

### M1 — Database Foundation

- Drizzle schema for all 15 documented tables (users, sessions, media, circles, circle_members, circle_settings, conversations, conversation_participants, messages, message_reactions, polls, poll_votes, pinboard_items, notifications, conversation_notification_prefs).
- Migrations `0000_m1_schema` (tables/FKs/checks/indexes) and `0001_m1_invariants` (avatar FKs breaking the users/circles↔media cycle; 5-member capacity trigger with `CIRCLE_FULL`; members_count sync; direct-conversation two-participant guard; polls-on-Circle-conversations guard; poll-vote option bound).
- PostgreSQL-level enforcement: username format + case-insensitive uniqueness, one-owner partial unique index, idempotent sends via `(conversation_id, sender_id, client_message_id)`, hashed-only invite storage, keyset pagination indexes, partial unread index.
- Database client foundation (`createDatabase`) — intentionally not wired into the app runtime until M2.
- PostgreSQL integration tests (35) running against a real database: constraint/trigger behavior, cascades, rollback patterns, index presence; hermetic local runs via embedded PostgreSQL (UTF-8), CI via the PostgreSQL 16 service container.

### M0 — Foundation / Scaffold

- npm-workspaces monorepo (`packages/shared`, `apps/server`, `apps/mobile`) with root scripts: `dev:server`, `dev:mobile`, `typecheck`, `lint`, `test`, `build`, `db:generate`, `db:migrate`.
- Strict TypeScript foundation (root base config + per-workspace configs).
- `apps/server`: Fastify 5 bootstrap with Zod-validated env config, secret-redacting pino logging, stable error codes, `GET /health`, Socket.IO attachment (foundation only), clean startup/shutdown; Vitest tests (health, 404 shape, config).
- `packages/shared`: minimal health-status helper shared by server/client; Zod configured for future use; Vitest test.
- `apps/mobile`: Expo SDK 53 + Expo Router scaffold with a single design-token-styled landing screen; jest-expo + React Native Testing Library render test.
- Drizzle wiring only: `drizzle.config.ts` + intentionally empty `src/db/schema.ts` (schema and migrations are M1).
- GitHub Actions CI: lint → typecheck → test → build, with an infrastructure-only PostgreSQL 16 service container for M1+ integration tests.
- `.env.example` placeholders (no real secrets); `.gitignore` excludes `.env` / `.env.*`.

### Documentation Gate

- Finalized the approved technical stack in `docs/ARCHITECTURE.md`.
- Aligned direct-message authorization around `conversation_participants` and the approved shared-Circle DM policy.
- Documented multi-use, expiring, revocable, capacity-limited invites and invite preview.
- Added documentation for change-password session revocation and atomic Circle ownership transfer.
- Clarified notification preferences, avatar access, presigned-upload constraints, GIF upload behavior, socket revocation/rate limits, presence visibility, and accepted username-enumeration risk.
- Removed `circle_settings.status_text` and `polls.allow_multiple` from the documented MVP schema.
- Marked desktop/tablet layouts as post-MVP and standardized profile terminology on `bio`.
- Documented PostgreSQL GitHub Actions service-container integration testing.

No application code or MVP implementation was added by this documentation gate.
