# CircleChat — Architecture

> Status: **Proposed — awaiting approval.** This document is the technical source of truth for
> how CircleChat is built. Product behavior comes from `docs/PRODUCT_SPEC.md`.

---

## 1. Guiding Constraints

Every architectural decision below is driven by these constraints, in priority order:

1. **Privacy** — username-only identity (no phone/email), minimal data collection, no message content exposed outside a Circle.
2. **Security** — all authorization enforced server-side; the 5-member Circle limit is not bypassable by any client.
3. **Simplicity** — smallest set of moving parts that implements the MVP; no microservices, no Kubernetes, no premature E2EE.
4. **Low cost** — free/cheap tiers during development; the 2–5 member model means tiny scale by design.
5. **AI-agent maintainability** — one language (TypeScript) end-to-end, boring well-documented tools, small reviewable modules.

---

## 2. Recommended Stack (with reasoning)

### 2.1 Mobile app — **React Native + Expo + TypeScript (Android first)**

- The MVP experience is mobile-first by definition: App Lock/biometrics, voice messages, camera, push notifications.
- **Expo** gives managed native modules (`expo-secure-store`, `expo-local-authentication`, `expo-av`, `expo-notifications`) so a beginner never touches native build files for MVP features.
- **Expo Router** provides file-based navigation that matches the screen list in the spec (Splash → Welcome → … → Circle Home).
- **Android first**: Android APK/AAB via **EAS Build** requires no Mac; iOS can be added later with the same codebase.
- A web/PWA client is **explicitly out of scope for MVP** — it would double the UI surface area. The API is client-agnostic, so a web client remains a later option.
- Alternatives considered: **Flutter** (excellent, but splits the codebase into a second language/ecosystem — worse for one-person + AI-agent maintenance); **PWA-first** (biometric app lock, push, and voice recording are unreliable on iOS PWAs).

### 2.2 Backend — **Node.js 22 LTS + Fastify (TypeScript)**

- **Fastify** is small, extremely well documented, schema-validation-first, and produces compact, reviewable modules — ideal for AI-agent development.
- One process serves both the **REST API** and the **Socket.IO** realtime server. No service mesh, no queues for MVP (an in-process async job queue is enough at this scale).
- Alternatives considered and rejected for MVP:
  - **Supabase/Firebase as the whole backend** — both are excellent BaaS platforms, but their auth systems are email/phone-centric. CircleChat requires *username-only* accounts with *recovery-code* reset, which means custom auth code regardless. Fighting a hosted auth provider's assumptions (synthetic emails, disabled confirmations, admin-API workarounds) creates more confusion than it removes, and row-level-security policies are exactly the kind of security-critical code the Build Plan says requires the most careful review. The DB/storage layers of Supabase remain viable *a la carte* (see 2.3/2.6).
  - **NestJS** — good framework, but heavy boilerplate for this size; Fastify is easier for a beginner to read end-to-end.

### 2.3 Database — **PostgreSQL + Drizzle ORM**

- The domain is relational (users ↔ circles ↔ messages ↔ reactions/polls) — PostgreSQL fits naturally and the spec already proposes relational tables.
- **Drizzle ORM**: typed schema-as-code, plain SQL visibility, simple generated SQL migrations, no heavy client runtime. AI agents read and write Drizzle schemas reliably.
- **Hosting (dev/prod): Neon** free tier (serverless Postgres, branching for test databases). Alternatives: Supabase Postgres, Railway Postgres.

### 2.4 Authentication — **custom username + password (Argon2id) + opaque session tokens**

- Sign up with `username` + `password` only. Display name and avatar are separate profile fields.
- Passwords hashed with **Argon2id** (OWASP parameters) using the `@node-rs/argon2` library. No custom crypto.
- Sessions: 256-bit random opaque token, stored **hashed** (SHA-256) in the `sessions` table; the client keeps the raw token in **Expo SecureStore** and sends it as `Authorization: Bearer`. Sessions are revocable per device (see `docs/SECURITY.md`).
- Password recovery via **recovery code** generated at signup (shown once, stored hashed). No email/SMS anywhere in the flow.
- JWTs are deliberately **not** used for MVP: JWTs cannot be revoked cleanly, and "revoke this device" is a stated product requirement.

### 2.5 Realtime — **Socket.IO**

- Rooms map 1:1 to the domain: `circle:{circleId}`, `user:{userId}`, and presence tracked per user.
- Socket.IO gives battle-tested reconnection, heartbeat, and room semantics instead of hand-rolled WebSocket code.
- Socket connections authenticate with the same session token (handshake middleware) and **join a room only after a server-side membership check**.
- Events are **notifications, not data sources**: clients always fetch message history via REST; realtime events just say "something changed". This avoids consistency drift and makes offline recovery trivial.

### 2.6 Media storage — **Cloudflare R2 (S3-compatible) + presigned URLs**

- Private bucket; clients upload/download via **short-lived presigned URLs** issued by the API after authorization checks. The bucket is never public.
- R2 free tier (10 GB storage, **zero egress fees**) suits a media-heavy messenger; media bandwidth is the main future cost driver for this product.
- Upload flow is direct client→R2 (the API never proxies file bytes), which keeps the backend cheap and simple.
- Alternatives: Supabase Storage (fine, smaller free tier), Backblaze B2 (cheap, egress fees), S3 (egress-expensive).

### 2.7 Push notifications — **Expo Push**

- One integration (`expo-server-sdk`) that abstracts **FCM (Android)** and **APNs (iOS)**. Device push tokens are stored in the `sessions/devices` table.
- Per-Circle mute and "hide message preview" (privacy) are enforced **server-side** when constructing push payloads.

### 2.8 App Lock — **local-only layer (never a server concept)**

- PIN (salted hash stored in `expo-secure-store`) and/or biometrics (`expo-local-authentication`).
- Fully local: the server never knows whether App Lock is enabled (see §8).

### 2.9 Testing — **Vitest (server) + Jest/RNTL (app)**

- Server: unit tests (validation, permissions, poll logic) + integration tests via `fastify.inject` against a real Postgres (Neon branch or local).
- App: component tests with React Native Testing Library.
- E2E (device): **Maestro** flows deferred to the hardening milestone — manual test checklist until then.

### 2.10 Deployment — **Railway (server) + Neon (Postgres) + R2 + EAS Build**

- Free-tier friendly during development; ~$5/month class when always-on hosting is needed (see `docs/DEPLOYMENT.md`).
- Render/Fly.io are documented as alternatives; Render's free tier sleeps and would break socket connections, so it is not the default.

---

## 3. High-Level System Diagram

```text
┌───────────────────────────┐
│   Expo mobile app (TS)    │
│  Android (iOS later)      │
└─────────┬─────────────────┘
          │ HTTPS (REST, JSON)      │ WSS (Socket.IO)
          ▼                         ▼
┌─────────────────────────────────────────────────┐
│        Fastify server (Node 22, TypeScript)     │
│  ┌──────────────┐  ┌──────────────────────────┐ │
│  │ REST API     │  │ Socket.IO gateway        │ │
│  │ (auth, circles,  │ │ (auth handshake, rooms,  │ │
│  │  messages,    │  │  message/typing/presence │ │
│  │  polls, media │  │  events, membership      │ │
│  │  signing…)    │  │  checks on every join)   │ │
│  └──────┬───────┘  └───────────┬──────────────┘ │
│         │      in-process async jobs            │
│         │  (push sending, thumbnail bookkeeping)│
└─────────┼───────────────────┼──────────────────┘
          ▼                   ▼
   ┌────────────┐      ┌──────────────┐     ┌──────────────┐
   │ PostgreSQL │      │ Cloudflare R2│     │ Expo Push    │
   │ (Neon)     │      │ private      │     │ → FCM / APNs │
   │ Drizzle ORM│      │ presigned    │     └──────────────┘
   └────────────┘      └──────────────┘
```

---

## 4. Frontend Architecture (Expo app)

- **Expo Router** with a route group per area:
  - `(auth)` — splash, welcome, username, password, recovery-code display, profile setup
  - `(onboarding)` — create/join Circle, invite, App Lock setup
  - `(app)` — home (Circles list), Circle Home, chat, members, pinboard, polls, settings
- **State**: lightweight server-cache pattern (React Query) for REST data; Socket.IO events invalidate/update the cache. No global Redux-style store — the app is small.
- **Design system first** (per Build Plan Phase 2, detailed in `design.md`): colors (`#7C3AED` primary on `#0B0714`), Inter, radius tokens, buttons/inputs/bubbles/avatars built as shared components **before** screens.
- **Secure storage only** for the session token, App-Lock PIN hash, and recovery-code-acknowledged flag. Never `AsyncStorage` for secrets.
- Offline behavior (MVP): optimistic send for text with a local outbox; media uploads require connectivity; failed sends are retried or marked failed in the UI.

## 5. Backend Architecture (Fastify server)

```text
apps/server/src/
├── index.ts            # entry: builds Fastify, registers plugins, starts HTTP+WS
├── config.ts           # env parsing (zod), no secret defaults
├── db/                 # Drizzle schema, migrations, query helpers
├── plugins/            # auth (session validation), rate-limit, error handler
├── modules/
│   ├── auth/           # signup, login, logout, recovery-code reset, sessions
│   ├── users/          # profile, username availability
│   ├── circles/        # create/join/invite/leave/roles/settings/5-limit
│   ├── conversations/  # direct + circle conversation resolution, read state
│   ├── messages/       # send/list/edit/delete/react
│   ├── media/          # upload intent → presigned URL, confirm, access check
│   ├── polls/          # create/vote/close
│   ├── pinboard/       # pin/unpin/list
│   └── notifications/  # device tokens, per-circle prefs, push dispatch
├── realtime/           # Socket.IO auth, room joins, event publishing
└── jobs/               # in-process async queue (push sending, cleanup)
```

Rules that hold everywhere:

- **Every** route: `authenticate → authorize → validate (zod) → execute`. Authorization helpers live in one module and are unit-tested, never inlined per route.
- Errors: central error handler returns stable error codes (`AUTH_REQUIRED`, `NOT_A_MEMBER`, `CIRCLE_FULL`, `RATE_LIMITED`, …) with generic messages; stack traces never leave the server.
- Logging: `pino`, structured, **no message content, usernames are allowed, no tokens** in logs.

## 6. Authentication Flow

```text
Signup                          Login
──────                          ─────
username + password             username + password
  ↓                               ↓
validate (regex, uniqueness,      ↓ rate-limited
password policy)                verify Argon2id hash
  ↓                               ↓
hash password (Argon2id)        create session row
generate recovery code            (token = 256-bit random;
hash recovery code                store SHA-256(token))
  ↓                               ↓
create user + session           return raw token → client
  ↓                             stores in SecureStore
return token + recovery code
(shown exactly once)            Every request:
                                Authorization: Bearer <token>
Recovery reset                    ↓ server: token → SHA-256 →
────────────────                    sessions lookup (unexpired,
username + recovery code            not revoked) → attach user
  ↓
rate-limited hard               Logout:
verify recovery-code hash       revoke that session row;
  ↓                             client deletes token from
set new Argon2id password       SecureStore
  ↓
revoke ALL sessions for user
issue NEW recovery code
```

Key properties:

- One active session per device row; users can see and revoke devices (product requirement).
- Recovery-code use rotates the code and kills every session — a stolen recovery code cannot silently coexist with the owner.
- No email/phone exists in the system, so there is nothing to leak via notification services or forgot-password flows. Losing **both** password and recovery code means the account is unrecoverable — this is the spec's explicit trade-off and it is stated in the UI at signup.

## 7. Authorization Model

The single most important rule: **the client renders UI; the server decides access.**

```text
Request → authenticated? → for circle-scoped resources:
            is caller a circle_member? → what role? → is the action allowed for that role?
```

| Resource | Who can access |
|---|---|
| Private conversation messages | Exactly the two participants (server resolves the direct conversation; others get `NOT_A_MEMBER` with no existence confirmation) |
| Circle messages / members / polls / pinboard / media / settings | Active `circle_members` of that circle |
| Circle settings edit, invite create/revoke, member remove | `owner` or `admin` |
| Circle delete, ownership transfer | `owner` only |
| Own profile, own sessions, own notifications | That user only |

- Direct 1-to-1 conversations are a distinct conversation type — **not** 2-member Circles — so Circle tooling (polls, pinboard) can never leak into private chats.
- The **5-member limit** is enforced inside the join transaction (conditional insert + unique constraint + trigger — full detail in `docs/DATABASE.md` §3.3), never by counting in the client.
- Membership checks always look at the database at request time; nothing is cached client-side in a way the server trusts.

### Preventing unauthorized Circle data access (explicit checklist)

1. REST: every circle-scoped handler calls the shared `requireCircleMember(circleId, userId, minRole?)` guard **before** any data read.
2. Realtime: `socket.join("circle:{id}")` happens only after the same guard; the guard is re-checked on every event the socket emits (send/react/typing), not just at connect time.
3. Media: presigned download URLs are issued **only** after a membership check; URLs expire in ~60 seconds; bucket is private.
4. Push payloads: recipient list is computed from `circle_members`; users who muted a Circle get a silent/omitted payload; previews honor per-user privacy setting.
5. Database: queries are always scoped (`WHERE circle_id = $1 AND user_id = $2`); there are no "get all messages" style endpoints; no raw SQL string building.
6. IDs are UUIDs (non-enumerable); error responses do not reveal whether a resource exists to non-members.

## 8. Realtime Messaging Flow

```text
Send (client)                Server                          Other members
────────────                 ──────                          ─────────────
POST /messages ────────────▶ authorize membership
(socket may be down;          validate (zod)
REST is source of truth)      insert message row
                              publish to Socket.IO rooms ───▶ `message:new` event
                              enqueue push job (async) ─────▶ Expo Push → FCM
◀──── 201 + message JSON
```

- **Events**: `message:new`, `message:updated` (edit), `message:deleted`, `reaction:changed`, `typing:start/stop`, `presence`, `read:update`, `circle:updated` (name/theme/avatar), `member:joined/left`.
- **Typing/presence** are ephemeral (in-memory only) — never persisted.
- **Read states** are per-user, per-conversation (`last_read_message_id`) — persisted so unread counts survive restarts.
- **Reconnect**: client re-fetches `/messages?after=<lastId>` for each open conversation; missed events are recovered from REST, not replayed from sockets.
- **Multiple devices**: each device gets its own socket; events fan out to `user:{id}` rooms so all of a user's devices stay in sync.
- The server never trusts a client-claimed `circleId` on an event; the event payload's target is re-authorized server-side.

## 9. Media Upload Flow

```text
1. Client: POST /media/upload-intent {kind, size, mimeType, context}
2. Server: authorize (member of circle / participant) → validate size cap + MIME allowlist
   → INSERT media row (status='pending') → return {mediaId, presigned PUT URL (5 min)}
3. Client: PUT file bytes directly to R2
4. Client: POST /media/{id}/confirm
5. Server: HEAD the object → verify size + sniff content type (magic bytes) matches allowlist
   → status='ready'
6. Client: POST /messages {conversationId, mediaId, …}  → message references ready media
```

- Upload caps (MVP): images 10 MB, videos 50 MB, voice 10 MB, avatars 2 MB. Client-side compression before upload where the platform allows.
- Downloads: `GET /media/{id}/url` → membership check → 60-second presigned GET URL. Clients cache by `mediaId+version`.
- Only ready media can be attached to messages; orphaned `pending` media rows are cleaned up by a daily job (cost + hygiene).

## 10. Notification Flow

```text
message inserted (REST or realtime path)
  ↓ async job (never blocks the sender's response)
resolve conversation → members − sender
  ↓ per recipient: check per-circle mute, quiet hours (later), preview-privacy setting
load device push tokens from sessions/devices
  ↓
Expo Push API (receipts checked for errors; invalid tokens pruned)
```

- Notification payloads contain **at most**: circle/conversation name, sender display name, and (only if previews enabled) a truncated text. Media messages say "📷 Photo" — media is never inlined in push.
- The in-app `notifications` table records mentionable events (poll created, member joined) for the Activity view; pure message pushes are not persisted as rows.

## 11. App-Lock Architecture (local only)

```text
App start / resume (AppState → active)
  ↓
lock enabled? (secure store) ──no──▶ normal app
  ↓ yes
last-unlock timestamp vs chosen policy (immediately / 1 min / 5 min / on leave)
  ↓ expired
Lock screen → biometrics (expo-local-authentication) if enrolled, else PIN
  ↓ PIN path: salted hash compare (hash stored in SecureStore, salt in SecureStore)
unlock → record timestamp
```

- The server never stores or sees App-Lock state; losing the PIN ≠ losing the account. "Forgot PIN" clears App Lock and forces re-login against the server (session token remains valid server-side until revoked or expired — documented trade-off).
- Privacy screens (`expo-screen-capture` prevention / blur on background) are part of this layer.

---

## 12. What Is Deliberately NOT in the MVP Architecture

- E2EE (single- and multi-device), key management, encrypted media — future, properly planned work.
- GIF/sticker providers, shared memories, events, mood check-ins, circle status — V2 (spec).
- Message search, disappearing messages — V2 (spec).
- Web/PWA client, CDN in front of media, horizontal scaling, message queues, separate push worker service.
