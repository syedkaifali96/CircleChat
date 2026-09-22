# AGENTS.md — Rules for AI Coding Agents

This file is the operating manual for any AI agent (or human) writing code in this repository.
Read it fully before changing anything. When this file conflicts with a code review comment,
the comment wins and this file should be updated.

---

## 1. Project Context (read first, in this order)

1. `docs/CircleChat_Product_Specification.md` — **product source of truth**. What we build and, more importantly, what we do NOT build.
2. `docs/CircleChat_AI_Build_Plan.md` — development workflow: small milestones, review gates, AI usage rules.
3. `design.md` — design system & UX specification: tokens, components, screen structures, states, accessibility.
4. `docs/ARCHITECTURE.md` — system design and the reasoning behind the stack.
5. `docs/DATABASE.md` — schema, constraints, migration policy.
6. `docs/SECURITY.md` — security model. Sections 5 and 7 are non-negotiable.
7. `docs/API.md` — endpoint contracts.

## 2. Tech Stack (do not change without explicit owner approval)

- **Mobile**: React Native + Expo (SDK 52+), TypeScript, Expo Router.
- **Server**: Node.js 22+, Fastify, TypeScript, Socket.IO, Drizzle ORM, PostgreSQL.
- **Shared**: npm workspaces monorepo, Zod for validation, shared types in `packages/shared`.
- **Testing**: Vitest (server), Jest + React Native Testing Library (app).

## 3. Hard Rules (violations will be rejected)

1. **Do not add features that are not in the product spec.** No WhatsApp cloning. No E2EE, no stories, no channels, no AI features in MVP code.
2. **All authorization is server-side.** Every REST handler and every socket event must pass the shared membership/role guards (`requireAuth`, `requireCircleMember`, `requireConversationAccess`) before touching data. Never trust client-sent user IDs, roles, or member counts.
3. **The 5-member Circle limit** is enforced by the transactional insert + trigger + CHECK described in `docs/DATABASE.md` §1.3. Never replace it with a client-side or count-in-code check.
4. **No custom cryptography.** Argon2id for password/recovery/PIN hashing, `crypto.randomBytes` for tokens, that's it. Never invent encoding schemes, "encryption", or hash combinations.
5. **Never log or return**: passwords, raw session tokens, recovery codes, message bodies (in logs/push). Generic error messages only (`INVALID_CREDENTIALS`); no stack traces to clients.
6. **No secrets in the repo.** `.env` is ignored; new config goes in `.env.example` with empty values and a Zod entry.
7. **Uploads are never trusted**: MIME allowlist + size caps + magic-byte sniff on confirm, private bucket + presigned URLs only.
8. **Private 1-to-1 chats are a separate conversation type** (`direct`), never 2-member Circles, and never get Circle features (polls/pinboard).

## 4. Repository Layout

```text
apps/mobile/     Expo app: app/ (routes), src/ (components, features, lib)
apps/server/     Fastify server: src/modules/<domain>/ (routes, service, tests colocated)
packages/shared/ Zod schemas + TS types shared by both apps
docs/            All documentation — update docs when behavior changes
```

- Domain code lives in `modules/<domain>`; cross-domain logic goes through service functions, not by reaching into another module's internals.
- One route file per resource group; handlers stay thin (guard → validate → service → respond).

## 5. Coding Conventions

- TypeScript strict mode everywhere; `any` requires a comment justifying it.
- Naming: files `kebab-case.ts` (server) / `PascalCase.tsx` for components; variables camelCase; DB snake_case per `docs/DATABASE.md`.
- Validation: every API input is a Zod schema; reuse schemas from `packages/shared` when both sides need them.
- Comments explain **constraints and decisions**, not what the next line does. No "Added for X ticket" noise.
- Errors: throw typed app errors → central handler → stable codes (`docs/API.md`). Never `catch` and swallow.
- Commits: conventional commits (`feat:`, `fix:`, `test:`, `refactor:`, `docs:`) — small, one concern per commit.

## 6. UI Rules (Expo app)

- Design tokens only (full token/component definitions in `design.md`): warm-hearth palette per `design.md` §4 and `apps/mobile/src/design/tokens.ts` (primary `#F59E0B` amber, `#161311` canvas, warm surfaces, coral accent) with Inter font and the documented radii. No hardcoded hex values in screens.
- Every UI feature must pass the `design.md` §43 acceptance checklist (states, accessibility, responsive, no new UI libraries).
- Reuse the shared component library (Button, Input, Card, MessageBubble, Avatar, Modal). Building a screen with raw primitives instead of the library is a bug.
- Subtle animations only (fade/scale ≤ 200ms); no over-animation.
- Message actions appear on long-press, never as permanent row buttons. Composer stays clean; attachments live behind the `+` button.
- Every screen needs: loading state, empty state, error state. All user-facing strings go through the strings file (i18n-ready even if English-only for MVP).
- Responsive within phones/tablets; no landscape-only layouts.

## 7. Testing Rules

- Server: every module ships with unit tests (validation, permissions, edge cases) and integration tests via `fastify.inject` + a test database. The permission tests are mandatory for anything circle-scoped: **non-member rejected, member allowed, role limits enforced, 5-member limit enforced (including concurrent joins)**.
- App: components with logic get RNTL tests; pure UI screens need at least render + interaction smoke tests.
- Realtime code: test reconnect, duplicate events, out-of-order delivery (mock socket).
- Never weaken or delete a failing test to make a suite pass — fix the code or explain in the PR why the test was wrong.
- Run everything before committing (see §8).

## 8. Commands (run from repo root)

```bash
npm install                # workspaces install
npm run dev:server         # API + socket server with reload
npm run dev:mobile         # Expo dev server
npm run typecheck          # all workspaces
npm run lint               # eslint
npm run test               # unit + integration (needs TEST_DATABASE_URL)
npm run db:migrate         # apply Drizzle migrations
npm run db:generate        # generate migration from schema changes
```

(These scripts are created in milestone M0; if one is missing, the milestone isn't done.)

## 9. What NOT To Touch Without Asking

- `docs/PRODUCT_SPEC.md` — product decisions belong to the owner.
- Auth/session/recovery logic (`modules/auth`) — changes require an explicit security-review pass in the PR description.
- Database migrations touching `circle_members` or permissions.
- CI workflow, deployment configs, any file containing credentials.
- The milestone order in `docs/BUILD_PLAN.md`.

## 10. Working Style

- One milestone (or one feature within a milestone) per change set. Do not "helpfully" refactor beyond the task.
- Before changing files, inspect the current architecture and reuse what exists.
- When a spec ambiguity blocks you, stop and ask — do not guess product behavior. Technical choices within an approved design are yours to make; product choices are not.
- After each milestone: tests pass → self-review the diff → update the relevant doc if behavior changed → commit.
