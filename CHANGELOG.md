# CircleChat — Changelog

## Unreleased

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
