# CircleChat — API Design

> Status: **Planned — evolves with implementation.** All endpoints are JSON over HTTPS under
> `/v1`. Auth: `Authorization: Bearer <session token>` unless marked **public**.
> Errors: stable machine codes + generic human messages (see SECURITY.md §12).
>
> **Approved technical direction:** `docs/ARCHITECTURE.md` is the final approved technical
> stack for implementation. Agents must not substitute the stack without explicit owner approval.

```text
POST /v1/auth/signup             public  {username, displayName, password, deviceName?, platform?} → 201 token, recoveryCode (once), user
POST /v1/auth/login              public  {username, password, deviceName?, platform?} → token, user        [rate-limited]
POST /v1/auth/change-password             {currentPassword, newPassword} → session status; revokes other sessions
POST /v1/auth/recovery-reset     public  {username, recoveryCode, newPassword} → new recoveryCode, revokes all sessions
POST /v1/auth/logout                     revoke current session
GET  /v1/auth/sessions                   list devices/sessions
DELETE /v1/auth/sessions/:id            revoke one session (own)
DELETE /v1/auth/sessions                revoke all other sessions
GET  /v1/users/me                       profile
PATCH /v1/users/me                      {displayName?, bio?}
POST /v1/users/me/avatar                {mediaId}
GET  /v1/users/username-available?u=    public-ish [rate-limited] → {available}
GET  /v1/users/:username                minimal profile (display name, avatar only) — viewer rule: self or ≥1 shared active Circle; otherwise 404 (existence hidden)
GET  /v1/users/:id/presence             {isOnline, lastSeenAt} — D1 rule: self, ≥1 shared active Circle, or an existing direct conversation; otherwise 404 (existence hidden)

POST /v1/circles                        create circle (+ owner membership, conversation, default settings)
GET  /v1/circles                        my circles + unread counts
GET  /v1/circles/:id                    circle summary (members require membership)
PATCH /v1/circles/:id                   rename/description — owner/admin
DELETE /v1/circles/:id                  owner only (soft delete)
POST /v1/circles/:id/invite             owner/admin → multi-use, capacity-limited, expiring invite; raw code returned once
DELETE /v1/circles/:id/invite           owner/admin → revoke active invite
GET  /v1/circles/invite-preview?code=   public → limited Circle preview; does not join
POST /v1/circles/join                   {inviteCode} → joins if active/valid and < 5 members else 409 CIRCLE_FULL
DELETE /v1/circles/:id/members/me       leave (owner must transfer first)
DELETE /v1/circles/:id/members/:userId  owner/admin
PATCH /v1/circles/:id/members/:userId   change role — owner only
POST /v1/circles/:id/ownership-transfer {newOwnerUserId} — owner only; atomic transfer
GET  /v1/circles/:id/settings           member
PATCH /v1/circles/:id/settings          owner/admin (theme, accent, background)
GET  /v1/circles/:id/home               Circle Home payload (unread, active polls, pins, member count)
PATCH /v1/circles/:id/notification-pref {pref: all|mentions|muted} — member

POST /v1/conversations/direct           {username} → find-or-create direct conversation; target must share an active Circle with caller
GET  /v1/conversations                  list (circles + directs) with last message + unread
GET  /v1/conversations/:id/messages     ?before=&limit= keyset pagination — authorized participants/members only
POST /v1/conversations/:id/messages     {type, body?, mediaId?, replyToId?, clientMessageId} — authorized participant/member + validated + idempotent; media types require a READY, conversation-bound media row owned by the sender (M7)
PATCH /v1/messages/:id                  sender only, ≤24h, {body}
DELETE /v1/messages/:id                 sender (or admin in circles) → tombstone
PUT  /v1/messages/:id/reactions         {emoji}
DELETE /v1/messages/:id/reactions/:emoji
POST /v1/conversations/:id/read         {lastReadMessageId}
PATCH /v1/conversations/:id/notification-pref {enabled?, muted?, mentions?, preview?} — caller's preference for this conversation

POST /v1/media/upload-intent            {kind, mimeType, sizeBytes, context} → {mediaId, uploadUrl}
POST /v1/media/:id/confirm              server verifies object (size + magic bytes) → status ready
GET  /v1/media/:id/url                  auth → short-TTL presigned GET, no-store; M7: conversation media (image/video/voice) requires the D1 conversation rule (member/participant or uploader); avatar media keeps the M3 profile-visibility rule; generic 404 on every failure
GET  /v1/users/me/avatar-url            auth → short-TTL presigned GET for the caller's own avatar (404 when none set)
POST /v1/conversations/:id/media/upload-url {kind: image|video|voice, mimeType, sizeBytes, durationMs?} → presigned upload; sender-authorized, per-kind caps (image 10MB, video 50MB, voice 10MB + 2-minute server-enforced duration)

POST /v1/conversations/:id/polls        circle conversations only {question, options[2–6], closesAt?}
GET  /v1/conversations/:id/polls        list
POST /v1/polls/:id/vote                 {optionIndex} — one vote per user
DELETE /v1/polls/:id/vote               change vote while open
POST /v1/polls/:id/close                creator/admin

GET  /v1/circles/:id/pinboard           member
POST /v1/circles/:id/pinboard           member (pin) — admin can remove any
DELETE /v1/circles/:id/pinboard/:itemId

GET  /v1/notifications                  activity list
POST /v1/notifications/read             {ids? | all}
```

## Realtime (Socket.IO)

Connect: `wss://…` with session token in handshake auth. Server validates the session before the
socket is admitted.

- Client → server: `join {conversationId}`, `leave`, `typing:start {conversationId}`,
  `typing:stop {conversationId}`
- Server → client: `typing:update {conversationId, userId, isTyping}`, `presence:online {userId}`,
  `presence:offline {userId, lastSeenAt}`, `message:new`, `message:updated`, `message:deleted`,
  `reaction:changed`, `read:update`, `circle:updated`, `member:joined`, `member:left`,
  `poll:updated`, `notification:new`
- Rules: membership/participant authorization is re-checked on join and on every relevant event.
  Socket event rate limits apply (typing: ~30 events / 10s / user per conversation). Events are
  change notifications — clients fetch state via REST; typing state is never persisted and
  auto-expires server-side ~6s after the last refresh even without a `typing:stop`.
- A session revocation must also disconnect all live sockets associated with that session. A revoked
  session cannot continue receiving or emitting authorized realtime events. The user's last socket
  disconnect stamps `users.last_seen_at` and broadcasts `presence:offline`.
- Presence visibility is limited to people who are allowed to see the relevant relationship:
  Circle members may see one another's presence; direct-chat presence is visible only to the two
  participants. No global presence directory exists. Exact online/last-seen display remains subject
  to the product UI rules.

## Authorization Model

Direct-message authorization is based on the explicit `conversation_participants` table, not by
parsing `direct_key`. `direct_key` exists only as a uniqueness helper to prevent duplicate direct
conversations.

A user may create a direct conversation only with another user who shares at least one **active
Circle** with them. After creation, the direct conversation remains separate from all Circles and
is authorized only for its two participants. It is never modeled as a 2-member Circle and never
receives Circle features such as polls or pinboard.

### Avatar access

- **Profile avatars:** a profile avatar may be returned only in contexts where the requesting user
  is allowed to view that user's minimal profile. The public-ish username lookup must not become a
  global media-download bypass; avatar URLs are short-lived and issued through the media access check.
- **Circle avatars:** available to active Circle members. The server checks Circle membership before
  issuing a presigned media URL.
- **Invite-preview Circle avatars:** available through the invite-preview endpoint only for the
  specific active, non-expired, non-revoked invite code. Preview returns only the limited Circle
  fields defined for pre-join preview. It must not expose general Circle member/profile data.

## Notifications

Notification preferences are evaluated **server-side** when constructing push notifications.
The model supports:

- global notifications enabled/disabled;
- per-conversation enabled/disabled;
- muted conversations/Circles;
- mentions where applicable; and
- message-preview privacy.

A push is omitted or made silent according to the recipient's preferences. If previews are disabled,
message content is not included in the push payload.

## Media Upload Security

Presigned PUT uploads must bind the intended `Content-Type` and enforce the configured
`content-length-range` for the media kind. The server still confirms the uploaded object with size
and magic-byte checks before marking it ready.

GIF files may be uploaded as `image/gif` when the normal image upload allowlist supports them. The
GIF picker/provider experience remains V2; supporting GIF files as an upload format does not promote
the GIF picker to MVP.

## Conventions

- IDs are UUIDs; timestamps ISO-8601 UTC; pagination is keyset (`before=<createdAt,id>`).
- All list endpoints are scoped to the caller's memberships/participants — there is no global listing.
- Rate-limit headers on auth endpoints; `429 RATE_LIMITED` on breach.
- `clientMessageId` is supplied by the client for message-send idempotency. The server enforces
  uniqueness within the sender/conversation scope so retries do not create duplicate messages.
- Username is fixed after account creation in MVP; there is no username-change endpoint.
- Account deletion is explicitly deferred to post-MVP; no deletion endpoint is part of the MVP API.

## Open Questions (not blocking the approved documentation gate)

1. **D2 — message edit window:** 24h proposed; confirm before implementation if product policy changes.
2. **D3 — deletion rights in Circles:** admins deleting others' messages are shown in the API above;
   confirm or restrict to sender-only before implementation.

These are product-policy details only. They do not change the approved stack or the finalized D1
DM authorization decision.
