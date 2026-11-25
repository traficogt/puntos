# Changelog

## Unreleased

Commits on `main` after 1.3.7, from `18b47ef` (Prettier adoption) to `5e2b33d` (smoke
fix), including the quality waves of 2026-11-23 (`919d3dc`, `0b2a428`, `cfc1932`, `ce8dac0`,
`83ae51c`, `aeec174`). The package version is unchanged. Operator-facing summary; see
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design.

### Required before deploying
- **Set `CONTACT_TURNSTILE_SITE_KEY` in the production environment** whenever
  `CONTACT_TURNSTILE_SECRET` is set. The hardcoded site-key fallback was removed; the API
  now refuses to start in production with the secret set and the site key empty
  (`src/config/index.js`). The key is served by `GET /api/public/support/config` to the
  support form widget.
- **Apply the managed migration `2026-11-23-owner-progress.sql`** with `npm run ops:migrate`
  (production does not auto-apply migrations). It is additive: tables
  `owner_progress_milestones` and `owner_progress_state` (RLS enabled and forced, tenant
  policy, grants for the runtime role) and the nullable column
  `businesses.owner_progress_variant`. The "Tu progreso" API and card need it; installed
  native apps never touch these tables.

- **Apply the managed migration `2026-11-24-import-batch-200.sql`** with `npm run ops:migrate`:
  it widens the three batch-count CHECKs on `customer_migration_batches` to 200 rows. Import
  batches of 101–200 rows fail with a database error until it runs.

### Published prices and a 14-day free trial on the website (2026-11-25)
- `/precios` publishes the three plans with their prices: Conecta USD 39, Impulsa USD 79 and
  Expande USD 129 per branch per month, with each plan's caps and included features. The page
  reads `GET /api/public/plans` and re-renders from the server catalog when it answers with
  published pricing; otherwise the same numbers stay as static copy. "Los precios están en
  revisión" is gone. Prices are shown in USD before taxes; the GTQ amount and the IVA treatment
  are confirmed in writing when a plan is chosen, and nothing is charged from the page.
- New public signup at `/prueba/` ("Prueba gratis 14 días", also the landing hero's primary
  call to action next to "Ver la demo"): business data, phone verification by SMS code with a
  Turnstile challenge, then business creation and the usual hand-off to `/negocio/`. It calls
  `GET /api/public/trial/config`, `POST /api/public/trial/request-code`, `POST
  /api/public/trial/verify` and `POST /api/public/trial/signup`, and explains in Spanish when
  the server does not serve them yet. `/crear-negocio/` stays the internal page. The server
  must map `/prueba/` to `prueba.html` in `src/middleware/spanish-web.js` and `browserRoutes`.
- Owner app: a "Prueba gratis · te quedan N días" banner fed by `GET /api/admin/trial` (or the
  additive `trial`/`billing` fields of `/api/admin/plan`), yellow in the last four days, with
  "Mejorar plan". When the trial is locked (`billing.status = locked`, or a mutation answers
  `402 TRIAL_LOCKED`/`TRIAL_EXPIRED`), the home shows "Tu prueba terminó" (what still works,
  what customers see, the deletion date) and other pages keep reading behind a compact notice.
  No payment provider is wired in this wave: "Mejorar plan" sends an upgrade request through
  the owner-authenticated `POST /api/admin/concierge-request` and says card payment is coming.
  Without the trial endpoint (404) nothing is shown. Demo: `/demostracion/?prueba=activa`,
  `?prueba=ultimos-dias`, `?prueba=bloqueada`.
- Super console: a "Pruebas" section lists trials (status, days left, verified phone, source,
  dates) with filters and the actions `…/trial/extend { days }`, `…/trial/lock` and
  `…/billing/manual-activate { plan, note }`, each behind a confirmation; a notice replaces the
  list while the server does not expose the trial columns.
- Help center: owner guide "Empezar la prueba gratis de 14 días y elegir plan"; the landing FAQ
  answers "¿Puedo probarlo gratis antes de contratar?".

### Owner dashboard: the vanilla `/administracion/` is retired (2026-11-25)
- The owner dashboard is the merchant app at `/negocio/`. `/administracion/`, `/administracion`,
  `/admin-dashboard` and `/admin-dashboard.html` now redirect permanently (308) there; saved
  links keep working because the old `?seccion=` / `?configurar=` views open the matching
  merchant page (`recompensas`, `identidad`, `niveles`, `sucursales`, `personal`,
  `tarjetas-de-regalo`, `logros-y-retos`, `referidos`, `puesta-en-marcha`, `reportes`,
  `analitica`, `limites`, `conectar-caja`, `preparar`). The branch filter is dropped.
- Merchant views that replace the vanilla tabs: Preparar mi programa, Recompensas y catálogo,
  Reglas de puntos, Límites y políticas, Notificaciones automáticas (with Plantillas and the
  daily suspicious-purchase digest), Niveles de cliente, Logros y retos, Tarjetas de regalo,
  Clientes, Recuperar clientes, Recomendaciones, Movimientos, Campañas y ofertas, Audiencias,
  Origen de clientes, Personal, Permisos del equipo, Sucursales, Marca y QR, Identidad del
  programa, Conectar caja (now including Loyverse credentials, CSV preview/import, Loyverse
  preview/sync and the API key), Configuración, Región, Reportes, Analítica avanzada, Canjes
  por recompensa, Alertas y pagos pendientes, Trabajos en segundo plano, Conciliación del
  libro de puntos, Auditoría, Puesta en marcha y guías.
- Managers and cashiers open the staff scanner after login (the vanilla manager mode only
  exposed gift cards, which the scanner handles). Super-console impersonation and magic links
  with the `admin-dashboard` target open `/negocio/`.
- Removed: `public/admin-dashboard/**`, `admin-dashboard.html`, `admin-dashboard.js`,
  `styles/admin-dashboard-premium.css`, `styles/pos-integration.css`,
  `styles/customer-enrollment.css`, their type-check entries, tests and visual snapshots, and
  `PUT /api/admin/automations/template` (no client used it; templates are applied through the
  Automations editor's validated save). `GET /api/admin/billing/iva.csv` now writes `fecha` as
  `YYYY-MM-DD`.

### Owner progress ("Tu progreso")
- New owner-only feature on every plan (`83ae51c` server, `aeec174` UI; design of record
  `docs/product/2026-11-23-owner-progress.md`). `GET /api/admin/owner-progress` returns a
  five-step launch path (rules, card, practice, team, live), fourteen factual milestones
  with strict counting (genuine awards exclude reversals, rehearsals and imported history; a
  returning customer needs genuine awards on two calendar days in the business timezone), one
  suggested goal at a time with 30-day dismissal, a weekly momentum counter with freezes and
  the last review. `POST /api/admin/owner-progress/{acknowledge,goal,review,visibility}`
  record the owner's choices (CSRF, strict zod bodies).
- Platform setting `owner_progress` `{ mode: off | checklist | full, holdout_pct }` (default
  `full`, `0`) read and written through `GET/PUT /api/super/platform-settings/owner-progress`
  and a card in the super console. `mode: off` makes the owner API answer `404 NOT_FOUND`.
  Each business gets a deterministic `treatment`/`holdout` variant on its first read
  (`sha256(business_id) mod 100 < holdout_pct`), persisted in `owner_progress_variant`; a
  holdout percentage changed later applies only to businesses not yet read. The weekly owner
  brief gains one line for treatment businesses and activation insights expose the variant.
- Merchant app: `OwnerProgress` view at `#tu-progreso` ("Tu progreso" in the daily menu) and
  an Overview card: launch path, milestone history with dates, one suggested goal with
  "Cambiar meta" and dismiss, the keep/adjust review, a quiet momentum line, hide/show and a
  dismissible notice for newly reached milestones. Factual Spanish copy only; no score beyond
  "N de 5 pasos"; checklist mode and holdout show the launch path only. Demo fixtures drive
  `/demostracion/#tu-progreso` offline. Help article `help/docs/negocio/tu-progreso.md`.
- Known limits (flagged in code and help): no marker exists for test or pilot-seed customer
  accounts; a plain branded-QR download is not persisted and cannot satisfy the card step on
  its own.

### Scale limits, holdout rule and merchant app (24–25 November)

- Campaign audience limits are plan-aware (`src/app/services/scale-limits.js`): Conecta 300,
  Impulsa 2,000, Expande up to the 5,000 technical ceiling. Saved-audience sends above 200
  members run through the preparation job (202 Accepted, 250-member chunks, frozen snapshot,
  persisted cursor). Over-limit requests answer 400 `PLAN_AUDIENCE_LIMIT` in Spanish.
- Customer imports accept 200 rows per synchronous request (was 100) and job files up to
  5,000 rows in resumable 200-row chunks. Channel policy, consent and collision checks are
  unchanged.
- "Tu progreso" holdout assignment: a variant is persisted only while
  `owner_progress_holdout_pct` is above zero and only for businesses not yet exposed to the
  full experience; with the share at zero nothing is stored. A holdout set later still yields
  a usable comparison.
- The public merchant demo (`/demostracion/`) no longer crashes on plain-HTTP hosts other than
  localhost: `crypto.randomUUID` is secure-context-only and now has a fallback.
- Overview: the "Ver análisis detallado" accordion no longer resets the first-purchase-returns
  cohort selection on every period or branch change.
- `GET /api/admin/tiers` returns each tier's full rule beside its statistics so the Mantine
  editor prefills; super login 401 responses carry `code: "AUTH_REQUIRED"`.
- Types: `tsconfig.strict.json` now enforces `strictNullChecks` and `noImplicitAny` for
  `src/` and the type-checked `public/` modules, and `npm run typecheck` runs it. Shared
  shapes live in `src/types/` (db, auth, express augmentation, pg/cors/cookie-parser/
  qrcode/swagger-ui-express shims); `@types/luxon` is installed and the twelve null gaps it
  exposed are closed.
- Merchant browser gate specs are current (7/7); `test:integration:live` lists the same ten
  suites as the live runner.

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
- Super login failures (`POST /api/super/login`, `401 "Credenciales inválidas"`) now carry
  `code: "AUTH_REQUIRED"`, the value the error middleware's inference derives for that message
  and status; the message and status are unchanged. Staff login keeps its historical
  `401 VALIDATION_ERROR`.
- `GET /api/admin/tiers` returns each tier's full rule (`min_points`, `min_spend`,
  `min_visits`, `points_multiplier`, `perks`, `color`, `icon_url`, `active`, timestamps)
  alongside the existing statistics (`customer_count`, `avg_points`, `total_points`). Nothing
  was removed; the owner editors (merchant `OwnerTiers`, vanilla "Niveles") now prefill from
  the list instead of showing `undefined`.
- Formerly unreachable crash paths return clean errors under `strictNullChecks`
  (`ce8dac0`): missing reward in the reward workspace (404), missing Apple Wallet
  configuration in native-wallet routes (404), null points in customer migration rows (400),
  missing catalog items (empty list), incomplete campaign measurement
  (`incomplete_data` state).

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
  `noImplicitThis`, `alwaysStrict` and `noFallthroughCasesInSwitch` (zero errors), and since
  `919d3dc` also `useUnknownInCatchVariables`, `noImplicitReturns` and `noImplicitOverride`:
  130 catch sites narrow the caught value through `src/utils/error-shape.js`
  (`errorMessage`/`errorCode`/`errorStatus`/`asError`) or `instanceof` checks; no `any` casts
  and no `ts-ignore`.
- New `tsconfig.strict.json` (base configuration plus `strictNullChecks` and
  `strictPropertyInitialization`, tests excluded) and `npm run typecheck:strict`. The
  application layer (`src/app/services`, `routes`, `db`, `repositories`) is clean after 364
  fixes, three quarters of them once at the callee by typing JSDoc parameters whose defaults
  were `null` or `[]`; four casts, each commented with the zod rule that guarantees the value.
  About 372 errors remain in the infrastructure and browser halves, so `npm run typecheck`
  stays non-strict for now (`docs/TYPESCRIPT_ADOPTION.md`).
- `npm run test:integration:live` lists the same eleven `RUN_INTEGRATION` suites that
  `src/scripts/run-live-integration-isolated.sh` runs (it listed two).
- `src/scripts/deploy-smoke.mjs` accepts the content-hashed `?v=` suffix on the
  `@import url("/styles/components.css")` line of `/styles.css` (`5e2b33d`); the literal
  match failed after asset versioning.
- Merchant browser gate (`tests/integration/merchant-browser-gate.test.js`): the navigation
  runner follows the current menu (flat curated demo, grouped owner menu with the
  "Ver todas las herramientas" reveal, plan-locked pages hidden) and exercises the grouped
  menu through a signed-in session fed by the demo fixtures; the first-purchase runner opens
  the collapsed "Ver análisis detallado" item.
- Stale documents corrected: `docs/TENANT_RLS.md` (request-scoped client is `/api`-only),
  `QUICKSTART.md` (no database service in Compose; the database is the central VM),
  `docs/TYPESCRIPT_ADOPTION.md` (tsconfig, strict configuration, commands) and
  `docs/ARQUITECTURA_8_5.md` (now a pointer to `docs/ARCHITECTURE.md`).
- Root `COMPETITIVE_ANALYSIS.md` replaced with a pointer to the maintained product
  assessment under `docs/`.

### Browser application
- Merchant app (React 19 + Mantine 9, `web/merchant`): the owner modules that existed only in
  the vanilla dashboard are ported as strict-TSX views on the owner-workspace pattern, each
  gated by its plan feature and with demo fixtures so `/demostracion/` works offline
  (`cfc1932`; gap analysis in `docs/product/2026-11-23-owner-ui-consolidation.md`):
  `OwnerBranding` (`#identidad`), `OwnerTiers` (`#niveles`), `OwnerProgramLimits`
  (`#limites`: award, suspicious, hold, redemption, balance and tier policies),
  `OwnerGamification` (`#logros-y-retos`), `OwnerGiftCards` (`#tarjetas-de-regalo`),
  `OwnerOnboarding` (`#puesta-en-marcha`: activation checklist and printable SOPs) and
  `OwnerReports` (`#reportes`: basic KPIs and plan capacity). Navigation entries added;
  nothing removed from the vanilla dashboard. Still vanilla-only: the deep analytics suite
  (RFM, ROI, cohorts, IVA CSV, reconciliation, certification, audit) and automation templates.
- Merchant Overview: the four deep-diagnostic panels behind "Ver análisis detallado" stay
  mounted while the period or branch reloads, so the first-purchase cohort selection is no
  longer reset by an unrelated reload (regression from `443dd09`, caught by the browser gate).
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
