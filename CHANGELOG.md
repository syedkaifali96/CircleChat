# CircleChat — Changelog

## Unreleased

### Documentation synchronization

- Updated README and every project document to the implemented M13 baseline,
  current warm-midnight design direction, CI test counts and honest M14/M16
  status. Removed stale claims that GIF search and themes were future work,
  documented the real Socket.IO room names and current API surface, separated
  implemented CI from planned production deployment, and explicitly confirmed
  that the app has no generative-AI integration or AI API key.
- Added the recommended GitHub repository description and topic set to the
  README so repository metadata has one reviewable source of truth.

### Chat reliability fixes

- Chats now open at the newest message. Older history loads when the user
  reaches the top and keeps the visible messages anchored; pending media stays
  at the newest-message end.
- Retrying a failed media upload reuses its optimistic bubble instead of
  leaving a duplicate stuck in the uploading state.
- Editable messages now prefill their current body and close cleanly after a
  successful save.
- External GIF messages render inline, and video/file attachment taps now open
  the authorized download URL instead of silently doing nothing.
- Closing a chat now removes it from the reconnect room registry, preventing a
  later socket reconnect from silently rejoining rooms for closed screens.

### Realtime read-state fix

- **Unread badge could remain after opening a chat:** the conversation screen
  subscribed to socket message events without an `onMessage` callback, so a
  message arriving while the chat was open did not refresh the REST-authoritative
  history or advance the read pointer. The screen now refreshes on
  `message:new`, `message:updated`, and `message:deleted`, then marks the
  newest message read. A mobile regression test verifies the open-chat flow.

### Bug fixes — real-device testing pass

- **Unread badge never cleared on direct conversations (server):** `markConversationRead` advanced the read pointer with an `INSERT … ON CONFLICT DO UPDATE` upsert, but the M1 `DIRECT_PARTICIPANT_LIMIT` BEFORE INSERT guard fires *before* conflict resolution on every insert into a full direct conversation — so every read call on an existing direct chat 500'd and the pointer never advanced (circle conversations worked because their participant rows are created lazily on first read). The service now UPDATEs the existing row and only INSERTs when one is absent, keeping the D1 invariant untouched. Regression test: read pointer advances on an existing direct conversation, unread goes 2 → 0, list reflects it.
- **Create/Join Circle screens had no header:** both screens now render the app's standard header row (title + back chevron, matching the Chats/Home pattern) with working back navigation (`create-circle-header`/`join-circle-header`, `create-circle-back`/`join-circle-back`). Follow-up: the header container also pads its top with the live safe-area inset (`max(insets.top, 24) + 12`) — the first pass sat the title under the device status bar on real devices (mirror of the composer bottom-inset bug); regression tests inject a 42px top inset and assert it flows into the container's `paddingTop`.
- **Composer overlapped the Android navigation bar:** the chat composer now pads its bottom with the live safe-area inset (`useSafeInsets().bottom` + base padding) instead of a fixed value, so it stays reachable on both gesture and 3-button navigation devices. Regression test injects a 34px inset and asserts it flows into the composer's `paddingBottom`.

### M13 — App Lock

- Mobile-only local privacy layer (design.md §22, docs/ARCHITECTURE.md §2.8): a PIN (4–6 digits) plus platform biometrics locks the whole app. **100% local** — the PIN lives only as a salted Argon2id PHC string in SecureStore (fresh 16-byte salt per setup, OWASP m=19456/t=2/p=1 carried inline in the PHC string, constant-time comparison via `@noble/hashes` pure-JS Argon2id + `expo-crypto` salt); **nothing is sent to the server and no App-Lock endpoint, storage, or migration exists**.
- Lock policy per design.md §22: Off / Immediately / After 1 / 5 / 15 minutes / On app restart. Every enabled mode locks a fresh app launch; timed modes re-lock on background→foreground only after their threshold; `restart` re-locks only when the process starts. While locked, `AppLockProvider` renders the LockScreen **instead of all navigation content** (design.md's locked-state rule: no private message previews can ever render behind it). PushManager stays mounted outside the gate so M8 delivery and its preview-privacy rules keep working while locked.
- Lock screen per the documented layout (logo, "App locked", Unlock with PIN, Use biometrics). Biometrics use expo-local-authentication only (hardware + enrollment detected; the button hides when unavailable) — no custom biometric handling. Wrong PIN answers "Incorrect PIN."; biometric failures fall back to the PIN.
- Settings: a new App lock screen (Profile → App lock) lists the six documented options; enabling any mode without a PIN opens inline setup (enter + repeat, mismatch surfaces an error), switching to Off removes the PIN after a destructive-action confirmation. The screen states plainly that nothing is sent to the server.
- Forgot-PIN recovery: one path — confirm "Sign out", which wipes the local PIN hash and resets the mode to Off, clears the session token, and signs out; the user then authenticates normally on the login screen. This keeps the recovery path server-clean while making a permanently-locked device impossible.
- Logout isolation: the lock is device-local, not per-account — signing out neither reads nor clears the lock, and a locked app gates the auth screens too, so switching accounts cannot bypass an engaged lock.
- Tests: 18 new mobile tests (PIN hash/verify/unique-salt/corrupt-record, mode storage round-trip + corrupt fallback, full lock-policy table for all six modes, provider gate locking cold starts and threshold transitions with children unmounted, PIN unlock reject/accept, biometric availability + platform-prompt success, forgot-PIN alert flow wiping lock data, settings modes + setup flow + Off confirmation). Server suite regression only — no server changes (238/238).

### M12 — Personalization

- Shared contract (packages/shared): the previously free-text `themePreset`/`backgroundKey` settings fields are now stable app-defined enums — `THEME_PRESETS` (`dark_purple` default, `midnight`, `orchid`, `ember`) and `BACKGROUND_KEYS` (`none`, `aurora`, `dusk`, `velvet`) — so the client can never ship arbitrary style blobs (docs/DATABASE.md §1.4 "app-defined presets"). Unknown presets/background keys (e.g. a URL smuggled into `backgroundKey`) answer `400 VALIDATION_FAILED` via the tightened Zod schemas; the accent stays the server-validated `#RRGGBB` field.
- Server: PATCH `/v1/circles/:id/settings` normalizes the `none` background key to the documented nullable default on write (a literal `'none'` never reaches storage); GET/PATCH behavior and the existing owner/admin role guard are otherwise unchanged. New integration tests cover the full enum round-trip (every approved preset/background key accepted + read-back) and the authorization matrix (plain member denied with the generic 404, admin allowed, non-member 404 on read and write, revoked session 401).
- Mobile theme system: `CircleThemeProvider`/`useCircleTheme` map each preset onto the existing design-token roles (background/surface/border/text/accent + derived `bubbleOwn`/`bubbleOther`) — personalization only recolors documented roles, never invents new ones, and `dark_purple` keeps the brand tokens byte-identical. A per-Circle accent override (`#RRGGBB`) replaces the accent role. Bundled chat backgrounds (`aurora`/`dusk`/`velvet`) ship as app assets and render behind a dimming scrim so text contrast survives any preset/background combination (design.md §24); there is no second storage system and no user-uploaded backgrounds.
- Screens: Circle Home, the conversation screen, Pinboard and Polls render inside their Circle's personalization via `CircleThemeGate` (defaults while loading; direct chats skip the fetch entirely and keep the documented defaults). Chat integration recolors the bubbles (sent/received/deleted/reply preview/sender labels/reaction chips), the composer (input, `+` button, send), the header hairline, and the message-action/attachment/GIF/edit sheets; accent reaches links, poll selection borders, result bars, role badges and avatars without changing any screen's information architecture. Circle Home remains the hero — personalization is recoloring, not new chrome.
- Settings UI: the Circle settings screen gains a Personalization section (owner/admin only, mirroring the server guard — plain members never see the pickers) with theme preset rows (swatch + check state), a finite contrast-checked accent swatch palette, and background rows. Patches are optimistic with revert + inline error on failure, submitting stable identifiers only.
- Tests: 2 new server tests (enum round-trip + authorization matrix) over real PostgreSQL and 10 new mobile tests (provider defaults/overrides, gate fetch-skip for direct chats, gate application, background key resolution, preset-themed bubbles vs default-brand direct-chat bubbles, settings pickers patch stable ids, failure revert, member-hidden section). No schema migration — the M1 `circle_settings` table already matched the documented design.

### M11 — Polls

- Server (docs/API.md): `POST/GET /v1/conversations/:id/polls` + `POST/DELETE /v1/polls/:id/vote` + `POST /v1/polls/:id/close` — authorization rides the conversation (`requireConversationAccess`: Circle members only, non-members/removed members/deleted Circles get the generic 404; DM creation → 403 because polls are Circle-only). Creation validates question ≤300 chars, 2–6 distinct options of ≤80 chars and a future `closesAt` (shared `createPollSchema`); option counts are additionally DB-CHECKed. Voting is single-choice with one vote per user guaranteed by the `poll_votes` composite PK — concurrent duplicate votes collapse at the database level and surface as `409 VOTE_EXISTS`; closed polls (deadline passed or closed early by creator/owner/admin) answer `409 POLL_CLOSED`; vote change is the documented delete + re-vote flow. Mutations broadcast `poll:updated` via the existing M6 publisher — REST stays the source of truth. Mutations rate-limited (create 10/min, vote/close 30/min); responses `no-store`.
- Circle Home: the M9 `activePolls: []` placeholder is now real — an active-polls preview (latest 2 with question, vote count and the caller's standing) plus `activePollsCount`, with closed polls excluded.
- Mobile: dedicated `circles/[id]/polls` screen (Active/Closed sections, single-choice option rows with result bars and the caller's selection, take-back-vote, close-poll for creator/owner/admin, empty/loading/error+retry states) and `circles/[id]/polls/create` (question + dynamic 2–6 option inputs with client validation mirrored by the server, success navigates back). `Poll` type + fetch/vote/unvote/close/create API functions added to the client.
- Tests: 14 new server tests over real PostgreSQL (creation + validation bounds + DM 403 + non-member 404, listing order + denied matrix, vote/counts/myVote/duplicate 409, closed-by-close and closed-by-deadline 409, out-of-range option 400, vote change, cross-Circle isolation, concurrent duplicate votes collapsing to one row, close authorization, home activePolls with live results and closed exclusion) + 13 new mobile tests (polls screen render/vote/vote-switch/POLL_CLOSED error/empty/loading/error+retry, create screen validation/success/add-remove options/server error, Circle Home poll preview + empty state).
- No schema migration — the M1 `polls`/`poll_votes` tables already matched the documented design (`allow_multiple` was never added).

### M10 — Pinboard
### M10 — Pinboard

- Mobile: Circle Home gains a Pinboard section (3-item preview with sender/pinner metadata, empty-state hint, View all (n) link) and a dedicated `circles/[id]/pinboard` screen (full list, per-pin unpin mirrored to the server policy — own pins or owner/admin, empty/loading/error+retry states, tap opens the Circle chat where media renders through the authorized pipeline). Chat messages gain "Pin to Pinboard" in the existing long-press action menu (Circle conversations only, tombstones excluded); PIN_EXISTS surfaces a friendly already-pinned message.
- Tests: 7 new server tests over real PostgreSQL (pin + list payload with pinner/message, duplicate 409, member-own vs other-member unpin, non-member 404 on all three operations, removed member 404, revoked session 401, foreign-Circle/direct-message rejection with nothing stored; the home payload now serves real `pinnedItems` + `pinsCount`, and the M1 schema test was rewritten for the message-reference model) + 14 new mobile tests (Circle Home pin preview/empty/View-all, full Pinboard screen: render/empty/loading/error+retry/unpin own/owner-unpin-others/member-hidden-unpin/tap-opens-chat, and chat: Pin action calls the API, tombstones and direct chats offer no pin).
- Server (docs/API.md): `GET/POST /v1/circles/:id/pinboard` + `DELETE /v1/circles/:id/pinboard/:itemId` — member-scoped with the M4 membership guard (non-members, removed members and deleted Circles all get the generic 404; revoked sessions 401). A pin REFERENCES an existing message: `POST {messageId}` only — the server verifies the message is live (non-tombstoned) and belongs to THIS Circle's own conversation (foreign-Circle/direct ids → generic 404, nothing stored); duplicates answer `409 PIN_EXISTS` (UNIQUE (circle_id, message_id)). Unpin policy per docs/API.md: owner/admin any pin, member only their own (403 otherwise). Mutations broadcast `pinboard:updated` to the conversation room via the existing M6 publisher — REST stays the source of truth.
- Data model: migrations 0006/0007 convert the M1-era free-text `pinboard_items` into message references — `content`/`order_index` dropped, `message_id` added (`→ messages.id ON DELETE CASCADE`) with `UNIQUE (circle_id, message_id)` and a `(circle_id, pinned_at DESC)` list index. The delete-message flow removes pins referencing the tombstoned message (listing also filters `deleted_at IS NULL` — two consistent layers), so deleted content can never leak through the pinboard and the slot frees for future pins.

### M9 — Circle Home
### M9 — Circle Home

- Server: `GET /v1/circles/:id/home` (documented since M4, now real) returns the Circle Home payload in one authorized fetch — identity (name, description, avatar), `membersCount`, the Circle's `conversationId`, caller role, the members preview (`userId`/`username`/`displayName`/`role`/`joinedAt`, ≤5 rows), and a server-computed `unreadCount` reusing the M5 read-pointer logic. Authorization is unchanged: the M4 membership guard answers non-members, removed members and deleted Circles with the same generic 404; responses stay `no-store`. `activePolls`/`pinnedItems` remain empty placeholders for M10/M11. No schema changes.
- Mobile: the Circle screen (`circles/[id]`) now renders the Home dashboard — hero identity header, the primary **Open Chat** action routing into the Circle conversation with an unread badge (99+ capped), members preview with role badges, and the existing management features (invites, member roles, ownership transfer, leave, settings, notification-settings link). Stale M4-era "chat arrives later" copy removed; loading/error/retry states retained.
- Tests: 5 server tests over real PostgreSQL (member payload correctness incl. conversation + members + role, unread computed from the read pointer with own messages excluded, non-member 404, removed-member 404, revoked-session 401) + 5 mobile tests (identity/members/unread render, Open Chat navigation, missing-conversation fallback, loading state, error + retry).

### M8 — Notifications

- Server (docs/API.md Notifications): server-authoritative Expo Push fan-out on every persisted message — after persistence and realtime, the server resolves recipients (sender excluded), evaluates eligibility per recipient (global `users.notifications_enabled`, per-conversation `conversation_notification_prefs` mute/enable), applies preview privacy (global + per-conversation; off → "New message"), and constructs the payload (title = Circle name or sender display name; data = `conversationId`/`messageId`/`type` only). Push failure is logged and swallowed: message persistence, realtime and the 201 response are never affected.
- Devices are sessions: `PUT/DELETE /v1/auth/push-token` registers/clears the Expo token on the CURRENT session (`sessions.push_token`, M1 column); registering a token moves it off any other session of the same user (one token = one device); revoked sessions never receive pushes; Expo `DeviceNotRegistered` tickets auto-clear the dead token so healthy devices keep working. `GET/PATCH /v1/users/me/notification-settings` (global enable + preview, rate-limited) and `GET/PATCH /v1/conversations/:id/notification-pref` (per-conversation mute/enable/preview) expose preferences.
- Configuration: `EXPO_ACCESS_TOKEN` (Zod-validated, optional) — absent (local dev/tests) the no-op gateway silently drops pushes; `.env.example` updated.
- Mobile: `src/lib/notifications.ts` (OS permission states granted/denied/unavailable — never spams re-requests; Expo token acquisition; best-effort registration/unregistration), `src/lib/PushManager.tsx` mounted in the root layout (registers once per session while authenticated, clears on logout via `unregisterPushTokenForSession`, routes notification taps to the conversation screen where access is re-verified server-side), notification settings screen (global toggle, preview privacy, device-permission state, optimistic updates with revert on failure) reachable from the Circle home menu, and a 🔔/🔇 mute toggle in the chat header.
- Tests: 14 server tests over real PostgreSQL (token registration/auth/duplicates/rate-limit churn, direct + circle fan-out, sender exclusion, muted/global-off/preview-privacy suppression, revoked-session exclusion, member removal, provider-down still 201, DeviceNotRegistered cleanup, settings endpoints) + 19 mobile tests (permission states, registration paths, tap routing incl. stale cold-start, PushManager lifecycle, settings screen toggles/failure revert).
- No new migrations — M1 schema already carried `users.notifications_*`, `sessions.push_token`, `conversation_notification_prefs`, and `notifications`.
- Real-device smoke (physical Android 8.1 via Expo Go + local server): launch, signup/auth, API connection, notification settings screen and global-toggle persistence verified; the settings screen reports "unavailable" gracefully in push-less environments. Two fixes fell out of it: `getPermissionStatus`/`registerForPushNotifications` now catch environments where the expo-notifications APIs throw entirely (Expo Go Android removed remote push in SDK 53) instead of crashing the render tree (regression-tested), and `expo-notifications`/`expo-device` were pinned to the SDK 53-compatible `~0.31.5`/`~7.1.4` (they had been installed from a newer SDK line).
- Real remote push delivery and push-tap navigation are **not yet device-verified** — that requires a development build (Expo Go on Android since SDK 53 provides no remote push) with `android.package`/EAS project id, `google-services.json` + FCM v1 credentials, and server `EXPO_ACCESS_TOKEN`.

### M7.1a — GIF search provider swapped to GIPHY

- Tenor discontinued by Google (new keys stopped Jan 13 2026, full shutdown Jun 30 2026) — GIF search now uses **GIPHY**, called **directly from the mobile client** because GIPHY's API terms prohibit server-side proxying. The Tenor proxy endpoint, `TENOR_API_KEY` config and server-side rate limiter were removed; the server's only GIF role remains accepting `type='gif'` messages with a https `external_url` (provider-agnostic, D1-gated visibility).
- Key handling: `EXPO_PUBLIC_GIPHY_API_KEY` ships in the mobile app config (public by GIPHY's own design; never committed). Dev-tier keys are ~42 req/hour — 429s surface as "Search temporarily unavailable, try again shortly". Production key requires GIPHY app review once attribution is live (manual owner step).
- Attribution: the "Powered By GIPHY" mark renders with every search-results grid, per GIPHY's design guidelines; results are shown exactly as returned (no reordering/filtering, no provider mixing).
- Tests: server GIF tests rewritten provider-agnostic (send/idempotency/URL validation/D1 gating — the removed proxy tests were Tenor-specific); 5 new mobile tests for the GIPHY client (normalization, direct-call assertion, 429 mapping, network errors, key handling).

### M7.1 — GIF Search + Image Thumbnails

- GIF search (Tenor, M7.1a): `GET /v1/media/gif-search` proxies Tenor server-side (per-user 30/min rate limit; `TENOR_API_KEY` lives only in the server environment — never client-visible, 503 when unconfigured). External GIFs send as `type='gif'` with the provider URL stored on a `kind='gif'` media row (`external_url`) — no storage round-trip; message visibility stays D1-gated. Provider: Tenor over Giphy (free tier, no attribution/branding requirements).
- Image thumbnails (M7.1b): on confirm, chat images generate a max-400px JPEG thumbnail (sharp) stored as `<storage-key>-thumb` in the private bucket; `GET /v1/media/:id/url?variant=thumb` serves it and falls back to the original on failure — thumbnail generation never blocks message visibility. Video frame thumbnails deferred (needs ffmpeg-scale native tooling).
- Mobile: GIF picker in the attachment menu (debounced search-as-you-type, grid of previews, tap to send), bubbles render thumbnails by default with tap-to-full-res, external GIFs render directly from the provider URL.
- Migrations: 0004 adds `media.thumbnail_key` + `media.external_url`; 0005 extends the `messages.type` / `media.kind` CHECKs with `'gif'`.
- Tests: 9 new server tests (search 503/401/proxy/key-hiding/rate-limit/validation, external GIF idempotency + URL validation, thumbnail generation + fallback) + mobile test updates.

### M7 — Media / Voice Messaging

- Server (docs/API.md): `POST /v1/conversations/:id/media/upload-url` issues presigned uploads for chat attachments after sender authorization + per-kind validation (image 10 MB: jpeg/png/webp/gif, video 50 MB mp4, voice 10 MB aac/m4a/mp4 with a 2-minute server-enforced duration ceiling); `POST /v1/media/:id/confirm` unchanged (size re-check + magic-byte sniff); `GET /v1/media/:id/url` now serves conversation media under the D1 rule (conversation member/participant or uploader) alongside avatar media. `POST /v1/conversations/:id/messages` accepts media types but only references a READY, conversation-bound, sender-owned media row — pending/foreign media is rejected, and the idempotency key pattern carries over unchanged.
- Storage: private Cloudflare R2 via the existing gateway (presigned POST with pinned Content-Type + content-length-range; short-TTL presigned GET); chat keys are non-guessable `chat/<kind>/<random>`; bytes never touch the API server. No schema migration — the M1 `media` table already had conversation binding, dimensions and duration.
- Realtime: `message:new` for media fires only after upload confirmation and carries media metadata (kind, MIME, size, duration, dimensions) so clients render without a second fetch; tombstones still never expose media.
- Mobile (Expo): composer `+` menu (photo/GIF, video, voice up to 2 min; stickers marked coming-soon per spec), direct-to-storage upload with optimistic pending/failed bubbles and tap-to-retry (local media retained), inline image rendering via short-TTL URLs, voice player with duration/waveform bars, attachment chips for video. Permission denials surface actionable messages. Sending media never triggers typing signals (separate composer paths).
- Tests: 10 server tests (upload authorization, per-kind MIME/size/duration validation, confirmed-upload gate incl. realtime ordering, media idempotency, foreign/cross-conversation media rejection, member vs non-member download, direct-conversation media) + 6 mobile tests (image/voice rendering, pending/failed + retry, attachment pipeline).

### M6 — Realtime Typing + Presence

- Realtime (docs/API.md Realtime): `typing:start`/`typing:stop` (client → server) with per-user/per-conversation rate limiting (~30/10s) and server-side TTL auto-expiry (~6s without refresh) broadcasting `typing:update`; presence derived from live connections — first socket broadcasts `presence:online` to authorized rooms, the LAST disconnect stamps `users.last_seen_at` and broadcasts `presence:offline`. Revoked sessions disconnect (M2 hooks) and take the user offline.
- Authorization: conversation-scoped fan-out only — typing/presence events reach room members whose access was re-checked server-side; REST `GET /v1/users/:id/presence` follows the D1 rule (self, ≥1 shared active Circle, or an existing direct conversation; otherwise a generic 404 so existence never leaks).
- Storage decision: typing is in-memory per socket-server process (ephemeral, never persisted — Redis only if multi-node arrives, post-MVP); presence needs no new migration (`is_online` is derived, `users.last_seen_at` existed since M1).
- Mobile (Expo): shared `socket.io-client` singleton (session-token handshake, reconnect with room-join replay), chat-screen typing indicator ("X is typing…"), composer typing signals with ~3s idle auto-stop, direct-chat header online/last-seen indicator, listener cleanup on unmount.
- Tests: 11 server tests over real Socket.IO + PostgreSQL (typing broadcast scoping, non-member rejection, TTL expiry, rate limiting, online/offline lifecycle, multi-device counting, last_seen_at persistence, REST presence authorized/unauthorized/DM cases, revocation) + 6 mobile tests (typing debounce, indicator rendering, presence header, cleanup).

### M5 — Direct + Circle Messaging

- Server (docs/API.md contract): POST /v1/conversations/direct (find-or-create, both users must share ≥1 active Circle — D1; existence hidden behind generic 404; duplicates return the same conversation), GET /v1/conversations (caller-scoped circles + directs with last message preview + server-computed unread), POST /v1/conversations/:id/read (server-side read pointer; stale pointers never regress), PATCH /v1/conversations/:id/notification-pref (caller-only upsert).
- Messages (docs/DATABASE.md §1.7–1.8): POST /v1/conversations/:id/messages (text-only, idempotent via (conversation_id, sender_id, client_message_id) — concurrent duplicates resolve to one row), GET keyset-paginated history (newest-first, ≤50/page, no OFFSET), PATCH /v1/messages/:id (sender-only, ≤24h window, tombstones never editable), DELETE /v1/messages/:id (sender, or Circle owner/admin for member messages; direct non-senders rejected; tombstone keeps the row but body/media are never exposed again), PUT/DELETE /v1/messages/:id/reactions (server-validated emoji set; one per user/emoji/message).
- Realtime (minimal, docs/ARCHITECTURE.md §8): conversation rooms with server-side access re-check on every join; message:new, message:updated, message:deleted, reaction:changed, read:update change notifications after committed DB writes; REST remains the source of truth. Typing/presence stay deferred to M6.
- Database: migration 0003 adds conversation_participants.last_read_message_id (FK → messages, ON DELETE SET NULL); unread = messages newer than the pointer (missing row/NULL = all unread).
- Mobile (Expo): Chats list (circle + direct rows, last-message preview, unread badges, loading/empty/error states, private-chat start by username), conversation screen (header with circle/direct identity, MessageBubble with own/incoming styles, sender name, reply preview, edited marker, tombstones, reaction chips), composer (text-only; attachment control intentionally inert until M7), keyset pagination upward, long-press actions (react/copy/edit-within-24h/permission-gated delete), read marking on open.
- Tests: 31 server tests (direct rules incl. duplicate + existence hiding, idempotent + concurrent sends, reply validation, keyset pagination, edit window, tombstone + delete permissions, reactions, read pointers, prefs, revoked sessions) + 6 realtime tests (authorized join, non-member rejection, all five events, revocation disconnect) + 11 mobile tests (bubble states, chats list, private-chat start, send flow, permission-gated actions).

### M4 — Circles

- Server (docs/API.md contract): create/list/get/update/delete Circle (soft delete, owner-only), multi-use capacity-limited expiring revocable invites (CSPRNG codes shown once; only SHA-256 hashes stored, normalized so typed codes match), join with the layered 5-member enforcement (FOR UPDATE row lock + conditional insert + BEFORE INSERT trigger + CHECK — a documented concurrent-join test proves 10 racing joins yield exactly 4 successes and a 5-member cap), leave (owner must transfer first), owner/admin member removal, owner-only role changes, atomic ownership transfer, per-Circle settings, Circle Home payload.
- Server: invite-preview endpoint (public; limited pre-join fields + short-TTL presigned avatar URL; members never exposed).
- Mobile (Expo): Home with Circle cards + empty/loading/error states, Create Circle, Join Circle (code → preview → confirm), Circle Home (members, role badges, invite modal with one-time code + revoke, role menu, transfer, leave), Circle Settings (rename, owner-only delete). API client extended for circles.
- Tests: 22 server tests (create, invite lifecycle incl. hash-only storage + expiry bounds, join/preview, sixth-join rejection, concurrent joins never exceeding 5 members, owner-leave block, removal/role rules, atomic transfer, cross-circle lockout, revoked sessions) + 9 mobile tests.

### M3 Follow-up — Authorized media download endpoint

- Implemented the documented GET /v1/media/:id/url: authenticated, READY-avatar-only, avatar-visibility rule enforced (self or >=1 shared active Circle with the avatar owner) BEFORE the short-TTL presigned GET is issued; generic 404 on every failure (existence not leaked); Cache-Control no-store; storage keys/credentials never in responses. Deleted Circles lose access. In-memory gateway download URLs are opaque tokens (mirroring R2). 12 integration tests.

### M3 — Profiles

- Server (docs/API.md contract): PATCH /v1/users/me (displayName/bio, explicit update schema, username immutable), POST /v1/users/me/avatar (own READY avatar media only), GET /v1/users/:username (minimal profile: display name + avatar; viewer rule = self or ≥1 shared active Circle, existence hidden), GET /v1/users/me/avatar-url (short-TTL presigned GET for the caller's avatar).
- Media lifecycle (docs/ARCHITECTURE.md §9): POST /v1/media/upload-intent (avatar kind, MIME allowlist, 2 MB cap, non-guessable storage key, presigned POST with pinned Content-Type + content-length-range) and POST /v1/media/:id/confirm (HEAD + size re-check + magic-byte sniff via file-type; failures delete the pending row). Private R2 gateway via S3 API; in-memory gateway for tests; profile/media routes only registered when storage is configured.
- Privacy: shared-cache protection (Cache-Control: no-store on all private profile responses), avatar access requires minimal-profile view permission, no sensitive fields in any response.
- Mobile (Expo): profile screen (avatar placeholder/upload, display name, username read-only, bio, empty states), edit flow (validation, saving state, success/back), avatar picker via expo-image-picker with the full intent→direct-upload→confirm→assign flow; AuthContext gains updateUser so /users/me stays the single identity source.
- Tests: 15 new server integration tests (upload lifecycle, ownership, viewer rules, secret leakage, no-store headers, revoked sessions) + 5 mobile profile tests.

### M2 Follow-up — Revoked-session socket disconnect

- Closed the SECURITY.md §3 gap: change-password, revoke-all-other-sessions and recovery-reset now disconnect the live Socket.IO connections of every revoked session (logout and single-session revoke already did). Revocation helpers return the revoked session IDs; the DB revocation stays authoritative and socket disconnect happens after it, outside the transaction.
- Tests: real Socket.IO clients prove other-session sockets die while the current one survives (change-password, revoke-all), and that recovery-reset disconnects every socket; route-level tests prove the exact revoked session IDs are passed (never the current session's).

### M2 — Authentication

- Server (Fastify + Argon2id + opaque session tokens), implementing docs/API.md exactly:
  - POST /v1/auth/signup → 201 with token, one-time recovery code, user; rate-limited 5/hour.
  - POST /v1/auth/login → token + user; generic INVALID_CREDENTIALS, timing-equalized unknown-username verification, per-username lockout guard (5 failures → 15 min), rate-limited 10/min.
  - POST /v1/auth/change-password (auth) → verifies current password, rehashes, revokes all other sessions; current session stays valid.
  - POST /v1/auth/recovery-reset → verifies recovery-code hash, rotates the code, revokes ALL sessions.
  - POST /v1/auth/logout (auth) → revokes the current session.
  - GET /v1/auth/sessions (auth) with current flag; DELETE /v1/auth/sessions/:id (own only, foreign → 404); DELETE /v1/auth/sessions → revoke all others.
  - GET /v1/users/me (auth) for session bootstrap; GET /v1/users/username-available (rate-limited).
- Security: Argon2id (OWASP baseline, single constant), 256-bit CSPRNG tokens stored as SHA-256 hashes with timing-safe comparison, sliding 30-day expiry, passwords/recovery codes/tokens never logged (logger redact list extended), stable error codes with app-authored messages only.
- Realtime foundation: Socket.IO handshake requires a valid session token; per-session rooms; session revocation force-disconnects that session's sockets. No product events (M5).
- requireAuth opt-in preHandler (config.auth: true); identity derived exclusively from the validated bearer token.
- Mobile (Expo): AuthProvider bootstrap (secure token restore → server validation → authenticated/login routing), login, registration, one-time recovery-code screen, authenticated home placeholder with logout; session token stored only in expo-secure-store; typed API client with stable error surfacing.
- Tests: 80 server (unit: crypto/tokens/guard/config; integration: full auth flows, rate limiting, expiry/revocation, secret-leak prevention) + 8 mobile — all against real PostgreSQL.

### M1 Final Fixes (post-implementation audit)

- Wired Drizzle relations into the runtime schema object (`client.ts` now passes tables + relations; added `db/index.ts` barrel) — relational queries (`db.query.*`) are fully functional and covered by behavioral tests.
- Closed the poll-vote update-path loophole: new trigger (migration `0002_poll_vote_integrity`) rejects options updates that would invalidate existing votes (`POLL_OPTIONS_INVALIDATE_VOTES`); safe updates (question, closes_at, options changes that keep votes valid) remain allowed.
- Circle-capacity concurrency documented with evidence: a deterministic test proves the `FOR UPDATE` circle-row lock serializes competing joins (the trigger is the independent single-writer guard, not the serialization mechanism).

### M1 — Database Foundation

- Drizzle schema for all 15 documented tables (users, sessions, media, circles, circle_members, circle_settings, conversations, conversation_participants, messages, message_reactions, polls, poll_votes, pinboard_items, notifications, conversation_notification_prefs).
- Migrations `0000_m1_schema` (tables/FKs/checks/indexes) and `0001_m1_invariants` (avatar FKs breaking the users/circles↔media cycle; 5-member capacity trigger with `CIRCLE_FULL`; members_count sync; direct-conversation two-participant guard; polls-on-Circle-conversations guard; poll-vote option bound).
- PostgreSQL-level enforcement: username format + case-insensitive uniqueness, one-owner partial unique index, idempotent sends via `(conversation_id, sender_id, client_message_id)`, hashed-only invite storage, keyset pagination indexes, partial unread index.
- Database client foundation (`createDatabase`) — intentionally not wired into the app runtime until M2.
- PostgreSQL integration tests (35) running against a real database: constraint/trigger behavior, cascades, rollback patterns, index presence; hermetic local runs via embedded PostgreSQL (UTF-8), CI via the PostgreSQL 16 service container.

### M0 — Foundation / Scaffold

- npm-workspaces monorepo (`packages/shared`, `apps/server`, `apps/mobile`) with root scripts: `dev:server`, `dev:mobile`, `typecheck`, `lint`, `test`, `build`, `db:generate`, `db:migrate`.
- Strict TypeScript foundation (root base config + per-workspace configs).
- `apps/server`: Fastify 5 bootstrap with Zod-validated env config, secret-redacting pino logging, stable error codes, `GET /health`, Socket.IO attachment (foundation only), clean startup/shutdown; Vitest tests (health, 404 shape, config).
- `packages/shared`: minimal health-status helper shared by server/client; Zod configured for future use; Vitest test.
- `apps/mobile`: Expo SDK 53 + Expo Router scaffold with a single design-token-styled landing screen; jest-expo + React Native Testing Library render test.
- Drizzle wiring only: `drizzle.config.ts` + intentionally empty `src/db/schema.ts` (schema and migrations are M1).
- GitHub Actions CI: lint → typecheck → test → build, with an infrastructure-only PostgreSQL 16 service container for M1+ integration tests.
- `.env.example` placeholders (no real secrets); `.gitignore` excludes `.env` / `.env.*`.

### Documentation Gate

- Finalized the approved technical stack in `docs/ARCHITECTURE.md`.
- Aligned direct-message authorization around `conversation_participants` and the approved shared-Circle DM policy.
- Documented multi-use, expiring, revocable, capacity-limited invites and invite preview.
- Added documentation for change-password session revocation and atomic Circle ownership transfer.
- Clarified notification preferences, avatar access, presigned-upload constraints, GIF upload behavior, socket revocation/rate limits, presence visibility, and accepted username-enumeration risk.
- Removed `circle_settings.status_text` and `polls.allow_multiple` from the documented MVP schema.
- Marked desktop/tablet layouts as post-MVP and standardized profile terminology on `bio`.
- Documented PostgreSQL GitHub Actions service-container integration testing.

No application code or MVP implementation was added by this documentation gate.
