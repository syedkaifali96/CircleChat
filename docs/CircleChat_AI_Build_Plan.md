# CircleChat — AI-Assisted Development Plan

## Purpose
Use AI as a virtual development team while keeping human control over architecture, security and production decisions.

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
01 Authentication
02 Profiles
03 Circles
04 Private Chat
05 Group Chat
06 Realtime
07 Media
08 Notifications
09 Circle Home
10 Pinboard
11 Polls
12 Themes
13 App Lock
14 Testing
15 Security
16 Deployment
```

For each milestone:

**Plan → Implement → Test → Review → Security Check → Document → Commit**

## Recommended Technical Direction

### Frontend
React + TypeScript is a strong option for a web/PWA MVP.

For mobile, React Native + Expo or Flutter can be evaluated.

### Backend
Managed platforms such as Supabase or Firebase can reduce MVP complexity.

### Database
A relational database is a strong fit. Core entities:

```text
users
circles
circle_members
messages
message_reactions
media
sessions
notifications
polls
poll_votes
circle_settings
```

### Realtime
Use managed realtime infrastructure initially rather than building custom WebSockets from scratch.

### Storage
Keep media in object/file storage; store message/media metadata in the database.

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

## Critical Security Rule
Never blindly accept AI-generated implementations for:
- Cryptography
- Authentication
- Authorization
- Database security rules
- Storage permissions
- Password/recovery flows
- Data deletion
- Production secrets

Use established libraries and security primitives. Never invent custom cryptography.

## Authorization Principle
Every private resource must be protected server-side:

```text
Authenticated?
      ↓
Circle member?
      ↓
Allowed action?
      ↓
Execute
```

UI hiding alone is not security.

## Testing
AI should generate tests for:
- Username/password validation
- Circle membership and 5-member limit
- Message permissions
- Poll voting
- Signup/login/logout
- Create/join Circle
- Private messaging
- Group messaging
- Media upload
- Reactions/edit/delete
- App lock behavior
- Network disconnect/reconnect

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

## Project Context
Keep these documents available to coding agents:

```text
README.md
PRODUCT_SPEC.md
ARCHITECTURE.md
DATABASE.md
SECURITY.md
API.md
DEPLOYMENT.md
CHANGELOG.md
AGENTS.md
```

`AGENTS.md` should contain repository-specific instructions, tech stack, conventions, testing commands, security rules and boundaries on what agents may modify.

## AI Prompt Template

```text
FEATURE:
[Feature name]

GOAL:
[What should happen]

CONTEXT:
CircleChat is a private 2–5 member messenger.

CONSTRAINTS:
- Follow the existing architecture.
- Do not modify unrelated features.
- Enforce permissions server-side.
- Keep the UI responsive and accessible.

REQUIREMENTS:
[Detailed requirements]

ACCEPTANCE CRITERIA:
[Observable success conditions]

TESTING:
Add appropriate unit/integration/E2E tests.
```

## Model Strategy
Use the strongest available coding/reasoning model for architecture, security and difficult bugs. Use faster/cheaper models for documentation, simple components and routine refactors. Model availability and pricing change, so provider choice should remain flexible.

## Final Development Philosophy
**Human decides what CircleChat should be. AI helps design and implement it. AI tests and reviews it. Humans verify critical security and production behavior.**
