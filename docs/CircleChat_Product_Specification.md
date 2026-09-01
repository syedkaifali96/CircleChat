# CircleChat — Product Specification

## Product
CircleChat is a private messenger designed for small circles of 2–5 close friends or family members.

## Core Principle
**Make the Circle—not the chat—the hero.**

Messaging provides the utility; the Circle experience provides the identity.

## Conversation Types

### Private 1-to-1 Chat
Two members can have a private conversation with text, media, voice messages, reactions, replies, editing/deletion and read/typing states.

### Circle Group Chat
A private group space for 2–5 members with messaging plus Circle-specific features such as polls, pinboard, memories and customization.

## Account
- Username + password
- No mandatory phone number
- No mandatory email
- Profile: username, display name, avatar, status/about
- Recovery code for password recovery

## Privacy & Security
- Secure password hashing
- HTTPS/TLS in transit
- Secure sessions and device management
- Local app lock with PIN/biometrics where supported
- Server-side authorization for every private resource
- Minimum necessary data collection
- No unrealistic claims such as “100% unhackable”
- E2EE is a future architectural consideration and must use established cryptographic protocols rather than custom cryptography

## Circles
- Create/join Circle
- Maximum 5 members
- Invite links/codes
- Circle name/avatar/theme
- Member roles
- Circle Home
- Circle Pinboard
- Polls
- Future: memories, events, mood, status and countdowns

## MVP
- Authentication
- Profiles
- Create/join/invite Circle
- 5-member limit
- Private 1-to-1 chat
- Circle group chat
- Text/images/video/voice
- Reactions/replies/edit/delete
- Circle Home
- Pinboard
- Polls
- Circle customization
- App lock
- Session/device management
- Basic notification controls

## V2
- GIFs
- Stickers
- Shared memories
- Mood check-ins
- Circle status
- Events/countdowns
- Disappearing moments
- Advanced themes
- Message search
- Better media management

## Experimental
- Circle personality
- AI conversation prompts
- Memory resurfacing
- Mini-games
- Inside-joke cards
- Message effects

## Design
**Modern + Dark Purple + Premium + Clean + Slightly Playful**

Palette:
- Primary: `#7C3AED`
- Background: `#0B0714`
- Surface: `#171225`
- Accent: `#A78BFA`
- Text: `#F5F3FF`

Font: Inter

## Brand
**CircleChat**

Recommended tagline: **Your little private world.**

## Product Vision
CircleChat should feel like a tiny private digital world for a user's people—not like a smaller copy of WhatsApp.