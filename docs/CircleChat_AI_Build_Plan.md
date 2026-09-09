# CircleChat — AI-Assisted Development Plan

> Status snapshot: **M0–M13 are implemented. M14 testing/hardening is active;
> M15 security hardening and M16 production deployment remain planned.**

## Purpose
Use AI as a virtual development team while keeping human control over product, architecture, security and production decisions.

## Source-of-Truth Documents
AI agents must read these before making changes:

```text
README.md
docs/CircleChat_Product_Specification.md
docs/CircleChat_AI_Build_Plan.md
docs/ARCHITECTURE.md
docs/DATABASE.md
docs/SECURITY.md
docs/API.md
docs/DEPLOYMENT.md
design.md
AGENTS.md
CHANGELOG.md (when present)
```

`docs/ARCHITECTURE.md` contains the **final approved technical stack** for MVP. Agents must not substitute the stack,
frameworks, database, ORM, authentication model, realtime transport or storage architecture without explicit owner approval.
Product behavior remains defined by the Product Specification; architecture does not override product direction.

## AI Roles
- **Product AI:** PRD, feature prioritization, user stories, acceptance criteria
- **UX/UI AI:** flows, wireframes, design system, responsive states
- **Coding AI:** frontend/backend implementation in small reviewable units
- **Reasoning AI:** architecture, database, realtime edge cases, difficult debugging
- **Vision AI:** screenshot and UI review
- **Testing AI:** unit, integration and E2E test generation
- **Security AI:** threat modeling and security review
- **Documentation AI:** README, architecture and changelog maintenance

## Core Rule
Do not ask one AI agent to build the entire messenger in one giant task.

Build controlled milestones:

```text
M0 Foundation / Scaffold
M1 Database
M2 Authentication
M3 Profiles
M4 Circles
M5 Direct + Circle Messaging
M6 Realtime
M7 Media
M7.1 Thumbnails + GIF search
M8 Notifications
M9 Circle Home
M10 Pinboard
M11 Polls
M12 Themes / Personalization
M13 App Lock
M14 Testing
M15 Security Hardening
M16 Deployment / Android build
```

| Delivery range | Current state |
|---|---|
| M0–M13 | Complete and covered by CI |
| M14 Testing / hardening | In progress — automated coverage is strong; the full device/E2E matrix remains |
| M15 Security hardening | Planned; pre-launch review checklist remains open |
| M16 Deployment / Android release | Planned; local Android export works, production release is not claimed |

For each milestone:

**Plan → Implement → Test → Review → Security Check → Document → Commit**

One milestone/change set at a time. Stop after the requested milestone and report what changed.

## Final Approved Technical Stack

The implementation stack is fixed by `docs/ARCHITECTURE.md`:

- **Mobile:** React Native + Expo + TypeScript, Android first; iOS later.
- **Navigation:** Expo Router.
- **Backend:** Node.js 22 LTS + Fastify + TypeScript.
- **Realtime:** Socket.IO.
- **Database:** PostgreSQL 16 + Drizzle ORM.
- **Authentication:** custom username/password + Argon2id + opaque revocable session tokens.
- **Media:** private Cloudflare R2 + presigned URLs.
- **Push:** Expo Push.
- **App Lock:** Expo SecureStore + platform biometrics.
- **Server tests:** Vitest + real PostgreSQL integration tests.
- **App tests:** Jest + React Native Testing Library.
- **Deployment:** Railway + Neon + R2 + EAS Build.

Do not replace this stack with a web/PWA frontend, Flutter, Supabase/Firebase whole-backend auth, another ORM,
custom WebSockets, JWT-only auth, public object storage, or custom cryptography unless the owner explicitly approves the change.

## AI Coding Rules
Give coding AI:
- Goal
- Context
- Constraints
- Relevant files
- Expected behavior
- Acceptance criteria
- Testing requirements

AI should inspect the existing architecture before modifying files and should avoid unrelated changes.

AI must not start a later milestone just because it notices work that will be needed later.

## Critical Security Rule
Never blindly accept AI-generated implementations for:

- Cryptography
- Authentication
- Authorization
- Database security rules
- Storage permissions
- Password/recovery flows
- Session revocation
- Data deletion
- Production secrets

Use established libraries and security primitives. Never invent custom cryptography.

## Authorization Principle
Every private resource must be protected server-side:

```text
Authenticated?
      ↓
Authorized for resource?
      ↓
Allowed action?
      ↓
Execute
```

For Circle resources, authorization uses `circle_members`.
For direct conversations, authorization uses `conversation_participants`; never parse `direct_key` as an authorization source.
UI hiding alone is not security.

## Testing
AI should generate tests for:

- Username/password validation
- Session creation/revocation
- Change-password revoking other sessions
- Circle membership and 5-member concurrency limit
- Ownership transfer atomicity
- Invite expiry/revocation/capacity
- Direct conversation participant authorization
- Message idempotency using `clientMessageId`
- Message permissions
- Poll voting
- Signup/login/logout/recovery
- Create/join Circle
- Private messaging
- Group messaging
- Media upload and access controls
- Reactions/edit/delete
- Notification preference enforcement
- App lock behavior
- Socket reconnect/disconnect after revocation
- Network disconnect/reconnect
- Newest-message opening and top-edge history pagination
- Read-pointer accuracy after realtime messages
- Media retry without duplicate optimistic bubbles
- External GIF rendering and authorized attachment opening

## Bug-Fixing Workflow
When reporting a bug provide:
1. Expected behavior
2. Actual behavior
3. Error message
4. Relevant file/code
5. Reproduction steps
6. Environment
7. Recent changes

Ask AI to identify root cause, propose the minimal fix, implement it, add a regression test, and check side effects.

## Documentation Rules
Documentation-only changes must not silently introduce new product features or alter the approved stack.
When a design/architecture decision changes, update all affected cross-references in the same change set.

If `CHANGELOG.md` exists, record user-visible/product-significant changes and major architecture/security decisions briefly.
Do not add secrets, tokens, recovery codes or message content to the changelog.

The project currently uses no generative-AI runtime integration. The name of
this document describes AI-assisted development only; experimental product AI
features require a separately approved scope, privacy review and documented
provider/configuration decision.

## AI Prompt Template

```text
FEATURE:
[Feature name]

GOAL:
[What should happen]

CONTEXT:
CircleChat is a private 2–5 member messenger with Circle group chats and separate private 1-to-1 chats.

SOURCE OF TRUTH:
Read README.md, AGENTS.md, the Product Specification, ARCHITECTURE.md, DATABASE.md, SECURITY.md, API.md,
design.md, and relevant implementation files before changing anything.

CONSTRAINTS:
- Follow docs/ARCHITECTURE.md exactly.
- Do not substitute the approved stack.
- Do not modify unrelated features.
- Enforce permissions server-side.
- Keep the UI responsive and accessible.
- Do not implement E2EE unless a separately approved future milestone exists.

REQUIREMENTS:
[Detailed requirements]

ACCEPTANCE CRITERIA:
[Observable success conditions]

TESTING:
Add appropriate unit/integration/E2E tests for the milestone.

STOP CONDITION:
Implement only this milestone/change set. Report changed files, tests, security considerations, and commit SHA.
```

## Model Strategy
Use the strongest available coding/reasoning model for architecture, security and difficult bugs. Use faster/cheaper models for documentation,
simple components and routine refactors. Model availability and pricing change, so provider choice should remain flexible.

No single AI model is the final authority for security-sensitive production behavior; human review remains required.

## Final Development Philosophy
**Human decides what CircleChat should be. AI helps design and implement it. AI tests and reviews it. Humans verify critical security and production behavior.**
