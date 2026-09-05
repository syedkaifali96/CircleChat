# CircleChat — Architecture

> Status: **Approved technical direction — implementation must follow this document.** This document is the
> technical source of truth for how CircleChat is built. Product behavior comes from
> `docs/CircleChat_Product_Specification.md` and UX/design behavior from `design.md`.
>
> **Stack rule:** this document contains the final approved technical stack for MVP. AI agents must not
> substitute React web/PWA, Flutter, a different backend framework, a different database/ORM, managed auth,
> custom realtime infrastructure, or another storage/auth approach without explicit owner approval.

---

## 1. Guiding Constraints

1. **Privacy** — username-only identity, minimal data collection, no message content exposed outside authorized participants/Circle members.
2. **Security** — all authorization enforced server-side; the 5-member Circle limit is not bypassable by a client.
3. **Simplicity** — smallest set of moving parts for MVP; no microservices, Kubernetes, or premature E2EE.
4. **Low cost** — free/cheap tiers during development; the 2–5 member model means tiny scale by design.
5. **AI-agent maintainability** — one language (TypeScript) end-to-end and small reviewable modules.

---

## 2. Final Approved Stack

### 2.1 Mobile app — **React Native + Expo + TypeScript (Android first)**

- MVP is mobile-first: App Lock/biometrics, voice messages, camera and push notifications.
- Expo provides managed native modules such as SecureStore, LocalAuthentication, audio and notifications.
- Expo Router provides file-based navigation.
- Android first; iOS later from the same codebase.
- Web/PWA is post-MVP and must not be introduced during MVP implementation.

### 2.2 Backend — **Node.js 22 LTS + Fastify + TypeScript**

- One process serves REST and Socket.IO.
- No service mesh, separate realtime service, or queue infrastructure for MVP.
- An in-process async job queue is sufficient at this scale.

### 2.3 Database — **PostgreSQL 16 + Drizzle ORM**

- Relational domain: users, Circles, participants, messages, reactions, media, polls and notifications.
- Neon is the default development/production Postgres host; Supabase Postgres/Railway Postgres remain alternatives only if explicitly approved.

### 2.4 Authentication — **custom username + password (Argon2id) + opaque session tokens**

- Signup uses username + password only.
- Passwords and recovery codes use Argon2id via a vetted library.
- Sessions use 32 random bytes, stored only as SHA-256 hashes; raw tokens are held in Expo SecureStore.
- Authorization uses `Authorization: Bearer <session token>`.
- JWT is not used for MVP because sessions must be revocable per device.
- Username is fixed after account creation in MVP.
- Account deletion is post-MVP; no deletion flow is implemented in MVP.

### 2.5 Realtime — **Socket.IO**

- Rooms map to domain concepts: `circle:{circleId}`, `user:{userId}` and conversation-specific rooms as needed.
- The same session token authenticates the handshake.
- Server-side participant/member authorization is required before room joins and on every relevant event.
- Events are notifications, not the source of truth; clients recover state through REST.
- **Session revocation must disconnect live sockets associated with that session.** A revoked session cannot continue receiving or emitting authorized events.
- Socket event rate limits are required for message send, typing, joins and other abuse-sensitive events; limits are documented/tuned with the API security policy.

### 2.6 Media storage — **Cloudflare R2 + presigned URLs**

- Private bucket; clients upload/download through short-lived presigned URLs.
- Uploads go directly client → R2; the API does not proxy file bytes.
- Presigned PUTs must bind the intended `Content-Type` and enforce a content-length range matching the media kind.
- Server confirmation still performs size and magic-byte checks before media becomes `ready`.
- Chat media, profile avatars, Circle avatars and invite-preview avatars have separate authorization rules.
- GIF files may be uploaded as `image/gif` when allowed by the image upload path. A GIF picker/provider remains V2.

### 2.7 Push notifications — **Expo Push**

- Expo Push abstracts FCM/APNs.
- Push tokens are associated with sessions/devices.
- Global and per-conversation notification preferences are evaluated server-side before payload construction.
- Muted conversations suppress normal notification delivery; mention behavior applies where applicable; message previews honor privacy settings.

### 2.8 App Lock — **local-only**

- PIN and/or biometrics use platform APIs.
- PIN verification uses the documented local salted Argon2id approach and SecureStore.
- The server never stores App-Lock state.

### 2.9 Testing — **Vitest (server) + Jest/RNTL (app)**

- Server unit/integration tests cover authorization, 5-member concurrency, direct participants, authentication, media and notification decisions.
- Integration tests use a real PostgreSQL database.
- App tests use React Native Testing Library.
- Maestro device flows are deferred to hardening.

### 2.10 Deployment — **Railway (server) + Neon (Postgres) + R2 + EAS Build**

- Free/low-cost development tiers are the default.
- Railway is the default server host; Neon is the default database host; R2 stores private media; EAS builds Android/iOS artifacts.
- WebSocket connection timeout/keepalive behavior must be verified against the chosen Railway deployment configuration.
- Neon connection pooling/cold-start behavior should be considered when configuring the server.

---

## 3. High-Level System Diagram

```text
┌───────────────────────────┐
│   Expo mobile app (TS)    │
│  Android (iOS later)      │
└─────────┬─────────────────┘
          │ HTTPS (REST)             │ WSS (Socket.IO)
          ▼                          ▼
┌─────────────────────────────────────────────────┐
│        Fastify server (Node 22, TypeScript)     │
│  REST API + Socket.IO + in-process async jobs   │
└──────────────┬──────────────────┬───────────────┘
               ▼                  ▼
        ┌────────────┐     ┌──────────────┐     ┌──────────────┐
        │ PostgreSQL │     │ Cloudflare R2│     │ Expo Push    │
        │   (Neon)   │     │    private   │     │ → FCM / APNs │
        │ Drizzle ORM│     │   presigned  │     └──────────────┘
        └────────────┘     └──────────────┘
```

---

## 4. Frontend Architecture (Expo app)

- Expo Router route groups:
  - `(auth)` — welcome, signup/signin, recovery code, profile setup
  - `(onboarding)` — create/join Circle, invite, App Lock setup
  - `(app)` — Home, Circle Home, chats, members, pinboard, polls, settings
- React Query-style server cache for REST data; Socket.IO events invalidate/update cache.
- No Redux-style global store for MVP.
- Design tokens/components from `design.md` are the UI source of truth.
- SecureStore is used for session token, App-Lock data and recovery-code acknowledgement. Never AsyncStorage for secrets.
- Text messaging can use an optimistic local outbox; media uploads require connectivity.

---

## 5. Backend Architecture (Fastify server)

```text
apps/server/src/
├── index.ts
├── config.ts
├── db/                 # Drizzle schema, migrations, query helpers
├── plugins/            # auth, rate-limit, error handler
├── modules/
│   ├── auth/           # signup, login, change-password, logout, recovery, sessions
│   ├── users/          # profile, username availability
│   ├── circles/        # create/join/invite/leave/roles/settings/ownership/5-limit
│   ├── conversations/  # direct + Circle resolution, participants, read state
│   ├── messages/       # send/list/edit/delete/react
│   ├── media/          # upload intent, confirm, access checks
│   ├── polls/          # create/vote/close
│   ├── pinboard/       # pin/unpin/list
│   └── notifications/  # device tokens, preferences, push dispatch
├── realtime/           # Socket.IO auth, rooms, event publishing/rate limits
└── jobs/               # in-process async jobs and cleanup
```

Rules everywhere:

- `authenticate → authorize → validate (Zod) → execute`.
- Shared authorization helpers are unit-tested; do not inline ad-hoc permission logic in routes.
- Direct conversation authorization uses `conversation_participants`; never parse `direct_key` for authorization.
- Stable error codes include `AUTH_REQUIRED`, `NOT_A_MEMBER`, `CIRCLE_FULL`, `RATE_LIMITED`, etc.
- Logs never contain passwords, raw tokens, recovery codes or message bodies.

---

## 6. Authentication Flow

```text
Signup/Login
username + password
      ↓
validate + rate limit
      ↓
Argon2id password verify/hash
      ↓
create/retrieve session
      ↓
raw 256-bit token → SecureStore
      ↓
Authorization: Bearer <token>
```

Recovery uses the one-time recovery code, rotates the recovery code and revokes all sessions.

Change-password uses the current authenticated session, sets the new password, and revokes **all other sessions**. The current session may remain active after a successful password change.

Losing both password and recovery code means the account is unrecoverable by design. Account deletion is deferred to post-MVP.

---

## 7. Authorization Model

The client renders UI; the server decides access.

| Resource | Who can access |
|---|---|
| Direct conversation | Exactly the two rows in `conversation_participants` |
| Circle messages/members/polls/pinboard/media/settings | Active `circle_members` |
| Circle settings, invite management, member removal | Owner/admin as specified by API |
| Circle deletion/ownership transfer | Owner only |
| Own profile/sessions/notifications | Caller only |

Direct-chat creation additionally requires the two users to share at least one active Circle. Once created,
the direct conversation remains separate from Circles and never gains Circle features.

The 5-member limit is enforced in the database transaction, not by the client.

### Media authorization

1. Chat media: authorized participant/member of the linked conversation.
2. Profile avatar: only where the requesting user is allowed to view the user's minimal profile; avatar media is not a global bypass.
3. Circle avatar: active members of that Circle.
4. Invite-preview Circle avatar: only for a valid, active, non-expired invite-preview request and only with limited pre-join preview data.

### Realtime authorization

- Authenticate socket handshake with the session token.
- Authorize conversation access before room join.
- Re-check participant/Circle membership on every relevant send/react/typing/read event.
- Disconnect sockets immediately when their backing session is revoked.
- Apply per-session/user socket event rate limits.

---

## 8. Realtime Messaging Flow

```text
POST /v1/conversations/:id/messages
              ↓
     authenticate + authorize
              ↓
 validate + idempotency check
              ↓
        insert message
              ↓
 publish Socket.IO notification
              ↓
 enqueue push notification job
```

- `clientMessageId` makes retries idempotent within `(conversation_id, sender_id, client_message_id)`.
- Events are change notifications, not durable data.
- Typing state is ephemeral and held **in-memory per socket-server process** (no Redis in the MVP;
  multi-node deployments would need a shared store — post-MVP). It auto-expires server-side ~6s
  after the last refresh, even without an explicit stop from the client.
- Presence is derived from live connections: a user is online while ≥1 authorized socket exists.
  The only persisted piece is `users.last_seen_at`, stamped when the user's LAST socket disconnects
  (no `is_online` column — a persisted boolean would drift from reality on crash/restart).
- Read state is persisted.
- On reconnect, the client fetches missed messages through REST and replays its room joins
  (the server re-checks access on every join).
- Presence visibility: Circle members may see one another's presence; direct-chat presence is visible only to the two participants. No global presence directory.

---

## 9. Media Upload Flow

```text
1. Client: POST /v1/conversations/:id/media/upload-url (M7 chat media)
       or POST /v1/media/upload-intent (M3 avatars)
2. Server: authorize (sender of this conversation) → validate kind/MIME/size/duration
3. Server: return presigned POST with pinned Content-Type + content-length-range
4. Client: PUT bytes directly to private R2
5. Client: POST /v1/media/:id/confirm
6. Server: HEAD + size + magic-byte verification → ready
7. Client: send message referencing ready media (idempotent clientMessageId)
```

Upload caps remain: images 10 MB, videos 50 MB, voice 10 MB, avatars 2 MB.
M7 adds a 2-minute server-enforced ceiling on declared voice duration.

Only ready media can be attached to messages — a message referencing pending
or foreign media is rejected, so no participant ever sees unrenderable media.
Downloads use short-TTL presigned GET URLs after an explicit access check
(conversation media: D1 conversation rule; avatars: profile-visibility rule).
M7.1 adds `?variant=thumb` — chat images generate a max-400px JPEG thumbnail
(server-side, sharp) on confirm, stored as `<storage-key>-thumb` in the same
private bucket; generation is best-effort and a failure falls back to the
original image without failing the upload. Video thumbnails need frame
extraction (ffmpeg or similar) and are deferred.

GIF search provider: **GIPHY** (M7.1a — replaces Tenor, discontinued by
Google). GIPHY's API terms explicitly prohibit proxying their API or media
loads, so search runs **directly from the mobile client**
(`EXPO_PUBLIC_GIPHY_API_KEY` ships in the app config; the key is public by
GIPHY's own design — never placed in server env or committed). The server's
only GIF role is accepting external-GIF messages (`type='gif'` + https
`external_url` on a `kind='gif'` media row — no storage round-trip); message
visibility remains D1-gated. Compliance rules honored: the "Powered By
GIPHY" attribution mark is always shown with search results, results are
rendered exactly as returned (no reordering/filtering), and no other
provider is mixed into the same grid. Dev-tier keys are heavily
rate-limited (~42 req/hour) — the UI surfaces 429s as "try again shortly".
Production key: submit the app to GIPHY for review once attribution is live
(manual owner step).

Storage provider: Cloudflare R2 (S3-compatible) via presigned POST/GET; the
in-memory gateway mirrors the interface for tests. GIF files may also use the
image upload path as `image/gif`. Bundled sticker packs remain V2.

---

## 10. Notification Flow

```text
message/activity occurs
      ↓
resolve recipients
      ↓
apply global + per-conversation preferences
      ↓
apply muted/mention/preview rules
      ↓
construct minimal push payload
      ↓
Expo Push
```

Server-side notification construction must honor global notification enable/disable, per-conversation enabled/disabled,
muted state, mentions where applicable, and message-preview privacy.

Push delivery is best-effort (implemented M8): it runs strictly after persistence and realtime
fan-out, and any provider failure is logged and swallowed — messaging never depends on it.
Without `EXPO_ACCESS_TOKEN` the server runs a no-op gateway, so local dev and tests need no
Expo account, and clients in push-less environments degrade to an "unavailable" state instead
of failing.
Push devices are sessions: Expo tokens live on `sessions.push_token`, registering a token moves
it off the user's other sessions, and revoked sessions are never notified.

---

## 11. App-Lock Architecture (local only)

```text
App start/resume → lock policy check → biometrics or PIN → unlock
```

The server never knows App-Lock state. The lock is a local privacy convenience layer, not server security.

---

## 12. CI / Integration Testing

GitHub Actions should use a **PostgreSQL service container** for server integration tests where appropriate.
The CI job should start PostgreSQL, apply Drizzle migrations, run integration tests, and destroy the disposable database after the job.
This keeps database authorization and transaction tests reproducible without using production data.

---

## 13. What Is Deliberately NOT in the MVP Architecture

- E2EE, custom cryptography or encrypted-media key management.
- Web/PWA client and desktop/tablet-first implementation; desktop/tablet layouts are post-MVP design scope.
- GIF/sticker picker providers, shared memories, events, mood features and other V2/experimental features.
- Message search, disappearing messages, CDN and horizontal scaling.
- Separate realtime/push worker services or message queues.

The architecture may evolve after MVP, but any stack change requires explicit owner approval.
