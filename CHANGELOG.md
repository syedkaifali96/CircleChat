# CircleChat — Changelog

## Unreleased

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
