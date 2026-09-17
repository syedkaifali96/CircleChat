# CircleChat — Design System & UX Specification

> **Your little private world.**

## 1. Purpose

This document defines the visual language, UX principles, screen structure, interaction patterns, components, states, accessibility rules, and responsive behavior for CircleChat.

The goal is to give designers and AI coding agents a single design source of truth before implementation.

> Design System: **Warm Hearth**. The shared tokens, 11 migrated components,
> and all 19 migration screens now use warm charcoal, amber and coral with
> Plus Jakarta Sans headings and Inter body text. This replaces the original
> Dark Purple (`#7C3AED`) identity and the intermediate warm-midnight palette.
> Future screens must reuse these tokens and preserve existing interaction rules.

CircleChat is a **private messenger for small Circles of 2–5 people**. It includes both private 1-to-1 chats and private Circle group chats.

**Core design principle:**

> **Make the Circle—not the chat—the hero.**

CircleChat must feel like a small private digital world, not a smaller copy of WhatsApp, Telegram, Messenger, or Discord.

---

## 2. Design Personality

CircleChat should feel:

- Modern
- Private
- Premium
- Clean
- Warm
- Slightly playful
- Personal
- Calm rather than noisy

Avoid:

- Overly corporate UI
- Excessive gradients
- Cluttered dashboards
- Too many floating buttons
- Generic social-media layouts
- Copying WhatsApp/Telegram visual patterns
- Heavy glassmorphism everywhere
- Excessive animations

The interface should communicate **"this is our little space"** rather than **"this is another social network."**

---

## 3. Visual Identity

### 3.1 Color Palette — Warm Hearth

> Migration note (2026-09): the implemented palette moved from the earlier
> warm-midnight blues (`#0B1020`/`#151E30`) to Warm Hearth. Screens, shared
> components, and auth components now consume only tokens from
> `apps/mobile/src/design/tokens.ts`; the hex values below are the token
> definitions. Circle theme preset enum names (`dark_purple`, `midnight`,
> `orchid`, `ember`) are unchanged for API compatibility — server-validated
> names stay stable even though the preset visuals are warm now (V2 debt:
> revisit names when the API can version them).

Primary Amber (firelight): `#F59E0B`

Amber Deep (pressed): `#D97706`

Warm Coral accent: `#E06D53`

Terracotta member/accent token: `#E87A4F` (formerly `#C85A32`). Normal-text
contrast is 6.45:1 on the canvas, 5.97:1 on the surface and 5.69:1 on the
elevated surface. The shared token also supplies the Velvet Dusk accent and
avatar fallbacks; persisted custom accent values are not rewritten.

Background (warm charcoal): `#161311`

Surface (elevated): `#1F1B18`

Primary Text (warm pearl): `#F5F0EB`

Recommended supporting colors:

- Secondary text: `#A89F91`
- Muted text: `#78716C`
- Border: `#332B25`
- Success: `#4CD69A`
- Warning: `#F59E0B`
- Error: `#EF4444`
- Info: `#F59E0B`

Supporting colors should be used sparingly. Amber carries primary actions while
coral adds warmth to secondary highlights. Neither color should become a
full-screen wash or decorative glow.

### 3.2 Color Usage

- Primary amber: primary actions, unread indicators, and high-priority interactive elements.
- Warm coral: identity accents (member colors, avatars) and subtle focus states.
- Warm charcoal background: application shell and dark-mode page background.
- Surface: cards, panels, dialogs, chat composer, navigation surfaces.
- Text: high-priority content.
- Muted text: metadata, timestamps, secondary descriptions.

Avoid decorative glows and repeated outlined cards. Hierarchy should come from
spacing, typography, restrained surface contrast, and one clear primary action.

### 3.3 Typography

Headings: **Plus Jakarta Sans** (600/700). Body, captions and buttons: **Inter** (400/500/600/700). Fonts are bundled through Expo Google Fonts and loaded before the navigation tree renders; use the `typography` tokens rather than raw font-family names.

Suggested scale:

| Token | Size | Weight | Usage |
|---|---:|---:|---|
| Display | 32px | 700 | Welcome/hero headings |
| H1 | 28px | 700 | Page headings |
| H2 | 22px | 700 | Section headings |
| H3 | 18px | 600 | Card/group headings |
| Body | 15–16px | 400 | Main content |
| Body Strong | 15–16px | 600 | Names/actions |
| Caption | 12–13px | 400 | Metadata/timestamps |
| Button | 14–15px | 600 | Buttons |

Use sentence case. Avoid unnecessary ALL CAPS.

---

## 4. Spacing & Shape

Use a consistent 4px base spacing system.

Suggested spacing tokens: `4px`, `8px`, `12px`, `16px`, `20px`, `24px`, `32px`, `48px`.

### Border Radius

- Small controls: `8px`
- Inputs/buttons: `10–12px`
- Cards: `14–16px`
- Chat bubbles: `16–18px`
- Avatars: `50%`
- Large dialogs/sheets: `20–24px`

The UI should feel soft and friendly without making every element extremely rounded.

---

## 5. Elevation & Borders

Prefer subtle borders and low-contrast elevation over heavy shadows.

Use thin borders for separation and soft shadows only for dialogs, menus, and elevated surfaces. Avoid strong black shadows around every card.

The dark UI must have enough contrast to clearly separate background, surfaces, and interactive elements.

---

## 6. Iconography

Use one consistent icon family throughout the product.

Icons should be simple, easy to understand, consistent in stroke weight, and never decorative when an action is required.

Examples: Message, Users/Circle, Plus, Search, Settings, Lock, Bell, Image, Video, Mic, Smile, Pin, Poll, More.

Do not mix unrelated icon styles. Every icon-only button must have an accessible label.

---

## 6.1 Shared Component Library Specifications

The application uses an in-house, zero-external-dependency shared component suite defined in `apps/mobile/src/components/`:

### 1. Button (`Button.tsx`)
- **Variants:** `primary` (amber solid with dark primary-content text), `secondary` (warm elevated surface), `outline` (transparent with amber border), `danger` (error red), `ghost` (transparent).
- **Sizes:** `sm` (compact, for list items), `md` (standard actions), `lg` (hero buttons).
- **Micro-interactions:** Interactive press scale (`0.98`) and opacity transition (`0.88`), integrated loading spinner with disabled state.
- **Icons:** Supports leading (`icon`) and trailing (`iconTrailing`) icon slots.

### 2. Avatar & AvatarGroup (`Avatar.tsx`, `AvatarGroup.tsx`)
- **Sizes:** `xs` (24px), `sm` (32px), `md` (44px), `lg` (56px), `xl` (72px).
- **Fallbacks:** Initial character with deterministic vibrant palette background based on string hash.
- **Presence Dot:** Cutout green dot indicator at bottom-right for online status.
- **AvatarGroup:** Overlapping stacked member avatars with custom overlap scale and `+N` remaining counter bubble.

### 3. Card (`Card.tsx`)
- **Surface:** Warm `colors.surface` with `colors.border` and radius from `radii.xl`.
- **Variants:** `default` (standard surface), `elevated` (`colors.surfaceElevated`), `glass` (`colors.surfaceGlass`).
- **Interactive:** Optional `onPress` activates tactile press micro-animation (`scale: 0.985`, active border highlight).

### 4. Badge & Pill (`Badge.tsx`)
- **Variants:** `primary` / `unread` (amber for message badges), `role` (warm coral for Owner/Admin/Member), `success`, `warning`, `error`.
- **Shape:** Full pill radius (`radii.full`), bold legible typography.

### 5. Input (`Input.tsx`)
- **Focus State:** Active focus ring transitioning border to `colors.primary` with restrained amber emphasis.
- **Slots:** Leading icon (e.g. search, lock), trailing icon, error message, helper text.

### 6. EmptyState (`EmptyState.tsx`)
- **Structure:** Glowing circular icon badge, bold title, soft descriptive subtitle, action button slot. Replaces dry gray boxes with welcoming visual guidance.

### 7. BottomNav (`BottomNav.tsx`)
- **Structure:** Docked bottom navigation surface housing `Circles`, `Chats`, and `Profile`.
- **Indicator:** Quiet warm-charcoal surface with an amber active label; no glowing pill.


---

## 7. Layout Philosophy

### MVP scope

**Mobile is the first-class and only primary client layout for MVP.** Android is the first target, with iOS later from the same mobile codebase.

**Desktop and tablet layouts are POST-MVP.** The layout guidance below is retained for future implementation planning, but AI agents must not build desktop/tablet-specific UI during MVP unless explicitly approved.

### Desktop — POST-MVP

Use a focused messenger layout rather than a full enterprise dashboard.

```text
┌──────────────────────────────────────────────────────────────┐
│                         CircleChat                           │
├──────────────┬───────────────────────┬───────────────────────┤
│ Navigation   │ Main Content           │ Context Panel         │
│ Circles      │ Circle Home / Chat     │ Members / Details     │
│ Private      │                        │ optional              │
│ Chats        │                        │                       │
│ Settings     │                        │                       │
└──────────────┴───────────────────────┴───────────────────────┘
```

Do not force a third column on every screen.

### Mobile — MVP

```text
┌─────────────────────────┐
│ Header                  │
├─────────────────────────┤
│ Main content            │
│                         │
├─────────────────────────┤
│ Bottom navigation       │
└─────────────────────────┘
```

Chat should use the full available width.

---

## 8. Navigation

Keep navigation simple.

Primary destinations:

1. **Home** — Circles and recent conversations.
2. **Chats** — private 1-to-1 conversations.
3. **Activity** — relevant Circle activity where implemented.
4. **Settings** — account, privacy, notifications, appearance, app lock.

On smaller screens, avoid more than 4–5 primary navigation destinations.

Circle-specific navigation should live inside the Circle rather than creating many global tabs.

---

## 9. Home Screen

The Home screen should make Circles immediately visible.

### Structure

```text
Greeting / profile

Featured Circle

Your Circles
- Circle avatar, name, member count, role
- Unread indicator only when needed

Quick actions: Create Circle / Join with code
```

### Circle Card

Show Circle avatar, name, member count, role, and unread indicator when needed.
Use flat list rows for the full collection; reserve the elevated hero surface
for one featured Circle only.

### Empty State

> **Your little world starts here.**
>
> Create a Circle or join one with an invite code.

Primary: **Create a Circle**. Secondary: **Join a Circle**.

---

## 10. Circle Home

Circle Home should feel like entering a shared private space.

### Header

Show Circle avatar, name, member count, and more/settings action.

### Main Sections

1. Circle identity/header
2. Latest activity
3. Pinned content
4. Polls
5. Memories/events when available
6. Open Circle Chat

Keep it lightweight rather than turning it into a dashboard.

### Circle Identity

Each Circle can have:

- Name
- Avatar
- Theme/accent
- Short **description**

Example:

```text
        [Circle Avatar]

          Night Owls
        4 members

       "No sleep club 🌙"
```

---

## 11. Circle Chat

Circle Chat is the primary messaging experience inside a Circle.

### Header

Show Circle avatar, name, member count, optional typing indicator, and more menu.

### Message Layout

Prioritize readability. Show sender name when necessary, especially for group messages. Keep metadata subtle.

### Message Actions

Long press on mobile (and right-click in future desktop scope) can expose:

- Reply
- React
- Copy
- Edit (own messages)
- Delete (according to product rules)
- Pin where supported
- More

Do not display every action permanently beside every message.

### Composer

```text
[ + ] [ Write a message...                        ] [ ↑ ]
```

Attachment options live behind the plus action and can include Photo, Video,
Voice, and GIF where supported. The composer uses the live safe-area inset,
remains easy to reach, and shows one compact send action only when text can be
sent.

Conversations open at the newest message. Older history loads only when the
user reaches the top, prepending without jumping the visible content. A message
received while the chat is open must refresh the REST-authoritative history and
advance the read pointer so unread badges remain accurate.

---

## 12. Private 1-to-1 Chat

Private Chat should be familiar enough to use while remaining part of CircleChat's identity.

Header:

- Avatar
- Display name
- Username
- Online/last-seen state when implemented and permitted
- More menu

A user may start a private chat only with another user who shares at least one **active Circle** with them. The private conversation remains separate from Circles and has no Circle features.

The experience should clearly communicate that the conversation is private and should not be confused with Circle group chats.

---

## 13. Chat Bubble Design

Use subtle visual distinction between incoming and outgoing messages. Outgoing
messages use the theme primary role with a contrast-safe text role; incoming
messages use a quiet neutral surface. Avoid bubble borders unless communicating
a special state such as deletion or failure.

Message bubbles should support multiline text, media previews, reactions, long usernames, and long URLs without breaking layout.

---

## 14. Media Messages

### Images

Use rounded previews, preserve aspect ratio, open into a focused viewer, show upload progress, and provide retry state on failure.

### Videos

Show thumbnail, clear play control, and simple playback UI.

### Voice Messages

```text
[ ▶ ] ───── waveform/progress ───── 0:18
```

Include playback progress and duration without letting the voice UI dominate the conversation.

External GIF search is implemented through GIPHY with visible provider
attribution. Results render inline without passing GIF bytes through CircleChat
storage. Uploaded GIF files may still use the normal image path when supported.

---

## 15. Reactions & Replies

Reactions should feel lightweight. Recommended quick reactions: ❤️ 😂 👍 😮 😢 🔥.

Replies should show a compact referenced-message preview above the reply.

---

## 16. Pinboard

The Pinboard is a Circle-level shared space for important things such as an important message, address, plan, link, reminder, or shared note.

Design it as a clean collection, not a document editor. Each item shows content, author, date, optional preview, and pin/remove action.

---

## 17. Polls

Poll cards should be compact and easy to answer.

```text
Where should we go?

○ Beach
██████████  3 votes

○ Cinema
██████      2 votes

○ Food street
████        1 vote

[ Vote ]
```

MVP polls are **single-choice**. After voting, clearly show the user's selected option and prevent accidental multiple submissions.

---

## 18. Profiles

Profile should show:

- Avatar
- Display name
- Username
- **Bio**

Username is fixed after account creation in MVP and is not editable. Do not make profiles feel like public social-media profiles.

---

## 19. Create Circle Flow

```text
Create Circle
      ↓
Choose Circle name
      ↓
Choose avatar/theme (optional)
      ↓
Circle created
      ↓
Invite people
      ↓
Circle Home
```

Keep setup short. Do not require users to customize everything before entering the Circle.

### Invite UI

Clearly show:

- Invite code/link
- Copy action
- Share action where supported
- Current member count
- Remaining capacity
- Invite expiry/revocation state where useful

Invites are **multi-use while active**, but are limited by the Circle's 5-member capacity, expire, and can be revoked. The raw invite code is shown only once.

Example:

> **3 of 5 members**
>
> You can invite 2 more people.

The 5-member limit is enforced by backend authorization, not only UI.

---

## 20. Join Circle Flow

```text
Join Circle
      ↓
Enter invite code/link
      ↓
Preview Circle
      ↓
Confirm
      ↓
Circle Home
```

Circle preview can show only:

- Circle avatar
- Circle name
- Member count
- Short description

Do not expose unnecessary private information before joining. Preview must be based on a valid, active, non-expired, non-revoked invite.

---

## 21. Authentication Screens

Required screens:

- Welcome
- Create account
- Sign in
- Recovery code
- Password recovery
- Session/device management

### Welcome

```text
        CircleChat

   Your little private world.

   [ Create account ]
   [ Sign in ]
```

No phone number is mandatory. No unnecessary onboarding carousel.

### Recovery Code

Because email/phone are not mandatory, recovery must be clearly explained.

> **Save your recovery code**
>
> It may be the only way to recover your account if you forget your password.

Never reveal recovery codes after creation unless the security architecture explicitly supports safe recovery-code management.

---

## 22. App Lock

App Lock is a local privacy layer.

Settings may allow:

- Off
- Immediately
- After 1 minute
- After 5 minutes
- After 15 minutes
- On app restart

Biometric unlock uses platform capability rather than custom biometric handling.

### Locked Screen

```text
        [ CircleChat logo ]

          App locked

      [ Unlock with PIN ]
      [ Use biometrics ]
```

The locked state should not reveal private message previews.

---

## 23. Settings

### Account

- Profile
- **Username (fixed; display only in MVP)**
- Password
- Recovery
- Sessions/devices

### Privacy & Security

- App lock
- Active sessions
- Privacy controls
- Security information

### Notifications

- Global notifications
- Per-conversation settings
- Custom sound where supported
- Silent/muted conversation
- Mentions where applicable
- Message previews

### Appearance

- Dark/light mode where supported
- Theme
- Accent color
- Chat background

### Circle Settings

Only inside a Circle:

- Circle name
- Avatar
- Theme
- Members
- Roles
- Invite management
- Leave Circle

Account deletion is **post-MVP** and must not be presented as an MVP setting or flow.

Keep destructive actions visually separated.

---

## 24. Themes & Personalization

Personalization should not destroy readability.

Users may customize Circle theme, accent color, chat background, and supported appearance settings.

User-selected colors must pass readable contrast requirements.

---

## 25. Notifications

Notifications should be useful without becoming noisy.

Support:

- Global notification enable/disable
- Per-conversation notification settings
- Muted/silent conversations
- Mentions where applicable
- Custom sound where platform supports it
- Message preview privacy

Server-side notification decisions must respect these preferences. On locked screens, avoid exposing sensitive message content when previews are disabled.

---

## 26. Loading States

Never leave a blank screen while content is loading. Use skeletons for lists, small inline spinners for actions, upload progress for media, and clear loading text only when necessary.

Avoid excessive skeleton animation.

---

## 27. Empty States

### No Chats

> **No private chats yet.**
>
> Start a conversation with someone in your Circle.

### No Pins

> **Nothing pinned yet.**
>
> Save something important for everyone to find later.

### No Polls

> **No polls yet.**
>
> Ask the Circle a question.

### No Memories

> **Your shared memories will live here.**

Avoid generic "No data found."

---

## 28. Error States

Errors should be understandable and actionable.

Bad:

> Error 500

Better:

> **Something went wrong.**
> Your message wasn't sent. Check your connection and try again.
>
> [ Try again ]

Do not expose raw stack traces or internal server information.

---

## 29. Confirmation & Destructive Actions

Use confirmation dialogs only for meaningful destructive actions, such as deleting a message, leaving a Circle, or removing a member.

Example:

> **Leave this Circle?**
>
> You will no longer be able to access this Circle unless invited again.
>
> [ Cancel ] [ Leave Circle ]

Account deletion is not an MVP action because it is deferred to post-MVP.

---

## 30. Toasts & Feedback

Use short, clear feedback messages:

- `Message deleted`
- `Copied to clipboard`
- `Circle created`
- `Invite copied`
- `Settings saved`
- `Upload failed — Try again`

Toasts should not contain long paragraphs.

---

## 31. Motion & Animation

Motion should communicate state, not decorate everything.

Recommended: 150–250ms small UI transitions, smooth dialogs/sheets, subtle message appearance, upload progress, and button feedback.

Avoid constant floating animations, excessive bounce effects, long transitions, or motion that delays common actions.

Respect platform reduced-motion settings.

---

## 32. Accessibility

Accessibility is required.

Minimum requirements:

- Accessible labels for icon-only buttons
- Sufficient color contrast
- Readable text when enlarged
- Do not communicate information through color alone
- Screen-reader-friendly form labels
- Comfortable touch targets
- Reduced-motion support

Desktop keyboard/focus guidance is retained for the post-MVP desktop client; MVP is mobile-first.

---

## 33. Responsive Rules

### Small Mobile — MVP

Prioritize chat, composer, navigation, and Circle identity. Hide secondary panels behind menus/sheets.

### Tablet — POST-MVP

A two-column layout may be used where useful after MVP.

### Desktop — POST-MVP

Use wider layouts while preserving focused reading width for conversations. Do not stretch message content across the entire monitor.

AI agents must not implement tablet/desktop-specific layouts during MVP without explicit approval.

---

## 34. Privacy-First UX

Privacy should be visible through product behavior, not marketing claims.

Design rules:

- Never expose private message content in unexpected places.
- Respect notification preview settings.
- Make account/session controls easy to find.
- Clearly distinguish private chats from Circle chats.
- Do not expose Circle information before joining unnecessarily.
- Avoid collecting UI information the product does not need.
- Never claim the app is "100% secure" or "unhackable."

Security-sensitive actions should use clear explanations rather than scary language.

---

## 35. Microcopy Style

Use language that is short, human, clear, friendly, and calm.

Good examples:

- `Create your Circle`
- `Invite your people`
- `Your little world starts here.`
- `Nothing pinned yet.`
- `Try again`
- `Circle created`

Avoid corporate jargon, fake urgency, and long technical explanations in normal UI.

---

## 36. Component Library

Core components:

- Button
- IconButton
- Input
- PasswordInput
- Avatar
- CircleAvatar
- Badge
- Chip
- Card
- Dialog
- BottomSheet
- Dropdown/Menu
- Toast
- Tooltip
- Tabs
- NavigationBar
- Sidebar (post-MVP desktop)
- MessageBubble
- MediaMessage
- VoiceMessage
- ReactionPicker
- ReplyPreview
- ChatComposer
- CircleCard
- MemberList
- PollCard
- PinCard
- EmptyState
- ErrorState
- Skeleton
- UploadProgress

Components should support consistent states and accessibility.

---

## 37. Component States

Interactive components should account for:

- Default
- Hover (post-MVP desktop)
- Focus
- Active
- Selected
- Disabled
- Loading
- Error
- Success
- Empty

AI coding agents must not implement only the happy path.

---

## 38. Important Chat States

The chat UI must handle:

1. Empty conversation
2. Loading history
3. Sending message
4. Message sent
5. Message failed
6. Retrying
7. Uploading media
8. Upload failed
9. Offline/reconnecting
10. Typing indicator
11. Replying
12. Editing
13. Message deleted
14. Long message
15. Very long URL
16. Large image/video
17. Many reactions
18. Unread messages
19. Opening at the newest message
20. Loading older history from the top without a scroll jump
21. Realtime edit/delete/new-message refresh while the chat remains open

No state should break the layout.

---

## 39. Security-Sensitive UI States

The design must support:

- Locked app
- Expired session
- New device/session
- Invalid recovery code
- Password change
- Circle access denied
- Invite expired/revoked
- Circle full

Account deletion is post-MVP and is intentionally excluded from the MVP state list.

Never show sensitive backend details in these states.

---

## 40. Design Do / Don't

### Do

- Make Circles visually important.
- Keep the interface calm.
- Use coral for primary action and lavender as a restrained identity accent.
- Prioritize readability.
- Keep private conversations clearly private.
- Use reusable components.
- Treat mobile as the MVP first-class experience.
- Handle loading/error/empty states.
- Preserve accessibility.
- Keep personalization readable.
- Keep desktop/tablet work post-MVP.

### Don't

- Clone WhatsApp.
- Clone Telegram.
- Add random features just because they are easy to code.
- Fill every screen with cards.
- Use gradients everywhere.
- Hide important settings.
- Make unverifiable security claims.
- Design only the successful state.
- Put too many actions beside every message.
- Let Circle customization destroy usability.
- Implement desktop/tablet layouts during MVP without approval.

---

## 41. MVP Design Priority

### P0 — Must Feel Excellent

- Welcome/authentication
- Home
- Circle creation/joining
- Circle Home
- Circle Chat
- Private 1-to-1 Chat
- Message composer
- Text messaging
- Basic media messaging
- Profiles
- App lock
- Settings

### P1 — Important

- Reactions
- Replies
- Edit/delete
- Pinboard
- Polls
- Notification settings
- Circle customization
- Session/device management

### P2 — Later

- Stickers
- Memories
- Mood
- Events/countdowns
- Disappearing moments
- Additional themes and richer appearance controls

### Experimental

- AI Circle prompts
- Circle personality
- Memory resurfacing
- Mini-games
- Inside-joke cards
- Message effects

Do not allow experimental features to delay the core messaging experience.

---

## 42. AI Coding Agent Rules

Any AI coding agent working on CircleChat must read:

1. `README.md`
2. `docs/CircleChat_Product_Specification.md`
3. `docs/CircleChat_AI_Build_Plan.md`
4. `docs/ARCHITECTURE.md`
5. `docs/DATABASE.md`
6. `docs/SECURITY.md`
7. `docs/API.md`
8. `design.md`
9. `AGENTS.md`

Before implementing a UI feature, the agent should:

1. Identify the screen and user goal.
2. Reuse existing design tokens/components.
3. Check mobile behavior first.
4. Keep desktop/tablet behavior out of MVP unless explicitly approved.
5. Define loading, empty, error, and success states.
6. Check accessibility.
7. Avoid introducing a new visual style without a clear reason.
8. Keep implementation consistent with the Circle-first product philosophy.

Do not generate an entirely new UI pattern for every feature.

---

## 43. Design Acceptance Checklist

A UI feature is not considered complete until:

- [ ] It follows the CircleChat visual system.
- [ ] It works on mobile.
- [ ] It does not introduce desktop/tablet MVP scope.
- [ ] Typography and spacing are consistent.
- [ ] Interactive states exist.
- [ ] Loading state exists where needed.
- [ ] Empty state exists where needed.
- [ ] Error state exists where needed.
- [ ] Accessibility labels/focus behavior are present where applicable.
- [ ] Long content does not break the layout.
- [ ] The design does not expose unnecessary private information.
- [ ] Existing reusable components are used where possible.
- [ ] No unnecessary dependency or UI library is introduced.
- [ ] The feature feels like CircleChat rather than another messenger clone.

---

## 44. Final Design Direction

CircleChat should feel like opening a **small private room made for your people**.

The design should be polished enough to feel premium, simple enough to understand immediately, and playful enough to feel personal.

The strongest visual/product idea is not a message bubble, a sidebar, or a fancy animation.

It is the **Circle itself**.

> **CircleChat — Your little private world.**
