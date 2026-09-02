# CircleChat — API Design

> Status: **Planned — evolves with implementation.** All endpoints are JSON over HTTPS under
> `/v1`. Auth: `Authorization: Bearer <session token>` unless marked **public**.
> Errors: stable machine codes + generic human messages (see SECURITY.md §12).

```text
POST /v1/auth/signup             public  {username, password} → token, recoveryCode (once), user
POST /v1/auth/login              public  {username, password} → token, user        [rate-limited]
POST /v1/auth/recovery-reset     public  {username, recoveryCode, newPassword} → new recoveryCode, revokes all sessions
POST /v1/auth/logout                     revoke current session
GET  /v1/auth/sessions                   list devices/sessions
DELETE /v1/auth/sessions/:id            revoke one session (own)
DELETE /v1/auth/sessions                revoke all other sessions
GET  /v1/users/me                       profile
PATCH /v1/users/me                      {displayName?, bio?}
POST /v1/users/me/avatar                {mediaId}
GET  /v1/users/username-available?u=    public-ish [rate-limited] → {available}
GET  /v1/users/:username                minimal public profile (display name, avatar only)

POST /v1/circles                        create circle (+ owner membership, conversation, default settings)
GET  /v1/circles                        my circles + unread counts
GET  /v1/circles/:id                    circle summary (members require membership)
PATCH /v1/circles/:id                   rename/description — owner/admin
DELETE /v1/circles/:id                  owner only (soft delete)
POST /v1/circles/:id/invite             owner/admin → single-use invite code (raw code returned once)
POST /v1/circles/join                   {inviteCode} → joins if < 5 members else 409 CIRCLE_FULL
DELETE /v1/circles/:id/members/me       leave (owner must transfer first)
DELETE /v1/circles/:id/members/:userId  owner/admin
PATCH /v1/circles/:id/members/:userId   change role — owner only
GET  /v1/circles/:id/settings           member
PATCH /v1/circles/:id/settings          owner/admin (theme, accent, background)
GET  /v1/circles/:id/home               Circle Home payload (unread, active polls, pins, member count)

POST /v1/conversations/direct           {username} → find-or-create direct conversation (mutual membership not required for DMs? — see open question D3)
GET  /v1/conversations                  list (circles + directs) with last message + unread
GET  /v1/conversations/:id/messages     ?before=&limit= keyset pagination — members only
POST /v1/conversations/:id/messages     {type, body?, mediaId?, replyToId?} — member + validated
PATCH /v1/messages/:id                  sender only, ≤24h, {body}
DELETE /v1/messages/:id                 sender (or admin in circles) → tombstone
PUT  /v1/messages/:id/reactions         {emoji}
DELETE /v1/messages/:id/reactions/:emoji
POST /v1/conversations/:id/read         {lastReadMessageId}

POST /v1/media/upload-intent            {kind, mimeType, sizeBytes, context} → {mediaId, uploadUrl}
POST /v1/media/:id/confirm              server verifies object → status ready
GET  /v1/media/:id/url                  member check → short-TTL presigned GET

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
PATCH /v1/circles/:id/notification-pref {pref: all|mentions|muted}
```

## Realtime (Socket.IO)

Connect: `wss://…` with session token in handshake auth. Server validates, then rooms.

- Client → server: `join {conversationId}`, `leave`, `typing {conversationId, isTyping}`
- Server → client: `message:new`, `message:updated`, `message:deleted`, `reaction:changed`,
  `typing`, `presence {userId, online, lastSeenAt}`, `read:update`, `circle:updated`,
  `member:joined`, `member:left`, `poll:updated`, `notification:new`
- Rules: membership re-checked on join and on every send/typing event; events are change
  notifications — clients fetch state via REST; ephemeral events (typing/presence) are never persisted.

## Conventions

- IDs are UUIDs; timestamps ISO-8601 UTC; pagination is keyset (`before=<createdAt,id>`).
- All list endpoints are scoped to the caller's memberships — there is no global listing.
- Rate-limit headers on auth endpoints; `429 RATE_LIMITED` on breach.

## Open Questions (decide before implementation)

1. **D1 — DM policy:** the spec says private chats are with "members". Should DMs be restricted
   to people sharing a Circle, or open to any username (like WhatsApp)? Recommendation: **any
   username**, but the recipient can reject/block (basic block list in MVP-adjacent scope).
   Awaiting product decision.
2. **D2 — message edit window:** 24h proposed; confirm.
3. **D3 — deletion rights in Circles:** admins deleting others' messages — allowed per table
   above; confirm or restrict to sender-only.
