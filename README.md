# CircleChat

> **Your little private world.**

CircleChat is a privacy-focused messenger designed for **small private Circles of 2–5 people**.

It combines private 1-to-1 conversations with private Circle group spaces, personalization and lightweight social features.

## Product Direction

CircleChat is intentionally **not a WhatsApp clone**. The Circle itself is the core product experience.

### Conversation Types

- **Private Chat:** 1-to-1 conversation between two members.
- **Circle Chat:** private group conversation for a maximum of 5 members.

### Core MVP

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

Technical foundation (proposed — awaiting approval):

- [Architecture](docs/ARCHITECTURE.md)
- [Database Design](docs/DATABASE.md)
- [Security Design](docs/SECURITY.md)
- [API Design](docs/API.md)
- [Deployment Plan](docs/DEPLOYMENT.md)

Rules for AI coding agents: [AGENTS.md](AGENTS.md)

## Tech Stack (proposed — pending approval)

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

## Repository Layout (planned)

```text
circlechat/
├── apps/
│   ├── mobile/          # Expo (React Native) app — the CircleChat client
│   └── server/          # Fastify API + Socket.IO realtime server
├── packages/
│   └── shared/          # Shared TypeScript types, Zod schemas, constants
├── docs/                # All project documentation (source of truth)
├── design.md            # Design system & UX specification
├── .github/workflows/   # CI: typecheck, lint, tests
├── AGENTS.md            # AI coding-agent rules
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

🚧 **Phase 0 — Architecture & Foundation.** No application code exists yet.

| Milestone | Status |
|---|---|
| Product specification | ✅ Done |
| Design system & UX specification | ✅ Done (`design.md`) |
| Repository audit | ✅ Done |
| Architecture, database, security, API, deployment docs | ✅ Proposed — awaiting approval |
| Phase 1 implementation | ⛔ Awaiting explicit approval |
