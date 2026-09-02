# CircleChat — Design System & UX Specification

> **Your little private world.**

## 1. Purpose

This document defines the visual language, UX principles, screen structure, interaction patterns, components, states, accessibility rules, and responsive behavior for CircleChat.

The goal is to give designers and AI coding agents a single design source of truth before implementation.

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

### 3.1 Color Palette

Primary Purple: `#7C3AED`

Deep Background: `#0B0714`

Surface: `#171225`

Accent Lavender: `#A78BFA`

Primary Text: `#F5F3FF`

Recommended supporting colors:

- Secondary text: `#B8B2C8`
- Muted text: `#81798F`
- Border: `#29223A`
- Success: `#22C55E`
- Warning: `#F59E0B`
- Error: `#EF4444`
- Info: `#60A5FA`

Supporting colors should be used sparingly. Purple remains the main brand identity.

### 3.2 Color Usage

- Primary purple: primary actions, selected navigation, important interactive elements.
- Lavender: highlights, secondary accents, subtle focus states.
- Deep background: application shell and dark-mode page background.
- Surface: cards, panels, dialogs, chat composer, navigation surfaces.
- Text: high-priority content only.
- Muted text: metadata, timestamps, secondary descriptions.

Do not use bright purple for every element. The UI should have visual hierarchy.

### 3.3 Typography

Primary font: **Inter**.

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

Suggested spacing tokens:

- `4px` — tiny gaps
- `8px` — icon/text gaps
- `12px` — compact padding
- `16px` — standard padding
- `20px` — comfortable padding
- `24px` — section spacing
- `32px` — major spacing
- `48px` — hero spacing

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

Use:

- Thin borders for separation.
- Soft shadows only for dialogs, menus, and elevated surfaces.
- No strong black shadows around every card.

The dark UI should have enough contrast to clearly separate the background, surfaces, and interactive elements.

---

## 6. Iconography

Use one consistent icon family throughout the product.

Icons should be:

- Simple
- Rounded where appropriate
- Easy to understand
- Consistent in stroke weight
- Never decorative when an action is required

Examples:

- Message
- Users/Circle
- Plus
- Search
- Settings
- Lock
- Bell
- Image
- Video
- Mic
- Smile
- Pin
- Poll
- More

Do not mix multiple unrelated icon styles.

Every icon-only button must have an accessible label.

---

## 7. Layout Philosophy

### Desktop

Use a focused messenger layout rather than a full enterprise dashboard.

Recommended structure:

```text
┌──────────────────────────────────────────────────────────────┐
│                         CircleChat                           │
├──────────────┬───────────────────────┬───────────────────────┤
│ Navigation   │ Main Content           │ Context Panel         │
│              │                        │ optional              │
│ Circles      │ Circle Home / Chat     │ Members / Details     │
│ Private      │                        │                       │
│ Chats        │                        │                       │
│ Settings     │                        │                       │
└──────────────┴───────────────────────┴───────────────────────┘
```

Do not force a third column on every screen. Context panels should appear only when useful.

### Mobile

Mobile is a first-class experience.

Recommended structure:

```text
┌─────────────────────────┐
│ Header                  │
├─────────────────────────┤
│                         │
│ Main content            │
│                         │
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

Your Circles
┌─────────────────────────────┐
│ Circle avatar   Circle name │
│                 3 members   │
│                 latest text │
└─────────────────────────────┘

Recent private chats

Quick actions
- Create Circle
- Join Circle
```

### Circle Card

A Circle card should show:

- Circle avatar
- Circle name
- Member count
- Latest activity/message preview
- Unread indicator when needed

Avoid showing too much metadata.

### Empty State

If the user has no Circles:

> **Your little world starts here.**
>
> Create a Circle or join one with an invite code.

Primary action: **Create a Circle**

Secondary action: **Join a Circle**

---

## 10. Circle Home

Circle Home is one of the most important differentiators of CircleChat.

It should feel like entering a shared private space.

### Header

Show:

- Circle avatar
- Circle name
- Member count
- More/settings action

### Main Sections

Recommended order:

1. Circle identity/header
2. Latest activity
3. Pinned content
4. Polls
5. Memories/events when available
6. Open Circle Chat

The Circle Home should not become a dashboard full of widgets. Keep it lightweight.

### Circle Identity

Each Circle can have:

- Name
- Avatar
- Theme/accent
- Short status/description

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

Show:

- Circle avatar
- Circle name
- Member count
- Optional typing indicator
- More menu

### Message Layout

Messages should prioritize readability.

Show sender name when necessary, especially for group messages.

Message metadata should remain subtle.

### Message Actions

Long press/right click should expose:

- Reply
- React
- Copy
- Edit (own messages)
- Delete (according to product rules)
- Pin where supported
- More

Do not display every action permanently beside every message.

### Composer

Recommended structure:

```text
[ + ] [ Write a message...                 ] [ 😊 ] [ 🎙 ]
```

The attachment button opens:

- Photo
- Video
- File if supported
- Camera where supported

The composer should remain easy to reach on mobile.

---

## 12. Private 1-to-1 Chat

Private Chat should look familiar enough to be usable but visually remain part of CircleChat's identity.

Header:

- Avatar
- Display name
- Username
- Online/last-seen state only if implemented
- More menu

The experience should clearly communicate that the conversation is private.

Avoid confusing private chats with Circle group chats.

---

## 13. Chat Bubble Design

Use subtle visual distinction between incoming and outgoing messages.

Outgoing messages can use the primary purple family.

Incoming messages should use a neutral surface color.

Do not use extremely saturated colors for large message areas.

Message bubbles should:

- Have readable line length
- Support multiline text
- Support media previews
- Show reactions without covering the message
- Handle long usernames safely
- Wrap long text/URLs without breaking the layout

---

## 14. Media Messages

### Images

- Use rounded previews.
- Preserve aspect ratio.
- Open into a focused viewer.
- Show loading state while uploading.
- Show retry state if upload fails.

### Videos

- Show thumbnail.
- Provide clear play control.
- Keep playback UI simple.

### Voice Messages

Use a compact player:

```text
[ ▶ ] ───── waveform/progress ───── 0:18
```

Include playback progress and duration.

Never make the voice-message UI visually dominate the conversation.

---

## 15. Reactions & Replies

Reactions should feel lightweight.

Recommended quick reactions:

- ❤️
- 😂
- 👍
- 😮
- 😢
- 🔥

Users should be able to open a larger emoji picker when needed.

Replies should show a compact referenced-message preview above the reply.

---

## 16. Pinboard

The Pinboard is a Circle-level shared space for important things.

Examples:

- Important message
- Address
- Plan
- Link
- Reminder
- Shared note

Design it as a clean collection, not a complicated document editor.

Each item should show:

- Content
- Author
- Date
- Optional preview
- Pin/remove action

---

## 17. Polls

Poll cards should be compact and easy to answer.

Example:

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

After voting, clearly show the user's selected option.

Prevent accidental multiple submissions according to the poll rules.

---

## 18. Profiles

Profile should show:

- Avatar
- Display name
- Username
- Status
- About/bio

Do not make profile pages feel like public social-media profiles.

The product is private by design.

---

## 19. Create Circle Flow

Recommended flow:

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

Keep the initial setup short.

Do not require users to customize everything before entering the Circle.

### Invite UI

Clearly show:

- Invite code/link
- Copy action
- Share action where supported
- Current member count
- Remaining capacity

Example:

> **3 of 5 members**
>
> You can invite 2 more people.

The 5-member limit must be respected by backend authorization, not only by the UI.

---

## 20. Join Circle Flow

Recommended flow:

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

Circle preview can show:

- Circle avatar
- Circle name
- Member count
- Short description

Do not expose unnecessary private information before joining.

---

## 21. Authentication Screens

Required screens:

- Welcome
- Create account
- Sign in
- Recovery code
- Password recovery
- Optional session/device management

### Welcome

Keep it minimal.

```text
        CircleChat

   Your little private world.

   [ Create account ]
   [ Sign in ]
```

No phone number should be presented as mandatory.

No unnecessary onboarding carousel.

### Recovery Code

Because email/phone are not mandatory, recovery must be clearly explained.

Example:

> **Save your recovery code**
>
> It may be the only way to recover your account if you forget your password.

Never reveal recovery codes after creation unless the security architecture explicitly supports safe recovery-code management.

---

## 22. App Lock

App Lock is a local privacy layer.

Settings should allow supported options such as:

- Off
- Immediately
- After 1 minute
- After 5 minutes
- After 15 minutes
- On app restart

Supported biometric unlock should use the device/platform capability rather than custom biometric handling.

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

Organize settings into clear sections.

### Account

- Profile
- Username
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
- Per-chat settings
- Custom sound
- Silent chat
- Message previews

### Appearance

- Dark/light mode where supported
- Theme
- Accent color
- Chat background

### Circle Settings

Only when inside a Circle:

- Circle name
- Avatar
- Theme
- Members
- Roles
- Invite management
- Leave Circle

Keep destructive actions visually separated.

---

## 24. Themes & Personalization

Personalization is a major part of the product identity, but it should not destroy readability.

Users may customize:

- Circle theme
- Accent color
- Chat background
- Dark/light appearance

### Theme Rule

User-selected colors must pass readable contrast requirements.

Do not allow a customization option to make buttons, text, or message content unreadable.

---

## 25. Notifications

Notifications should be useful without becoming noisy.

Support:

- Global notification preferences
- Per-chat notification settings
- Silent chat
- Custom sound where platform supports it
- Message preview control

On locked screens, respect the user's privacy preference and avoid exposing sensitive message content when previews are disabled.

---

## 26. Loading States

Never leave a blank screen while content is loading.

Use:

- Skeletons for lists
- Small inline spinners for actions
- Upload progress for media
- Clear loading text only when necessary

Avoid excessive skeleton animation.

---

## 27. Empty States

Empty states should explain what the user can do next.

Examples:

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

Avoid generic messages such as "No data found."

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

Do not expose raw stack traces or internal server information to users.

---

## 29. Confirmation & Destructive Actions

Use confirmation dialogs only for meaningful destructive actions.

Examples:

- Delete message
- Leave Circle
- Remove member
- Delete account

The dialog should clearly state what happens next.

Example:

> **Leave this Circle?**
>
> You will no longer be able to access this Circle unless invited again.
>
> [ Cancel ] [ Leave Circle ]

Avoid confirmation dialogs for harmless actions.

---

## 30. Toasts & Feedback

Use short, clear feedback messages.

Examples:

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

Recommended:

- 150–250ms for small UI transitions
- Smooth panel/dialog transitions
- Subtle message appearance
- Upload progress
- Button feedback

Avoid:

- Constant floating animations
- Excessive bounce effects
- Long transitions
- Motion that delays common actions

Respect `prefers-reduced-motion` on web and equivalent platform settings on mobile.

---

## 32. Accessibility

Accessibility is required, not optional.

Minimum requirements:

- Keyboard navigation on web
- Visible focus states
- Semantic buttons and controls
- Accessible labels for icon-only buttons
- Sufficient color contrast
- Text should remain readable when enlarged
- Do not communicate information through color alone
- Screen-reader-friendly form labels
- Touch targets should be comfortably tappable
- Reduced-motion support

Never rely on hover as the only way to access an action.

---

## 33. Responsive Rules

### Small Mobile

Prioritize:

- Chat
- Composer
- Navigation
- Circle identity

Hide secondary panels behind menus/sheets.

### Tablet

Allow a two-column layout where useful.

### Desktop

Use wider layouts while preserving a focused reading width for conversations.

Do not stretch message content across the entire monitor.

---

## 34. Privacy-First UX

Privacy should be visible through product behavior, not marketing claims.

Design rules:

- Never expose private message content in unexpected places.
- Respect notification preview settings.
- Make account/session controls easy to find.
- Clearly distinguish private chats from Circle chats.
- Do not expose Circle information before joining unnecessarily.
- Avoid collecting UI information that the product does not need.
- Never claim the app is "100% secure" or "unhackable."

Security-sensitive actions should use clear explanations rather than scary language.

---

## 35. Microcopy Style

Use language that is:

- Short
- Human
- Clear
- Friendly
- Calm

Good examples:

- `Create your Circle`
- `Invite your people`
- `Your little world starts here.`
- `Nothing pinned yet.`
- `Try again`
- `Circle created`

Avoid:

- Corporate jargon
- Long technical explanations in normal UI
- Aggressive warning language
- Fake urgency

Technical/security explanations can be detailed inside dedicated settings/help screens.

---

## 36. Component Library

The implementation should build reusable components instead of designing each screen independently.

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
- Sidebar
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
- Hover
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

No state should break the layout.

---

## 39. Security-Sensitive UI States

The design must support:

- Locked app
- Expired session
- New device/session
- Invalid recovery code
- Password change
- Account deletion
- Circle access denied
- Invite expired
- Circle full

Never show sensitive backend details in these states.

---

## 40. Design Do / Don't

### Do

- Make Circles visually important.
- Keep the interface calm.
- Use purple as an identity accent.
- Prioritize readability.
- Keep private conversations clearly private.
- Use reusable components.
- Design mobile and desktop together.
- Handle loading/error/empty states.
- Preserve accessibility.
- Keep personalization readable.

### Don't

- Clone WhatsApp.
- Clone Telegram.
- Add random features just because they are easy to code.
- Fill every screen with cards.
- Use gradients everywhere.
- Hide important settings.
- Make security claims that cannot be verified.
- Design only the successful state.
- Put too many actions beside every message.
- Let Circle customization destroy usability.

---

## 41. MVP Design Priority

The first implementation should prioritize:

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

- GIFs
- Stickers
- Memories
- Mood
- Events/countdowns
- Disappearing moments
- Advanced themes

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
4. `design.md`

These documents should be treated as project-level product/design guidance.

Before implementing a UI feature, the agent should:

1. Identify the screen and user goal.
2. Reuse existing design tokens/components.
3. Check responsive behavior.
4. Define loading, empty, error, and success states.
5. Check accessibility.
6. Avoid introducing a new visual style without a clear reason.
7. Keep the implementation consistent with the Circle-first product philosophy.

Do not generate an entirely new UI pattern for every feature.

---

## 43. Design Acceptance Checklist

A UI feature is not considered complete until:

- [ ] It follows the CircleChat visual system.
- [ ] It works on mobile.
- [ ] It works on desktop where applicable.
- [ ] Typography and spacing are consistent.
- [ ] Interactive states exist.
- [ ] Loading state exists where needed.
- [ ] Empty state exists where needed.
- [ ] Error state exists where needed.
- [ ] Accessibility labels/focus behavior are present.
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
