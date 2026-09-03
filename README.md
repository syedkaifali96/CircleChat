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

**M0–M5 complete (docs approved, audit-approved milestones, all suites green).**

Latest verification: server 170/170 tests (Vitest, real PostgreSQL), mobile 33/33 tests (Jest + RNTL), typecheck 0 errors, lint clean.

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
| M6 — Realtime (typing, presence) | ⬜ Not started |
| M7 — Media (chat media upload/download, voice) | ⬜ Not started |
| M8+ — Notifications, Circle Home, Pinboard, Polls, App Lock | ⬜ Not started |

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
