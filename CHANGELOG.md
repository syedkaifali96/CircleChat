# CircleChat — Changelog

## Unreleased

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
