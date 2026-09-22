# CircleChat — Security Design

> Status: **Core MVP controls are implemented through M13 and exercised by
> automated tests. The M15 security review pass was completed on 2026-09-23:
> the §14 checklist below is verified against code and integration tests
> (apps/server/src/security.pentest.integration.test.ts), with the remaining
> items deferred with explicit reasons.**
> Honest framing: this document describes a realistic, layered security posture for a small private
> messenger. It does **not** promise 100% security or perfect privacy. No system can.

---

## 1. Threat Model (what we actually defend against)

| Threat | Mitigation |
|---|---|
| Password guessing / credential stuffing | Argon2id + per-IP/per-username rate limiting + generic errors |
| Stolen session token | hashed token storage, device revocation, 30-day expiry, TLS-only |
| Non-member reading Circle data (IDOR) | server-side membership guard on every REST handler and socket event; UUIDs; existence-hiding errors |
| Unauthorized direct-chat access | authoritative `conversation_participants` authorization; `direct_key` is not parsed for access |
| Bypassing the 5-member limit | transactional conditional insert + trigger + CHECK |
| Malicious file uploads | MIME allowlist + magic-byte sniffing + size caps + private bucket + pinned upload constraints |
| Media hotlinking/leakage | private bucket, short-TTL presigned URLs, explicit access checks |
| Recovery-code theft | hashed one-time code, rotation + global session revocation on use |
| Shoulder-surfing / borrowed phone | local App Lock (convenience layer, not server security) |
| SQL injection | ORM parameterization; reviewed raw SQL only where required for constraints/triggers |
| Chat injection | React Native text rendering; validation; no WebView for user content |
| Socket/event abuse | per-user/session socket event rate limits |

Out of scope for MVP: end-to-end encryption, protection against a compromised server/hosting provider,
targeted nation-state attackers, and client-side malware on a rooted device.

---

## 2. Transport

- HTTPS/TLS 1.2+ everywhere for REST and WebSocket.
- HSTS on deployment; no plain-HTTP API endpoints.
- Certificates are managed by the hosting platform.
- Certificate pinning is post-MVP hardening because key rotation becomes more operationally complex.

---

## 3. Sessions

- Token: 32 random bytes from `crypto.randomBytes`, base64url-encoded.
- Token is opaque, not JWT.
- Server stores only `SHA-256(token)` in `sessions.token_hash`.
- Client stores the raw token in Expo SecureStore.
- Sent using `Authorization: Bearer <token>`; Socket.IO handshake uses the same token.
- Lifetime: 30 days sliding; revoked/expired sessions fail closed.
- Device management supports listing, single-session revoke and revoke-all-other-sessions.
- **Session revocation must terminate the corresponding live Socket.IO connection(s).** A revoked session
  must not remain authorized through an already-open socket.
- Token-hash comparisons/lookup logic must use established cryptographic primitives and **timing-safe
  comparison** where a secret value is compared directly; do not use ordinary string comparison for
  security-sensitive token material.
- Logout revokes the session server-side and clears the client token.

### CSRF

CSRF is **N/A for the MVP authentication model** because authenticated API requests use an
`Authorization` header with bearer tokens rather than browser cookies. This does not remove the need for
normal input validation, authorization and origin/network protections where relevant.

---

## 4. Authentication & Password Handling

### 4.1 Password storage

- Argon2id via `@node-rs/argon2` using one centralized configuration constant.
- Parameters follow the current vetted baseline selected at implementation time and can be rehashed on login when upgraded.
- No custom cryptography or homemade KDF.
- A vetted bcrypt fallback may be documented only if the approved Argon2id native implementation is unavailable on a target platform.

### 4.2 Password policy

- Minimum 10 characters; maximum 128.
- No forced character-class composition.
- Small denylist for username/common patterns.
- Passwords are verified only inside the password-hash verification routine and are never logged/stored elsewhere.

### 4.3 Username-only accounts & recovery codes

- Signup: unique username + password. No email/phone is collected.
- Username is fixed after creation in MVP; no username-change endpoint.
- Recovery code is generated with a CSPRNG, shown once, then stored only as an Argon2id hash.
- Recovery reset is rate-limited and rotates the recovery code while revoking **all** sessions.
- Losing both password and recovery code makes the account unrecoverable by design.
- Account deletion is explicitly **post-MVP**; there is no MVP deletion endpoint.

### 4.4 Change password

`POST /v1/auth/change-password` requires the authenticated user's current password and a valid new password.
On success, the current session may remain active, but **all other sessions are revoked and their live sockets are disconnected**.

---

## 5. Authorization

- Shared guards: `requireAuth`, `requireCircleMember(circleId, userId, minRole?)`, and `requireConversationAccess(conversationId, userId)`.
- Guards run before protected data access.
- Direct conversations are authorized from `conversation_participants` only. `direct_key` is a uniqueness helper, never an authorization source.
- Direct-chat creation requires the two users to share at least one active Circle. After creation, the direct conversation remains separate from Circles.
- Third-party access failures must not reveal whether a direct conversation exists.
- Circle roles are `owner > admin > member`; owner invariants are enforced server-side and transactionally.
- Ownership transfer is owner-only and atomic: target must already be an active Circle member; old owner is demoted and target promoted in one transaction, preserving exactly one owner.
- The last owner cannot leave/demote themselves in a way that leaves the Circle without an owner.
- No client-supplied identity or role is trusted.

### Direct conversation invariant

A `direct` conversation must have exactly two `conversation_participants` rows. All message, read, reaction,
media and realtime access checks use this table.

### 5-member Circle invariant

The database transaction uses row locking, conditional insert, trigger protection and a `CHECK (members_count <= 5)`.
A capacity failure maps to `CIRCLE_FULL` (HTTP 409).

---

## 6. Rate Limiting & Abuse Controls

| Endpoint/event group | Initial limit |
|---|---|
| Login / recovery reset | per-IP: 10/min; per-username: 5/15 min with growing delay |
| Signup | per-IP: 5/hour |
| Username availability | per-IP: 30/min |
| Message send | per-user: 60/min |
| Media upload-intent | per-user: 30/hour |
| General API | per-IP: 120/min |
| Socket event spam | per-user/session event limits; tuned per event type |

- `@fastify/rate-limit` in-memory for the single MVP server instance.
- Limits return `429 RATE_LIMITED` with `Retry-After` and generic messaging.
- Socket rate limits apply to message sends, typing, joins and other abuse-sensitive events. The server
  must not rely on the client to throttle realtime events.

### Username enumeration

Username availability and username-based lookup create an **accepted residual username-enumeration risk**.
This is intentional because username-only identity is a product requirement. Mitigations are rate limiting,
generic errors and minimal profile exposure; the system does not claim enumeration is impossible.

---

## 7. File Uploads & Media Access

- Never trust filename, extension or declared MIME type alone.
- Validation pipeline: configured size range → MIME allowlist → at confirm, server-side object size + magic-byte sniffing → mismatch rejects/deletes.
- Allowlist includes JPEG, PNG, WebP, GIF, MP4 and supported voice formats.
- Size caps: image 10 MB, video 50 MB, voice 10 MB, avatar 2 MB.
- R2 bucket is private with unguessable object keys and no public ACL/listing.
- **Presigned PUTs must pin the intended `Content-Type` and enforce a `content-length-range` matching the media kind.**
- The server still confirms the object before setting `status='ready'`.
- Downloads use short-lived presigned GET URLs after an explicit authorization check.

### Avatar access

- **Profile avatars:** accessible only in authorized minimal-profile contexts; avatar media cannot be used as a global public-download bypass.
- **Circle avatars:** accessible only to active Circle members.
- **Invite-preview Circle avatars:** accessible only through a valid, active, non-expired invite-preview request and only for the limited preview response.
- Avatar access checks are separate from generic chat-media authorization.

### GIF clarification

`image/gif` may be accepted by the normal image upload path when supported. This does **not** include a GIF
picker/provider in MVP; the picker remains V2.

---

## 8. Database Security

- Application DB role is least privilege; migrations use a separate credential.
- TLS required to Neon.
- Secrets exist only in environment/platform secret stores; never commit them.
- Drizzle queries are parameterized; any trigger SQL is reviewed as security-sensitive code.
- Backups/PITR and restore testing are launch checklist items.
- Local development uses throwaway data; no real user data in development.

---

## 9. Input Validation & Injection Defense

- Every route validates input with Zod.
- IDs are parsed as UUIDs.
- Lengths/enums/array sizes are bounded.
- SQL uses parameterized Drizzle queries.
- React Native renders chat text as text, not executable HTML.

---

## 10. App Lock (local privacy layer)

- PIN verification uses **Argon2id with a per-PIN random salt**, with the resulting hash and salt stored locally in Expo SecureStore.
- The PIN is never sent to or stored by the server.
- Biometrics use `expo-local-authentication` with PIN fallback.
- "Forgot PIN" clears the local lock and requires server re-login; the server never receives the PIN.
- App Lock protects against casual device access, not a compromised device/server.

---

## 11. Sensitive Information Handling

The current product has no generative-AI integration and therefore no OpenAI
or other AI-provider secret. Adding one in the future requires an explicit
privacy/threat-model update; no AI credential may be exposed through an
`EXPO_PUBLIC_*` variable.

Never collected: phone number, email, contacts, precise location, advertising IDs and unnecessary behavioral analytics.

Push payloads contain no message body when previews are disabled. Media is never placed directly in push payloads.
Expo push tokens are stored per session (`sessions.push_token`, M8); registering or clearing one requires the
authenticated caller's own session, tokens ride no read API, and revoked sessions are never notified.
Logs contain no passwords, raw tokens, recovery codes or message bodies.

---

## 12. Logging & Error Handling

- Central Fastify error handler returns stable error codes and generic messages.
- Never distinguish "wrong password" from "no such user" in user-facing auth errors.
- Auth events, recovery use, session revocation and role changes may be logged without secrets/content.
- Crash reporting must use PII scrubbing.
- Correlation IDs may be returned on 5xx responses without internal details.

---

## 13. Known Limitations

1. MVP messages use TLS + server-side controls, **not E2EE**.
2. Rate limiting is in-memory and assumes one server instance.
3. Certificate pinning is post-MVP.
4. Username enumeration remains a bounded, accepted risk because username-only identity is required.
5. Client/device compromise can expose data available to that device; App Lock is not a substitute for device security.
6. Losing both password and recovery code makes an account unrecoverable by design.

---

## 14. Security Review Checklist

Before launch, verify:

- [x] Authentication and recovery flows (M2/M12 suites; login burst 429, recovery reset rotates code + revokes all sessions — auth.integration.test.ts)
- [x] Change-password session revocation (M12: other sessions revoked; sockets disconnected — revocation.realtime.integration.test.ts)
- [x] Socket disconnection after session revocation (real Socket.IO clients; revocation.realtime.integration.test.ts)
- [x] Direct-chat authorization using `conversation_participants` (M5 suites; participant-only access, existence-hiding 404 — messages.integration.test.ts + pentest suite)
- [x] Circle membership authorization on every endpoint/event (per-module permission tests; socket rooms re-check per join — circles/messages/polls/profile suites)
- [x] 5-member concurrency invariant (transactional conditional insert + trigger + CHECK; concurrent-join race test — circles.integration.test.ts)
- [x] Ownership-transfer atomicity (single transaction, exactly one owner preserved, non-owner rejected — circles.integration.test.ts)
- [x] Invite expiry/revocation/capacity behavior (INVITE_EXPIRED 410, revoked invite blocks join + preview, CIRCLE_FULL 409, hashed code only — circles.integration.test.ts)
- [x] Rate limits, including socket events (auth/login/signup per-route limits + 120/min global; typing and join/leave socket limiters — auth.integration.test.ts, realtime.joinrl.integration.test.ts)
- [x] Presigned PUT Content-Type/content-length pinning (pinned Content-Type + per-kind content-length-range; exact size re-checked at confirm — pentest suite)
- [x] Avatar access rules (owner/shared-Circle rule, foreign media UUID → 404, deleted-Circle revokes access — media-url/profile suites + pentest suite)
- [x] Media magic-byte verification (internal signature sniffing; MIME-spoofed upload rejected and row deleted at confirm — pentest suite)
- [x] Notification privacy rules (muted recipients, preview-hidden bodies, no push to revoked sessions — notifications.integration.test.ts)
- [x] DB roles/backups (least-privilege app role + separate migration credential on Neon; TLS enforced; PITR documented — docs/DEPLOYMENT.md §6; production restore drill remains a launch item)
- [x] Secret/log hygiene (Zod-validated env without defaults for secrets, logger redaction tested in app.test.ts, no message bodies in logs)
- [~] Dependency audit and manual auth/Circle-access penetration pass — audit run 2026-09-23: unused `file-type` (high) removed, `drizzle-orm` bumped (2 high CVEs fixed); remaining 29 findings (7 high — all in the Expo/React Native build toolchain, not server runtime; 22 moderate incl. dev-only tooling) re-reviewed in M16: `npm audit fix` has no non-breaking path (npm hits a peer-resolution conflict and would downgrade expo to 40), so fixing them requires the Expo SDK 57 + React Native 0.87 + jest-expo major migration — deferred post-M16 with that explicit migration path. Server runtime dependencies are clean. Manual penetration pass automated in security.pentest.integration.test.ts (auth bypass, IDOR, boundaries, spoofing).
