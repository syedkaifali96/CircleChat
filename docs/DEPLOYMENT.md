# CircleChat — Deployment Plan

> Status: **Proposed — awaiting approval.** Environments, hosting, CI/CD, monitoring and cost
> expectations. Provider choices can be swapped without architecture changes (all are commodity
> Postgres/S3-compatible/Node hosts).

---

## 1. Environments

| Environment | Purpose | Data |
|---|---|---|
| **local** | developer machine | throwaway Postgres (Neon branch or local install), MinIO optional — R2 emulation not required if uploads are tested against a dev bucket |
| **staging** | auto-deploys from `main` | isolated Postgres branch + dev R2 bucket; test accounts only |
| **production** | tagged releases | real data, backups on |

## 2. Hosting

| Component | Provider (recommended) | Notes |
|---|---|---|
| API + Socket.IO server | **Railway** | single Node service; always-on needed for WebSockets (Render's free tier sleeps and is not suitable) |
| PostgreSQL | **Neon** free tier | serverless Postgres, branching per PR, PITR backups |
| Media storage | **Cloudflare R2** | private bucket, presigned URLs, zero egress fees |
| Mobile builds | **Expo EAS Build** | Android APK/AAB without local Android Studio; OTA JS updates via EAS Update |
| DNS/domain | any registrar + Cloudflare | API + app links under one zone |

Alternatives documented, not chosen: Render (sleeps — breaks sockets), Fly.io (fine, more CLI-centric),
Supabase Postgres (fine as a drop-in Postgres), S3 (egress costs).

## 3. Configuration & Secrets

- All config via environment variables (parsed/validated by Zod at boot — missing/invalid config fails startup):

```text
DATABASE_URL=            # Neon connection string (TLS)
SESSION_TTL_DAYS=30
R2_ACCOUNT_ID= / R2_ACCESS_KEY_ID= / R2_SECRET_ACCESS_KEY= / R2_BUCKET=
R2_PRESIGN_TTL_SECONDS=60
EXPO_ACCESS_TOKEN=       # server → Expo Push
SENTRY_DSN=              # optional crash reporting
NODE_ENV=production
```

- Secrets live in Railway/R2/EAS secret stores only. `.env` is git-ignored; `.env.example` lists names with empty values. Never log secrets; never put them in the Expo client bundle — the mobile app only knows the API base URL.
- Client-side config: `API_BASE_URL` per build channel (staging build points at staging).

## 4. CI/CD (GitHub Actions)

```text
pull request →  install → typecheck → lint → unit tests → integration tests (PostgreSQL service container in GitHub Actions)
             → Drizzle migration dry-run check
merge to main → same checks → deploy server to staging → run migrations → smoke test (/health, socket ping)
tag v*       → deploy to production → migrations → smoke test → Sentry release marker
mobile       → EAS Build on demand / on tag: Android staging APK; manual EAS Submit for store later
```

- Migrations run **before** the new server version accepts traffic (additive-first strategy: expand → migrate data → contract, so rollbacks stay possible).
- Rollback = redeploy previous image; DB migrations are written to be backward-compatible for one release.

## 5. Monitoring & Operations

- **Health endpoint** `/health` (DB ping) for Railway checks.
- **Crash + error reporting**: Sentry (server + Expo app), PII scrubbing on.
- **Logs**: Railway structured logs (pino JSON), 7–30 day retention; no message content (SECURITY.md §11).
- **Basic alerts**: error-rate spike, deploy failure, DB storage > 80% of tier.
- Weekly operator checklist (manual, in this repo): backup restore spot-check, dependency audit summary, storage/bandwidth review vs. R2 free tier.

## 6. Backups & Recovery

- Neon PITR enabled; weekly manual logical backup downloaded off-platform during MVP.
- Restore drill once before production launch (documented command sequence in this repo when implemented).
- R2: versioning off (cost), but orphan cleanup job doubles as a restore-time integrity check.

## 7. Cost Expectations (development → early production)

| Item | Dev | Early production |
|---|---|---|
| Neon Postgres | free tier | free → ~$19/mo if scaling needed |
| Railway server | trial, then ~$5/mo | ~$5–10/mo |
| Cloudflare R2 | free (10 GB) | free tier likely sufficient for a long time (2–5 member circles) |
| Expo EAS | free tier | free → paid queue priority only if needed |
| Domain | ~$10/yr | ~$10/yr |
| **Total** | **~$0** | **~$5–15/mo** |

Media is the cost driver to watch (spec risk #4) — upload caps and the cleanup job exist for this reason.

## 8. Production Launch Checklist (summary)

Secrets rotated & in platform stores ✔ migrations applied from clean state ✔
restore drill done ✔ rate limits active ✔ Sentry receiving ✔ backups on ✔
`.env` not in repo ✔ dependency audit clean ✔ security checklist (SECURITY.md §14) signed off ✔
