# Changelog

## Unreleased

Four commits on `main` after 1.3.7 (`18b47ef`, `5c084b4`, `ae647e7`, `f8ce5c0`). The
package version is unchanged. Operator-facing summary; see
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design.

### Required before deploying
- **Set `CONTACT_TURNSTILE_SITE_KEY` in the production environment** whenever
  `CONTACT_TURNSTILE_SECRET` is set. The hardcoded site-key fallback was removed; the API
  now refuses to start in production with the secret set and the site key empty
  (`src/config/index.js`). The key is served by `GET /api/public/support/config` to the
  support form widget.

### Database and runtime
- Schema initialization and managed migrations run under a session-level advisory lock
  (`SCHEMA_LOCK_KEY`), so API, worker and `npm run ops:migrate` starting together no longer
  interleave `schema.sql` with each other's migrations.
- Request-pinned PostgreSQL connections are taken for `/api` requests only. Static assets,
  HTML entry pages and marketing routes no longer consume a pool connection.
- New pool-size settings `DB_POOL_MAX` (default 20) and `DB_TX_POOL_MAX` (default 10),
  forwarded by `docker-compose.yml` to `api` and `worker`; a non-integer value stops startup.
- A connection whose tenant/admin session settings cannot be reset is destroyed instead of
  returned to the pool.
- All periodic jobs are declared once in `src/app/scheduler.js` and shared by the API and
  worker; intervals, the daily cron expression and handlers are unchanged.
  `IN_PROCESS_WORKERS` (default off in production) still decides whether the API runs its
  share.
- Redis clients for the job queue and rate limiter are created lazily, carry an `error`
  listener (an unhandled Redis socket error could previously crash the worker) and are
  closed on shutdown. New `JOB_QUEUE_FORCE_DB` keeps the DB queue even when
  `JOB_QUEUE_DRIVER=redis`.
- Session windows are configurable: `APP_SESSION_IDLE_MS`, `APP_SESSION_ABSOLUTE_MS`,
  `SUPER_SESSION_IDLE_MS`, `SUPER_SESSION_ABSOLUTE_MS`, `RECENT_REAUTH_WINDOW_MS`
  (defaults unchanged). `RELEASE_SHA` / `BUILD_TIMESTAMP` feed `/api/info`.

### Money
- New `src/utils/money.js`: exact integer-centavo arithmetic with Postgres-compatible
  half-up rounding; cashback, discount and gift-card ledgers use it. SQL text is unchanged.
- Fix: a 15% cashback on Q33.30 credited 4.99 instead of 5.00.
- Fix: a 15% cashback on Q4.10 credited 0.61 instead of 0.62.

### API errors
- Errors carry an explicit, stable `code`; existing paths keep their historical codes. A
  zod `ZodError` reaching the error handler is a `400 VALIDATION_ERROR` with field
  `details`. PostgreSQL SQLSTATE values and Node system codes are no longer echoed to
  clients.
- 124 user-facing error messages moved from English to Spanish. Clients that matched
  English text should key on `code` (the browser `lib.js` already does).
- Previously swallowed failures when writing security events and audit rows are now logged.

### Tests and tooling
- `npm run test:db` runs every `RUN_INTEGRATION`-gated suite (10 files, previously 2)
  against an ephemeral PostgreSQL 16 + Redis + API stack under the restricted runtime role
  with RLS enforced; `npm run test:all` = `npm test` + `npm run test:db`. The default
  `npm test` is unchanged and needs no Docker. The runner passes `--env-file /dev/null` so
  the repository `.env` is never used for Compose interpolation.
- Prettier 3.10 adopted (`npm run format`, `npm run format:check`, CI gate). About 870
  files reformatted, including ~56 backend services that were minified one-liners. No
  behavior change intended.
- Type checking now enables `strictFunctionTypes`, `strictBindCallApply`,
  `noImplicitThis`, `alwaysStrict` and `noFallthroughCasesInSwitch` (zero errors).
- Root `COMPETITIVE_ANALYSIS.md` replaced with a pointer to the maintained product
  assessment under `docs/`.

### Browser application
- Static asset versions are content-derived. `npm run sw:build` first rewrites every local
  `<script>`, `<link>`, `<img>`/`srcset` and CSS `url()`/`@import` reference in the
  hand-written pages and stylesheets to `?v=<first 8 hex digits of the file's SHA-256>`
  (198 references across 19 pages and 2 stylesheets, replacing the hand-bumped `?v=1`..`?v=6`
  and `?v=activation1`), and `express.static` answers `?v=` requests with
  `Cache-Control: public, max-age=31536000, immutable`. Documents, `sw.js`, `/api` and
  unversioned requests keep their headers; `.js` sources are not rewritten. `npm run sw:check`
  and `test:unit` fail when a page is stale. Installed native apps are unaffected.
- `public/sw.js` precache list and cache name are generated: `npm run sw:build` rewrites
  the block from the entry pages and their import graph, and `CACHE` is a content hash
  (replaces the hand-maintained 143-entry list and `pf-v56`). `npm run sw:check` and a
  unit test fail when the file is stale. The old list had missed
  `admin-dashboard-premium.css` and the branding fragment.
- `public/session-epoch.js` is the single implementation of the cross-tab logout epoch for
  staff, super and customer surfaces; storage keys unchanged.
- Staff scanner and super console scripts split into focused modules behind thin
  composition roots; DOM ids, classes, storage keys and API paths unchanged.

## 1.3.7
- File-based secret handling is now the documented default
- CI gates include typecheck, lint, tests, OpenAPI freshness, RLS checks, security scan, perf sanity, dependency audit, and smoke E2E
- Admin audit tooling supports impersonation provenance, filters, and CSV export
- Payment webhooks, gift cards, analytics, plans, and RBAC remain active product areas

## 1.0.x to 1.3.x
- Core platform shipped with customer join flows, staff scanning, rewards, analytics, messaging adapters, webhooks, and tenant isolation
- Security hardening added CSRF, stricter proxy handling, webhook SSRF defenses, secret encryption, and stronger password rules
- Test coverage expanded across unit, integration, and Playwright E2E paths
