# CircleChat

> **Your little private world.**

CircleChat is a privacy-focused messenger designed for **small private Circles of 2–5 people**.

It combines private 1-to-1 conversations with private Circle group spaces, personalization and lightweight social features.

## Product Direction

CircleChat is intentionally **not a WhatsApp clone**. The Circle itself is the core product experience.

### Conversation Types

- **Private Chat:** 1-to-1 conversation between two members.
- **Circle Chat:** private group conversation for a maximum of 5 members.

### Core MVP — target scope (progress tracked in Status below)

- Username/password accounts
- Recovery code
- Profiles
- Create/join/invite Circles
- 5-member Circle limit
- Private 1-to-1 chat
- Circle group chat
- Text and media messaging
- Voice messages
- Reactions and replies
- Edit/delete messages
- Circle Home
- Pinboard
- Polls
- Circle customization
- App lock
- Session/device management
- Notification controls

## Current Capabilities (implemented through M9)

What actually ships today, verified by the test suites referenced below:

- **Authentication:** username/password accounts, recovery codes, session/device management with revocation (revoked sessions also disconnect live sockets)
- **Profiles:** display name, bio, avatars via private R2 storage with authorized presigned access
- **Circles:** create/join via multi-use expiring revocable invites, roles (owner/admin/member), ownership transfer, server-enforced 5-member limit (transaction + trigger + CHECK)
- **Messaging:** Direct (requires a shared active Circle) and Circle text chats with idempotent sends, keyset-paginated history, reactions, replies, 24-hour sender-only edits, sender/admin tombstone deletes, read state and unread counts
- **Realtime:** typing indicators (server-side TTL expiry) and online/offline presence with last-seen timestamps
- **Media messaging:** images, video, voice messages (2-minute server-enforced limit) via presigned uploads to private R2 with magic-byte verification; image thumbnails (400px) served alongside originals
- **GIF search:** via **GIPHY**, called directly from the client per GIPHY's API terms (proxying prohibited), with the "Powered By GIPHY" attribution in the picker
- **Push notifications:** server-authoritative Expo Push fan-out after every persisted message — per-user global toggle, per-conversation mute, message-preview privacy, multi-device support (devices = sessions), invalid-token cleanup, and notification-tap deep links; provider failures never affect messaging
- **Circle Home:** a private dashboard per Circle — identity header (avatar, name, description, member count), members preview with roles, the primary Open Chat action carrying the server-computed unread count, and management actions (invites, role changes, settings) — served by GET /v1/circles/:id/home, active members only

## Documentation

Product & design sources of truth:

- [Product Specification](docs/CircleChat_Product_Specification.md)
- [Design System & UX Specification](design.md)
- [AI-Assisted Development Plan](docs/CircleChat_AI_Build_Plan.md)

Technical foundation (approved and implemented through M5):

- [Architecture](docs/ARCHITECTURE.md)
- [Database Design](docs/DATABASE.md)
- [Security Design](docs/SECURITY.md)
- [API Design](docs/API.md)
- [Deployment Plan](docs/DEPLOYMENT.md)

Rules for AI coding agents: [AGENTS.md](AGENTS.md)

## Tech Stack (approved)

| Layer | Choice |
|---|---|
| Mobile app | **React Native + Expo (TypeScript), Expo Router** — Android first, iOS later |
| Backend | **Node.js 22+ / Fastify (TypeScript)** — REST API |
| Realtime | **Socket.IO** — messages, typing, presence, read states |
| Database | **PostgreSQL + Drizzle ORM** |
| Auth | Custom **username + password** (Argon2id) + opaque session tokens + recovery codes |
| Media storage | **Cloudflare R2** (S3-compatible, private bucket, signed URLs) |
| Push notifications | **Expo Push** (abstracts FCM / APNs) |
| App lock | Local-only layer: `expo-local-authentication` + `expo-secure-store` |
| Testing | **Vitest** (backend), **Jest + React Native Testing Library** (app) |
| Deployment | Backend on Railway, Postgres on Neon, EAS Build for the Android app |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the reasoning behind each choice.

## Repository Layout

```text
circlechat/
├── apps/
│   ├── mobile/          # Expo (React Native) app — auth, profiles, circles, chats
│   └── server/          # Fastify API + Socket.IO (auth, profiles, circles, messaging, realtime)
├── packages/
│   └── shared/          # Shared TypeScript types, Zod schemas, constants
├── docs/                # All project documentation (source of truth)
├── .github/workflows/   # CI: lint, typecheck, tests, build (+ Postgres service for M1+)
├── AGENTS.md            # AI coding-agent rules
├── design.md            # Design system & UX specification
└── README.md
```

## Development Principle

Build the product incrementally:

```text
Plan → Implement → Test → Review → Security Check → Document → Commit
```

Do not build the entire application as one large AI-generated task.

1. **The spec is law.** Product behavior comes from `docs/CircleChat_Product_Specification.md`. Do not add features that are not in the spec.
2. **Small milestones.** Build in the order defined in `docs/CircleChat_AI_Build_Plan.md`. One feature per milestone.
3. **Server-side security.** All authorization (especially the 5-member Circle limit and message access) is enforced on the server. The UI hiding things is never enough.
4. **No crypto inventions.** Use established libraries (Argon2, CSPRNG, TLS). No E2EE claims in the MVP.
5. **Honest privacy.** Never claim "100% secure" or "perfect privacy".
6. **Collect minimum data.** No phone numbers, no contacts, no location, no ads.

## Privacy Philosophy

CircleChat should collect the minimum information necessary to provide the service. Security and privacy claims must remain realistic and verifiable.

## Status

**M0–M9 complete (all suites green).**

Latest verification: server 215/215 tests (Vitest, real PostgreSQL), mobile 75/75 tests (Jest + RNTL), typecheck 0 errors, lint clean. Real Android device smoke (physical device via Expo Go + local server): launch, signup/auth, API connection, notification settings UI and global-toggle persistence PASS. Actual remote push delivery and push-tap navigation are **not yet device-verified** — they require a development build with EAS/FCM configuration plus `EXPO_ACCESS_TOKEN` (Expo Go on Android since SDK 53 provides no remote push capability).

| Milestone | Status |
|---|---|
| Product specification, design system, build plan | ✅ Done |
| Architecture, database, security, API, deployment docs | ✅ Done (audit-approved) |
| M0 — Foundation / scaffold (monorepo, server, mobile, CI) | ✅ Done |
| M1 — Database schema, migrations, invariants, integration tests | ✅ Done |
| M2 — Authentication (server + mobile) | ✅ Done |
| M3 — Profiles (server + mobile, avatar media) | ✅ Done |
| M4 — Circles (create/join/invites/roles/5-member limit, server + mobile) | ✅ Done |
| M5 — Direct + Circle text messaging (idempotent sends, history, reactions, read state, realtime events) | ✅ Done |
| M6 — Realtime typing + presence (TTL expiry, last-seen, multi-device) | ✅ Done |
| M7 — Media messaging (presigned uploads, images/video/voice, confirmed-upload gate) | ✅ Done |
| M7.1 — Image thumbnails (sharp) + GIF search (GIPHY client-side) | ✅ Done |
| M8 — Push notifications (Expo Push, server-authoritative fan-out, per-conversation mute, preview privacy) | ✅ Done |
| M9 — Circle Home (identity + members preview + Open Chat with unread, single authorized payload) | ✅ Done |
| M10+ — Pinboard, Polls, Themes, App Lock | ⬜ Not started |

## Getting Started

Requires Node.js 22+. Local integration tests additionally use PostgreSQL 16
(`TEST_DATABASE_URL`) — without it the server suite starts an ephemeral
embedded PostgreSQL automatically where supported.

```bash
npm install          # install all workspaces
npm run dev:server   # Fastify API + Socket.IO on http://localhost:3000 (GET /health)
npm run dev:mobile   # Expo dev server (press a for Android)
npm run typecheck    # all workspaces
npm run lint         # eslint
npm run test         # server + shared + mobile tests
npm run build        # build all workspaces (shared dist, server dist, mobile export)
```

`apps/server/src/db/schema.ts` implements the approved schema (docs/DATABASE.md);
migrations live in `apps/server/drizzle/` and are applied to a fresh database by
the integration tests. `npm run db:generate` / `npm run db:migrate` manage them.
Copy `.env.example` to `.env` for local configuration — never commit real values.

## Environment Variables

**Server** (`.env` at repo root, from `.env.example`; all real values gitignored):

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (required in production) |
| `NODE_ENV`, `PORT`, `LOG_LEVEL` | Server runtime basics |
| `SESSION_TTL_DAYS` | Session lifetime (default 30) |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PRESIGN_TTL_SECONDS` | Private Cloudflare R2 storage (profile avatars + chat media) |

**Mobile** (`apps/mobile/.env`, from `apps/mobile/.env.example` — Expo inlines
`EXPO_PUBLIC_*` values into the bundle, so these are never secrets):

| Variable | Purpose |
|---|---|
| `EXPO_PUBLIC_API_URL` | Server base URL |
| `EXPO_PUBLIC_GIPHY_API_KEY` | GIPHY app key for GIF search. Goes in `apps/mobile/.env` (gitignored), NOT `.env.example`. Get a beta key at developers.giphy.com. Dev keys are rate-limited to ~42 requests/hour; a production-tier key requires submitting the app to GIPHY for review once the "Powered By GIPHY" attribution is live in the app. |

## Known Limitations

- Typing/presence state is single-process in-memory; a multi-node deployment would need a shared store (Redis).
- Presence is only shown for the direct-chat partner; no group-wide online indicator.
- Video thumbnails are not generated (frame extraction needs ffmpeg-scale native tooling).
- No real Android emulator/device UI pass yet — realtime and media behavior were verified server-side with real Socket.IO clients plus automated suites.
