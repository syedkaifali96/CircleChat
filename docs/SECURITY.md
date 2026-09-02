# CircleChat — Security Design

> Status: **Proposed — awaiting approval.**
> Honest framing: this document describes a *realistic, layered* security posture for a small
> private messenger. It does **not** promise "100% security" or "perfect privacy". No system
> can. What it does promise: no invented cryptography, defense in depth on the things that
> matter for this product (account access, Circle membership, media), and clearly stated
> limitations.

---

## 1. Threat Model (what we actually defend against)

| Threat | Mitigation (where) |
|---|---|
| Password guessing / credential stuffing | Argon2id + per-IP/per-username rate limiting + generic errors (§4, §6) |
| Stolen session token | hashed token storage, device list + revocation, 30-day expiry, TLS-only (§3) |
| Non-member reading Circle data (IDOR) | server-side membership guard on **every** REST handler and socket event; UUIDs; existence-hiding errors (§5) |
| Bypassing the 5-member limit | transactional conditional insert + trigger + CHECK (§5, DATABASE §1.3) |
| Malicious file uploads | MIME allowlist + magic-byte sniffing + size caps + private bucket (§7) |
| Media hotlinking/leakage | private bucket, short-TTL presigned URLs, membership checks at presign (§7) |
| Recovery-code theft | single-use code, hashed at rest, rotation + global session revocation on use (§4.3) |
| Shoulder-surfing / borrowed phone | local App Lock (PIN/biometric) — explicitly a convenience layer, not server security (§10) |
| SQL injection | ORM parameterization only; no string-built SQL (§9) |
| XSS in chat | React Native text rendering (no WebView for user content); server-side length/format validation (§6) |

Out of scope for MVP (stated, not hidden): end-to-end encryption, protection against a
compromised server or the hosting provider, targeted nation-state attackers, client-side
malware on a rooted device.

## 2. Transport

- **HTTPS/TLS 1.2+ everywhere** (REST + WebSocket). HSTS on the deployment; no plain-HTTP endpoints, even for health checks that don't need it.
- Certificates managed by the platform (Railway/Neon/R2 all TLS by default).
- The mobile app talks only to `https://api.<domain>` — certificate pinning is a **post-MVP hardening item** (it complicates key rotation for a beginner project; noted honestly).

## 3. Sessions

- Token: 32 random bytes from `crypto.randomBytes` (CSPRNG), base64url-encoded. **Opaque token, not JWT** — instant revocation is a product requirement (device management).
- Stored: server keeps only `SHA-256(token)` in `sessions.token_hash` (UNIQUE). A database leak does not expose usable tokens.
- Client keeps the raw token in **Expo SecureStore** (hardware-backed keystore where available). Never AsyncStorage, never logs.
- Sent as `Authorization: Bearer <token>`; the Socket.IO handshake uses the same token.
- Lifetime: 30 days sliding (`expires_at` refreshed on use, throttled). Revoked tokens fail closed.
- Device management UI: list sessions (device name, platform, last active), revoke one, revoke all ("log out everywhere" also offered immediately after a recovery-code reset).
- Logout deletes the session row server-side **and** the token client-side.

## 4. Authentication & Password Handling

### 4.1 Password storage
- **Argon2id** via `@node-rs/argon2`, OWASP-recommended baseline parameters
  (memory 19 MiB, iterations 2, parallelism 1 — or the current OWASP pick at implementation time; parameters live in one config constant).
- Rehash-on-login when parameters are upgraded.
- No custom hashing, no pepper-rolling, no home-made KDFs. Fallback choice if the native module is problematic on a platform: `bcrypt` cost 12 — documented trade-off, still a vetted library.

### 4.2 Password policy (NIST 800-63B flavored)
- Minimum **10 characters**; maximum 128. No forced composition rules; instead a small denylist (username, "circlechat", common patterns) and optional zxcvbn-style strength meter in the UI.
- Passwords are compared only inside the Argon2 verify call; they are never logged or stored anywhere else.

### 4.3 Username-only accounts & recovery codes
- Signup: unique username + password. No email/phone is collected, so there is nothing to phish from the account side or leak through a reset channel.
- Recovery code: generated server-side with CSPRNG from a ~60-bit space, formatted `XXXX-XXXX-XXXX` (Crockford base32, no ambiguous chars), **displayed once** at signup with an explicit "store this safely" screen and a "I saved it" confirmation.
- Stored only as an Argon2id hash (`users.recovery_code_hash`).
- Reset flow: username + recovery code → strict rate limiting → on success: new password set, **new recovery code issued and shown once**, **all sessions revoked** (so a thief who used the code cannot keep a live session, and the owner notices they were logged out).
- If both password and recovery code are lost, the account is unrecoverable **by design** — stated in the UI at signup and in Settings. Support cannot restore access; this is the privacy/convenience trade-off from the spec.

## 5. Authorization

- Single shared guard module, unit-tested: `requireAuth`, `requireCircleMember(circleId, userId, minRole?)`, `requireConversationAccess(conversationId, userId)`.
- Applied **inside every handler** before any data access, and in the Socket.IO layer before room joins and on every emitted event. UI-level hiding is treated as cosmetics only.
- Direct conversations: access = the two participants only; errors to third parties are indistinguishable between "no access" and "does not exist".
- The 5-member limit: server-transactional (see `docs/DATABASE.md` §1.3) — the client cannot create a 6th membership even with a modified app.
- Roles: `owner > admin > member`; role changes and member removal are owner/admin actions, re-checked server-side on every call; the last owner cannot leave or be demoted (guard + test).
- No client-supplied role/identity fields are ever trusted; identity comes exclusively from the session token.

## 6. Rate Limiting & Abuse Controls

| Endpoint group | Limit (initial, tunable) |
|---|---|
| Login / recovery reset | per-IP: 10/min; per-username: 5 per 15 min with growing delay |
| Signup | per-IP: 5/hour |
| Username availability check | per-IP: 30/min |
| Message send (REST) | per-user: 60/min (plenty for 2–5 people) |
| Media upload-intent | per-user: 30/hour |
| General API | per-IP: 120/min |

- Implemented with `@fastify/rate-limit` (in-memory for MVP — single instance; noted: if the server ever scales horizontally, the limiter must move to Redis).
- Limits return `429` with `RATE_LIMITED` and `Retry-After`; no user enumeration via differing messages.
- Message body length caps (4000 chars), poll option caps, and username regex also cap abuse surface.

## 7. File Uploads & Media Access

- **Never trust** client filename, extension, or declared MIME type. Validation pipeline: size cap → MIME allowlist → (at confirm) server-side `HEAD` + magic-byte sniff (`file-type`) → mismatch rejects and deletes.
- Allowlist (MVP): `image/jpeg`, `image/png`, `image/webp`, `image/gif`, `video/mp4`, audio formats for voice (`audio/aac`, `audio/m4a`, `audio/mp4`). **No SVG, no PDF-executable surprises, no unknown binaries.**
- Size caps: image 10 MB, video 50 MB, voice 10 MB, avatar 2 MB (config constants).
- Storage: **private** R2 bucket. Object keys are unguessable (`uuid/`+random). No public ACL, no bucket listing.
- Downloads: API issues presigned GET URLs (~60 s TTL) **only after** a membership check; uploads use 5-minute presigned PUTs scoped to the validated key.
- Avatars and media are served with safe content types; user content is never rendered in a WebView.
- Daily cleanup job deletes orphaned `pending` uploads and tombstoned objects.

## 8. Database Security

- Least-privilege DB role for the app (no superuser, no DDL at runtime; migrations use a separate admin credential in CI only).
- TLS required to Neon; credentials only via environment variables/secrets manager — never in code, never in the repo (`.env` is git-ignored; `.env.example` documents names only).
- All queries parameterized via Drizzle; raw SQL (the few trigger definitions) is reviewed like security-critical code.
- Backups: Neon PITR on; restore tested once before launch (checklist item in DEPLOYMENT.md).
- Local dev uses a throwaway database; **no real user data in development**.

## 9. Input Validation & Injection Defense

- Every route validates input with **Zod** schemas (shared with the client via `packages/shared` where useful): types, lengths, enum membership, array sizes.
- SQL injection: parameterized ORM queries only.
- Chat XSS: React Native renders text safely (no HTML injection surface); if a web client is ever added, text is rendered as text — never `dangerouslySetInnerHTML`.
- Client-supplied IDs are always UUID-parsed; malformed input is a generic `400`, not a DB error.

## 10. App Lock (local privacy layer)

- PIN stored as a salted Argon2id/SHA-256 hash in SecureStore — never plaintext, never synced to the server.
- Biometrics via platform APIs (`expo-local-authentication`) with PIN fallback.
- The server never knows App-Lock state; App Lock protects against casual phone access, not against server compromise. "Forgot PIN" clears the lock and requires server re-login.
- Privacy screen (hide content in app switcher) included in this layer.

## 11. Sensitive Information Handling

- Never collected: phone number, email, contacts, precise location, advertising IDs, behavioral analytics beyond crash-free counts.
- Secrets (DB URL, R2 keys, EAS keys) live in platform secret stores; `.env.example` lists names, never values; a pre-commit check prevents committing `.env`.
- Push payloads contain no message bodies unless the user explicitly enables previews; media is never in push.
- Logs: structured, redacted — **no message content, no tokens, no recovery codes, no password material**. Usernames and IDs are allowed (needed for debugging auth issues).

## 12. Logging & Error Handling

- Central Fastify error handler: clients receive stable error codes + generic messages (`INVALID_CREDENTIALS` — never "wrong password" vs "no such user"); stack traces stay server-side.
- Auth events are logged (success/failure, recovery-code use, session revoke, role change) — an audit trail for the operator without exposing content.
- Crash reporting (Sentry or platform equivalent) with PII scrubbing enabled.
- 5xx responses include a correlation ID for support, but no internal details.

## 13. Known Limitations (kept visible on purpose)

1. Messages are protected by TLS + server controls, **not E2EE** — the server can technically read message content. This is acceptable for the MVP and stated in-app ("not end-to-end encrypted yet") rather than implied otherwise.
2. Rate limiting is in-memory; a single server instance is assumed.
3. No certificate pinning until post-MVP.
4. Recovery-code reset means whoever obtains both your password-less username and your recovery code can take over the account before you rotate it — the UI therefore encourages storing the code offline, and any reset revokes all sessions immediately.
5. Client-side storage (media cache) is only as safe as the device; App Lock mitigates casual access only.

## 14. Security Review Checklist (run at Phase 11 / before launch)

Authentication ✔ sessions ✔ authorization (all endpoints + socket events) ✔ 5-member limit ✔
recovery flow ✔ rate limits ✔ upload validation ✔ media presign checks ✔ DB roles/backups ✔
secrets hygiene ✔ log redaction ✔ error messages ✔ dependency audit (`npm audit`, Dependabot) ✔
manual penetration pass on auth + circle-access paths ✔
