# CircleChat — Deployment Plan

> Status: **Local development and pull-request CI are implemented. Production
> hosting, release automation, monitoring and backup verification remain the
> approved M16 plan—not a claim that CircleChat is already deployed.**

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
- Client-side config: `EXPO_PUBLIC_API_URL` per build channel and
  `EXPO_PUBLIC_GIPHY_API_KEY` for attributed client-side GIF search. Expo public
  values are bundle-visible configuration, never secrets.
- No OpenAI or other generative-AI API key is required by the current app.

### 3.1 Local development & real-device (USB) workflow

- **Database:** local PostgreSQL 16 with a `circlechat_dev` database is the expected local setup; apply migrations with `npm run db:migrate` (`DATABASE_URL` must be set — `drizzle-kit` reads it from the environment).
- **Server `.env` minimum:** `DATABASE_URL` at minimum to start; **R2 credentials (`R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET`) are required for media features** — placeholder values let the server start, but uploads/downloads fail without a real bucket.
- **Local media storage without R2:** `npm run minio` starts a local MinIO (idempotent; binary and data live in `~/minio`, root credentials come from the `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` values already in `.env`) — set `R2_ENDPOINT=http://127.0.0.1:9000` in `.env` and the storage gateway (standard AWS SDK `S3Client`) uses MinIO with path-style signing, so media features work fully against the local `circlechat-dev` bucket. `npm run minio:stop` stops the script-started instance. Unset `R2_ENDPOINT` targets real Cloudflare R2.
- **USB debugging:** with an Android device connected over USB, `npm run device` reverses the three dev ports (`tcp:8081` Metro, `tcp:3000` API, `tcp:9000` MinIO) from the phone to this machine — the phone reaches everything via `localhost` over USB, no WiFi/IP configuration needed (the app's default `EXPO_PUBLIC_API_URL` fallback of `http://localhost:3000` matches this). Idempotent; safe to re-run whenever the phone reconnects.
- **Expo Go (SDK 53) is sufficient for this app** — no custom dev client is required, **except Android push notifications**, which need a development build to test (Expo Go removed remote push; an Expo Go limitation, not an app bug — see M8 notes in the changelog).

## 4. CI/CD (GitHub Actions)

Current pull-request CI:

```text
pull request → install → lint → typecheck → shared/mobile/server tests
             → real PostgreSQL integration tests → Android Expo export
```

Planned M16 release automation (not implemented/deployed yet):

```text
merge to main → same checks → deploy server to staging → run migrations → smoke test (/health, socket ping)
tag v*       → deploy to production → migrations → smoke test → Sentry release marker
mobile       → EAS Build on demand / on tag: Android staging APK; manual EAS Submit for store later
```

### 4.1 M16 status: what is wired vs. what needs the owner

The repository now ships every file the release automation needs; the
remaining steps require owner-held accounts and secrets, so they are listed
as explicit owner actions rather than being faked:

Wired in-repo (M16):
- `apps/mobile/app.json` — `android.package` (`com.circlechat.app`),
  `POST_NOTIFICATIONS` + `RECORD_AUDIO` permissions, `expo-notifications`
  plugin, and the `extra.eas.projectId` slot.
- `apps/mobile/eas.json` — `development` (dev client), `preview`
  (internal APK) and `production` (AAB) profiles with per-profile
  `EXPO_PUBLIC_API_URL`; `appVersionSource: remote`.
- `.env.example` — full production variable set (Neon `DATABASE_URL`, R2
  credentials, `EXPO_ACCESS_TOKEN`, optional `SENTRY_DSN`) with the
  owner-action sequence documented inline.
- `.gitignore` — `google-services.json` and `*.keystore` are ignored.

Owner actions (cannot be done by an agent — real accounts/secrets):
1. Create the Expo account → `npx eas init` in `apps/mobile` → paste the
   printed project ID into `app.json` `extra.eas.projectId` and the two
   `REPLACE_WITH_*_API_URL` slots in `eas.json`.
2. Neon → create the production project → put the pooled connection string
   into Railway as `DATABASE_URL`.
3. Railway → create the service from this repo → set `NODE_ENV=production`
   plus the R2/Expo secrets → first deploy runs `npm ci`, `npm run build`,
   `npm run db:migrate` then `npm start` (health check `/health`).
4. Cloudflare R2 → create the private bucket + API token → fill the four
   `R2_*` secrets in Railway.
5. Android push (FCM): Firebase console → create the project for package
   `com.circlechat.app` → download `google-services.json` → place it in
   `apps/mobile/` (gitignored) → upload the same file (or the service-account
   key) in Expo → `npx eas credentials`. `EXPO_ACCESS_TOKEN` goes into
   Railway's secrets.
6. Build: `npx eas build -p android --profile preview` (internal APK for
   device E2E), then `--profile production` (AAB) for the store.
7. Real-device E2E pass (signup → circles → direct + circle messaging →
   realtime → media over real R2 → real FCM push → App Lock → theming).

- Migrations run **before** the new server version accepts traffic (additive-first strategy: expand → migrate data → contract, so rollbacks stay possible).
- Rollback = redeploy previous image; DB migrations are written to be backward-compatible for one release.

## 5. Monitoring & Operations

- **Health endpoint** `/health` (DB ping) for Railway checks.
- **Crash + error reporting**: Sentry (server + Expo app), PII scrubbing on.
- **Logs**: Railway structured logs (pino JSON), 7–30 day retention; no message content (SECURITY.md §11).
- **Basic alerts**: error-rate spike, deploy failure, DB storage > 80% of tier.
- Weekly operator checklist (manual, in this repo): backup restore spot-check, dependency audit summary, storage/bandwidth review vs. R2 free tier.

**Known limitation (M14.3):** video thumbnails are not generated —
frame extraction needs ffmpeg-scale native tooling that is not part of the
MVP deployment. Video messages render a themed placeholder (play icon +
filename) in the app and open the original file on tap. If ffmpeg becomes
available on the host, `getVideoThumbnail` (apps/mobile/src/chat/videoThumbnail.tsx)
is the single seam to resolve a frame derivative; no other change is needed.

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

## 8. Production Launch Checklist

Items are marked: ✅ verified in-repo · ⏳ **Owner Action Required**
(the step needs a real account/secret/store submission and cannot be
completed from the repository).

- [ ] ⏳ Production secrets rotated and stored in provider secret stores — Railway/Neon/R2/EAS stores; owner fills `.env.example`-listed names
- [ ] ⏳ Migrations applied from a clean staging database — `npm run db:migrate` is the documented command; run it on the Neon staging branch first
- [ ] ⏳ Restore drill completed and recorded — Neon PITR restore drill before launch
- [ ] ⏳ Rate limits and WebSocket behavior verified on the chosen host — smoke test after the first Railway deploy (rate-limit suite runs in CI; host-level verification needs the live URL)
- [ ] ⏳ Sentry receiving scrubbed events and alerts configured — optional; owner creates the Sentry project and sets `SENTRY_DSN`
- [ ] ⏳ Database backups/PITR enabled — Neon dashboard toggle, owner action
- [x] ✅ `.env` and real credentials absent from the repository — verified: no `.env`/`google-services.json`/`*.keystore` tracked; `.gitignore` covers all three
- [x] ✅ Dependency audit reviewed — M15 audit (29 findings; 2 high CVEs fixed; remaining Expo/RN toolchain majors deferred with reason in `SECURITY.md` §14)
- [x] ✅ `SECURITY.md` launch checklist signed off — M15 (2026-09-23): 15/16 items ticked with evidence, dependency-audit item carries the explicit deferral note
