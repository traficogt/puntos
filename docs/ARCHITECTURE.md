# Architecture

Orientation for engineers joining PuntosFieles. Every statement below was checked
against the tree at commit `f8ce5c0` (2026-11-23) and re-verified after the later waves of
the same day (`919d3dc` .. `5e2b33d`); file paths are repository-relative.
Where the code and older documents disagree, this file describes the code and names
the stale document. Recommendations are marked as such.

## 1. System shape

**Processes**

| Process | Entry | Role |
| --- | --- | --- |
| API | `src/app/server.js` (Express 5) | HTTP API under `/api` and `/api/v1`, static PWA, server-rendered marketing/help pages |
| Worker | `src/app/worker.js` | Runs the worker share of `src/app/scheduler.js`; exposes `/health` and `/metrics` on `WORKER_PORT` (3002) |
| PostgreSQL | central database VM | `docker-compose.yml` points both containers at `DB_HOST: ${APP_DB_HOST:-10.10.1.51}`; there is no `db` service in the production compose file any more (removed in `6198534`) |
| Redis | optional | Only used when `RATE_LIMIT_DRIVER=redis` (`src/middleware/rate-limit.js`) or `JOB_QUEUE_DRIVER=redis` (`src/app/services/job-service.js`). Not present in `docker-compose.yml`; the e2e stack (`docker-compose.e2e.standalone.yml`) starts `redis:7-alpine` |

The production database is PostgreSQL 17 on the central VM (`src/scripts/backup-db.sh`
dumps with a `postgres:17` client because `pg_dump` refuses servers newer than itself);
the test and e2e compose files run PostgreSQL `16.15-alpine`. Both processes build from
the same `Dockerfile` (`node:24.22.2-alpine`, non-root `nodejs`, `dumb-init`).

**Hosting.** The browser application is served at `app.puntosfieles.com` and the
marketing site at `puntosfieles.com` (both monitored in `deploy/status/.upptimerc.yml`).
One Express process serves both hosts: `src/utils/app-host-routing.js` treats `app.<host>`
as the application origin and redirects application paths requested on the apex
(`resolveHostSplitRedirect` in `server.js`). A TLS-terminating reverse proxy sits in front
(`deploy/caddy-edge/Caddyfile` is the example); `TRUST_PROXY` must be `>= 1` in production
(`src/config/index.js`).

**"Self-hosted".** `README.md` and `package.json` have described the project as
"self-hosted" since the initial import (`git log -S"Self-hosted" -- README.md`). What that
means in practice: the owner operates a single hosted deployment, and the stack is
self-hostable with Docker Compose. There is no multi-install distribution, and the compose
defaults now assume the owner's central DB VM.

**User-facing surfaces (two UI stacks plus two static sites):**

1. **Vanilla-JS PWA** in `public/`: customer wallet (`/mi-tarjeta/` → `customer.html`),
   staff scanner (`/equipo/escaner/` → `staff.html`), staff login (`/equipo/ingresar/`),
   internal business signup (`/crear-negocio/` → `admin.html`), self-serve 14-day trial
   signup (`/prueba/` → `prueba.html` + `trial-signup.js`, calling `/api/public/trial/*`),
   super console (`/plataforma/` → `super.html`, including the "Pruebas" section over
   `/api/super/businesses` trial columns and the "Suscripciones y cobro" section,
   `public/super/billing.js` + `billing-model.js`, over `/api/super/billing/*`), join/sign-in
   pages, marketing pages (`/precios`
   is rendered by `src/middleware/public-plans.js` from `precios.html` and re-rendered
   client-side from `GET /api/public/plans` by `precios.js`), calculator and status page. Spanish
   document routes live in `src/middleware/spanish-web.js`; English legacy paths (`/staff`,
   `/c`, `/super`, ...) are still served by `server.js`. The former vanilla owner dashboard
   (`/administracion/`, `/admin-dashboard`) was retired on 2026-11-25: both paths now 308 to
   `/negocio/`, and `src/utils/spanish-web-routes.js` maps the old `?seccion=`/`?configurar=`
   views to the merchant page that holds each capability (for example `?seccion=analisis` →
   `/negocio/#analitica`, `?configurar=punto-de-venta` → `/negocio/#conectar-caja`).
2. **React 19 + Mantine 9 merchant app** in `web/merchant/` (Vite, `base: "/negocio/"`,
   build output committed to `public/merchant`): the only owner dashboard. Owners land here
   after login; managers and cashiers land on the staff scanner. The shell reads
   `GET /api/admin/trial` (`trial-model.ts`) for the trial banner, the soft-lock screen and
   the upgrade request (`TrialBanner.tsx`, `OwnerTrialLocked.tsx`, `UpgradeRequest.tsx`); a
   404 means the trial feature is not deployed and nothing is shown. "Plan y facturación"
   (`#plan`, `OwnerPlan.tsx` over `billing-model.ts`) is the card-checkout surface described in
   §5 below. `src/middleware/merchant-web.js`
   injects a per-response nonce for Mantine's style tags. The service worker never caches
   `/merchant/`, `/negocio/` or `/demostracion/` documents.
3. **Expo native app** in `apps/customer/` (Expo ~57, version 0.1.0). Frozen per
   `AGENTS.md`: iOS 0.1.0 (3) in TestFlight, Android 0.1.0 (13) internal testing. It has
   no `expo-updates` dependency, so there is no over-the-air update channel.
4. **Help center**: `help/` (MkDocs) builds into `public/ayuda` (CI runs
   `python help/scripts/build.py --check`); `/guias` is server-rendered from
   `src/content/guides` by `src/middleware/guides.js`.
5. **Pertenece landing** (`deploy/pertenece/`): an independent Nginx container serving
   `public/credenciales` assets at `pertenecegt.com`; the only route forwarded to PF is
   `POST /api/public/contact`.

`web/astryx-prototype/` (→ `public/revision-astryx/9b72f5a1/`) is an unlisted design
preview, not a product surface.

Two web stacks is a known cost. `docs/FRONTEND_MIGRATION_PLAN.md` proposes an incremental
React + Vite migration; only `web/merchant` has followed it. The owner-facing UI converged on
the merchant app: `docs/product/2026-11-23-owner-ui-consolidation.md` records the gap table,
the analytics and operations ports (`75daa1e`, `20fc472`) and the retirement of the vanilla
dashboard (2026-11-25), which deleted `public/admin-dashboard/**`, `admin-dashboard.html/.js`
and their stylesheets. The customer wallet, staff scanner, staff login, signup page and super
console stay vanilla.

## 2. Request lifecycle and tenancy

Middleware order in `src/app/server.js`:

1. `app.set("query parser", "extended")`, ETag off, `Cache-Control: no-store` on `/api`.
2. `trust proxy` when `TRUST_PROXY` is set.
3. `pino-http` with `genReqId` (honours `X-Request-Id`, else UUID) and a follow-up
   middleware that sets `req.requestId` and `Permissions-Policy`.
4. `helmet` (CSP allowing `privatrack.com`, Cloudflare Insights and Turnstile; HSTS in
   production).
5. CORS on `/api` only (`isAllowedApiOrigin`, `src/utils/cors-origin.js`).
6. `cookieParser`.
7. `mountPgClient(app)` (`src/middleware/pg-client.js`): `withPgClient` is mounted on
   `PG_CLIENT_MOUNT_PATHS = ["/api"]` **only**. Static assets, HTML entry pages and
   marketing routes never take a pool connection (changed in `5c084b4`; enforced by
   `tests/unit/pg-client-mount-scope.test.js`).
8. `csrfInit` (`src/middleware/csrf.js`): double-submit with an httpOnly `pf_csrf` cookie
   and a readable `pf_csrf_readable` cookie; mutations must send `x-csrf-token` (header) or
   `csrf_token` (body); denials are logged as `csrf_denied` security events.
9. `metricsMiddleware`, then `globalApiRateLimit` on `/api` (probe paths exempt).
10. `express.json({ limit: "1mb" })` keeping `req.rawBody`, `defaultRequestBody`,
    `requestComplexityLimit`.
11. Marketing/help/static layers: search visibility, editorial and illustration review,
    guides, public plans, Spanish redirects, host-split redirect, `/runtime-config.js`,
    `/sitio`, `/sw.js` no-cache, `/app-preview`, Spanish web, self-service web,
    `express.static(public)`, friendly routes.
12. `apiRoutes` (`src/app/routes/index.js`): every router is mounted twice through
    `mountRoutes("/api/v1")` and `mountRoutes("/api")`; `apiRouteMounts` records the mounts
    so `src/scripts/generate-openapi.mjs` does not depend on Express internals.
13. `notFound`, `errorHandler` (`src/middleware/common.js`).

**Request-pinned connection.** `withPgClient` takes a client from `pool`, runs the rest of
the request inside `runWithDbContext({ client, tenantId: null, platformAdmin: false })`
and sets `req.pgClient`. On `finish` it resets the three GUCs and releases the client; if
the reset fails, or the response closed before it finished writing, the client is
destroyed (`client.release(true)`) rather than returned to the pool with tenant state.

**Ambient DB context.** `src/app/db/context.js` holds an `AsyncLocalStorage` store
`{ client, tenantId, platformAdmin, webhookIngest }`. `src/app/db/session.js` exposes:

- `dbQuery(sql, params)` → `getDbClient().query(...)`, where the client is the store's
  client or, outside any context, the shared `pool`.
- `setCurrentTenant`, `setPlatformAdmin`, `setWebhookIngest` → `set_config('app.current_tenant' | 'app.platform_admin' | 'app.webhook_ingest', $1, is_local)`
  on the context client (no-op on the store when there is no client).
- `withDbClientContext(ctx, fn)` for background and explicit contexts: reuses the parent
  client if present, otherwise takes one from `pool`, applies the GUCs, and on exit resets
  them; a failed reset destroys the connection (`5c084b4`).

Auth middleware sets the context: `requireStaff` / `requireCustomer` call
`setCurrentTenant(session.business_id)`; `requireSuperAdmin` calls `setPlatformAdmin(true)`
(`src/middleware/auth.js`). `tenantContext` (`src/middleware/tenant.js`) additionally
rejects requests without a business with `400 TENANT_REQUIRED` when
`ENFORCE_TENANT_CONTEXT` is on (default).

**Transactions.** `withTransaction(fn)` (`src/app/db/transactions.js`) uses the separate
`transactionPool` (`DB_TX_POOL_MAX`, default 10; the request pool is `DB_POOL_MAX`, default
20, `src/app/db/pools.js`). It `BEGIN`s, copies the ambient `platformAdmin`,
`webhookIngest` and `tenantId` into transaction-local GUCs (`set_config(..., true)`), runs
`fn(client)`, commits or rolls back, resets the session GUCs and destroys the client if the
connection errored. Nested use re-enters the context with the new client.

**Row-level security.** `src/app/migrations/2026-02-27-tenant-rls_canonical.sql` creates
schema `app`, enables and `FORCE`s RLS on tenant tables and defines policies over
`app.current_tenant`, `app.platform_admin` and `app.webhook_ingest`. The runtime role must
be `NOSUPERUSER` (`enforceNonSuperRuntime` in `src/app/db/migrations.js` refuses to start
otherwise, except in `NODE_ENV=test`). `docs/TENANT_RLS.md` is the policy reference (its
request-lifecycle section now matches: `withPgClient` runs for `/api` only).

**Two DB-access idioms.** Counted with `grep` on 2026-11-23:

| Idiom | `src/app/services` | `src/app/repositories` | `src/app/routes` |
| --- | --- | --- | --- |
| explicit `client.query(...)` | 864 | 28 | 0 |
| ambient `dbQuery(...)` | 65 | 62 | 76 |

The money paths (`cashback-service.js`, `gift-card-service.js`, `staff-award-service.js`,
`order-service.js`, `external-award-service.js`, ...) all follow the same shape:
`withTransaction(async (client) => { lock; look up existing request_id; write; })` with the
client passed explicitly. `dbQuery()` is used for single-statement reads and writes that
ride the request-pinned connection, and inside repositories.

*Recommendation:* new transactional code should take the explicit `client` from
`withTransaction` and pass it down (as the money services do); use `dbQuery()` only for
request-scoped single statements. Never call `pool.query` from routes or services.

## 3. Layering reality

Counts: 100 route files, 180 service files, 38 repository files. SQL lives in services
(864 explicit query calls plus 65 ambient) — `src/app/repositories/` holds 90 query calls
in total and is **not** a general data-access layer (`docs/ARQUITECTURA_8_5.md`, which listed
"repositorios de datos" as a layer, is now a pointer to this file).

What actually lives in `src/app/repositories/`:

- `base.js`: `one`, `many`, `exec` helpers over `dbQuery`.
- Analytics read models and calculations: `analytics-repository.js` with
  `analytics/{rfm,churn,cohorts,segments}-repository.js` (`calculateRFMScores`,
  `calculateChurnRisk`, `calculatePredictedLTV`, `createCohorts`), consumed by
  `src/app/routes/analytics/*` and the `analytics.calculate` job.
- Shared row access used by several services: `business-repository.js` (`BusinessRepo`:
  lookups, `updateProgram`, `listAllIds`, external-award key rotation),
  `webhook-repository.js` (`WebhookRepo.claimPending`, secret encryption/rotation),
  `job-repository.js`, `audit-repository.js`, `security-event-repository.js`,
  `staff-repository.js`, `customer-repository.js`, auth session and token repositories,
  native-wallet and mobile-push repositories, gift-card, tier, referral, reward, redemption,
  transaction, order and verify-code repositories.

48 services and 20 route files import a repository. Routes importing repositories directly
(for example `src/app/routes/analytics/_util.js`, `super-routes.js`) is legacy, not a
pattern to extend.

*Convention going forward (recommendation):* routes validate and call services; services
own SQL and transactions; a repository is justified only for row access shared by several
services (sessions, audit, security events, jobs, webhooks, business) or for analytics
read models. Do not "fix" a service by moving its SQL into a new repository, and do not add
repository imports to routes.

## 4. Validation and errors

**Schemas** are zod (`src/utils/schemas.js` and route-local schemas). Four idioms coexist
in `src/app/routes`:

| Idiom | Count | Failure response |
| --- | --- | --- |
| `schema.safeParse(req.body)` inline | 78 | handler-specific, usually `res.status(400).json({ error: "Payload inválido" })` without `code` |
| `validate(schema, body)` from `src/utils/validation.js` | 54 (24 files) | `res.status(400).json({ error: v.error })` where `error` is zod's `flattenError` object (`formErrors`/`fieldErrors`), no `code` |
| `validateQuery(schema)` / `validateParams(schema)` middleware (`src/utils/schemas.js`) | 22 / 22 | `validationErrorBody(error)` → `{ error, code: "VALIDATION_ERROR", details }` |
| `validateRequest(schema)` middleware | 8 | same shared body; `req.validated` carries the parsed value |

Counts are `grep` totals over `src/app/routes` on 2026-11-23 (after `99aa734`, which moved
validation to the route level and introduced the shared `validationErrorBody` and
`validateParams`). The two legacy idioms still answer without a `code`.

Only errors that reach `errorHandler` get the canonical envelope. A `ZodError` thrown from
a handler becomes `400 VALIDATION_ERROR` with `details: [{ field, message }]`; this is the
path to prefer for new code (parse with `schema.parse` inside `asyncRoute`, or throw
`badRequest(message, code)`).

**HttpError** (`src/utils/http-error.js`): `new HttpError(status, message, code)` plus
helpers `badRequest`, `unauthorized`, `forbidden`, `notFound`, `conflict`,
`tooManyRequests`. `code` must match `^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$` and must not look
like a Node system code (`E...`, `ERR_...`); otherwise it is derived by `inferErrorCode`
from message fragments and status (the legacy behaviour, kept so no existing path changed
code).

**errorHandler precedence** (`src/middleware/common.js`): an explicit well-formed
`err.code` wins; otherwise the legacy message/status inference; `ZodError` → 400
`VALIDATION_ERROR`; `entity.parse.failed` → `BAD_JSON`; 5xx in production is masked to
`"Error interno del servidor"` / `INTERNAL_ERROR`. SQLSTATE values and Node system codes
are never echoed. Response shape: `{ error, code, request_id, details?, recoveryCaseId? }`
with `X-Request-Id` set; 4xx are logged at info, 5xx at error. User-facing messages are
Spanish (124 messages were translated in `5c084b4`).

**Codes clients key on** (`public/lib.js` `ERROR_BY_CODE`, plus explicit checks in
`public/`): `AUTH_REQUIRED`, `FORBIDDEN`, `RBAC_ROLE_REQUIRED`, `RBAC_ROLE_INSUFFICIENT`,
`RBAC_PERMISSION_DENIED`, `PLAN_FEATURE_LOCKED`, `BUSINESS_CONTEXT_REQUIRED`, `NOT_FOUND`,
`BAD_JSON`, `VALIDATION_ERROR`, `INTERNAL_ERROR`, `RATE_LIMITED`, `CUSTOMER_NOT_FOUND`;
the string `MFA_REQUIRED` arrives as the `error` text (thrown by
`account-security-service.js`), not as a code. `AUTH_INVALID_TOKEN` is in the client map
but no server path emits it (invalid tokens infer to `AUTH_REQUIRED`).

Other codes the server emits explicitly: `TENANT_REQUIRED`, `RECENT_MFA_REQUIRED`,
`RECENT_REAUTH_REQUIRED`, `REAUTH_VERIFICATION_FAILED`, `PROGRAM_NOT_CONFIGURED`,
`DUPLICATE_PHONE`, `INVALID_PHONE`, `INVALID_NAME`, `INVALID_POINTS`, `INVALID_REGION`,
`CURRENCY_MISMATCH`, `SYNC_FAILED`, `RETRY_QUEUE_FULL`, `TRANSACTION_HISTORY_UNAVAILABLE`,
`OPERATIONS_UNAVAILABLE`, `ACTIVATION_INSIGHTS_UNAVAILABLE`, `APPLE_WALLET_*`; inferred
ones include `CONFLICT`, `BAD_REQUEST`, `UNEXPECTED_ERROR`.

**Known wart:** staff login failures are `401` with `code: "VALIDATION_ERROR"`
(`src/app/services/staff-service.js` lines 117 and 135, kept for backward compatibility
with the staff login page). Super-admin login failures (`src/app/routes/super-routes.js`)
answer inline, so they bypass the error handler; they now send `code: "AUTH_REQUIRED"`
explicitly, the value `inferErrorCode("Credenciales inválidas", 401)` derives
(`tests/unit/super-login-code.test.js` pins the equality).

## 5. Money and ledgers

**Arithmetic.** `src/utils/money.js` keeps every amount as an integer in minor units
(centavos) and does the intermediate work in `BigInt`: `toMinor(value, { scale, rounding })`
parses NUMERIC strings exactly (no float round trip), `fromMinor` formats fixed-decimal SQL
parameters, `toNumber` produces JSON output, and `add`/`sub`/`sum`/`mul`/`pct`/`compare`
assert `Number.isSafeInteger` on every result. Default rounding is `half-up` (half away
from zero), matching Postgres `round(numeric, n)` and `NUMERIC(p, s)` assignment; `scale`
defaults to 2 (the `NUMERIC(10,2)`/`NUMERIC(12,2)` Q ledgers). Cashback, discount and
gift-card code use it (`cashback-model.js`, `discount-model.js`, `cashback-service.js`,
`gift-card-service.js`); SQL text was unchanged by the switch. Two concrete bugs it fixed:
15% of Q33.30 paid 4.99 instead of 5.00 and 15% of Q4.10 paid 0.61 instead of 0.62
(`tests/unit/cashback-model.test.js`, `tests/unit/cashback-service.test.js`).

**Points ledger.** `transactions` is the single-entry ledger (`status` PENDING/POSTED,
`points`, `request_id`, `original_transaction_id`); `customer_balances` is the snapshot
(`points`, `pending_points`, `lifetime_points`), `src/app/schema.sql` lines 93–100.
Cashback and gift cards keep their own money ledger: `cashback_accounts` +
`cashback_transactions` (`NUMERIC(12,2)`, `2026-11-20-cashback-ledger.sql`; the
non-negative balance CHECK was dropped by `2026-11-22-cashback-allow-negative.sql` so a
refund can claw back already-spent credit), and `gift_card_transactions`.

**Idempotency** is enforced in the schema with partial unique indexes on
`(business_id, request_id)`:

- `idx_txn_business_request_id ON transactions(business_id, request_id) WHERE request_id IS NOT NULL` — `schema.sql:163`, `2026-03-08-transaction-request-id.sql`
- `idx_redemptions_business_request_id` — `schema.sql:189`, `2026-03-08-redemption-idempotency.sql`
- `idx_gift_card_tx_business_request_id` — `schema.sql:371`, `2026-03-08-gift-card-idempotency.sql`
- `uq_cashback_tx_request ON cashback_transactions(business_id, request_id)` — `2026-11-20-cashback-ledger.sql`
- `idx_txn_unique_reversal_per_original` (one reversal per original) and
  `idx_txn_external_event_id` — `schema.sql`
- newer tables declare `UNIQUE (business_id, request_id)` inline (growth campaigns,
  customer recovery/migration, service recovery, demand funding, ...).

Services serialize replays before touching the ledger with
`SELECT pg_advisory_xact_lock(hashtext($businessId), hashtext($requestId))` inside the
transaction (`staff-award-service.js:35`, `gift-card-service.js:94`, `order-service.js:120`,
`external-award-service.js:106`, and about 25 more call sites), then look up the existing
row for that `request_id` and return it instead of writing twice.

**Reconciliation and certification.** `src/app/services/ledger-reconciliation-service.js`
recomputes each customer's expected balances from `transactions` (POSTED sum → points,
PENDING sum → pending, positive POSTED sum → lifetime), compares them with
`customer_balances`, and persists runs and findings in `ledger_reconciliation_runs` /
`ledger_reconciliation_findings` (`2026-03-08-ledger-reconciliation.sql`); `repair: true`
(`LEDGER_RECONCILE_REPAIR`) rewrites the snapshot, and `limit` (`LEDGER_RECONCILE_LIMIT`,
default 10 000, clamped to 1–50 000) bounds a run. `ledger-certification-service.js` writes
a per-business JSON + CSV certification for a 30-day window under
`LEDGER_CERTIFICATION_OUTPUT_ROOT` (default `./artifacts/ledger-certifications`), pruned
after `LEDGER_CERTIFICATION_RETENTION_DAYS` (90). Both run as the worker-only daily step
`ledger.reconcile-and-certify`; CLI equivalents are `ops:ledger:reconcile`,
`ops:ledger:certify`, `ops:ledger:certify:prune`. Manual corrections go through
`ledger-correction-service.js` (audit-logged, `2026-03-08-ledger-corrections.sql`).

### 5.x Subscription billing surfaces (self-serve trial, wave 2)

Design of record: `docs/product/2026-11-25-self-serve-trial.md` §4.4–4.6, §5, §6. The web
surfaces code to this contract and must keep working when an endpoint answers 404 (not
deployed) or `503 BILLING_UNAVAILABLE` (provider unconfigured):

- Owner: `GET /api/admin/billing` → `{ billing: { status: none|trial|active|past_due|canceled|manual,
  provider, currency, plan, quantity, unit_amount_minor, monthly_total_minor, current_period_*,
  cancel_at, past_due_since, next_payment_attempt_at, latest_tax_invoice_url,
  upgrade_available, checkout_pending }, catalog: { currency, plans[] }, branches, trial }`;
  `POST /api/admin/billing/checkout { plan, currency? }` → 201 `{ checkout: { id, url,
  expires_at } }` (409 `BILLING_QUANTITY_LIMIT` above 9 branches, 409
  `BILLING_ALREADY_ACTIVE`, 400 `BILLING_PLAN_INVALID`); `GET /api/admin/billing/checkout/:id`
  → `{ status: pending|completed|expired|canceled, subscription }`, polled every 3 s for up to
  2 minutes after Recurrente returns the owner to `/negocio/#plan?checkout=<id>&resultado=…`
  (`web/merchant/src/navigation.js` ignores the hash query when resolving the page, and
  `main.jsx` captures it before normalising the hash); `POST /api/admin/billing/change { plan }`
  (upgrade = `now_and_charge`, downgrade = next cycle), `POST /api/admin/billing/cancel
  { at_period_end: true }`, `GET /api/admin/billing/invoices` (FEL links). Money travels in
  minor units; `billing-model.ts` formats "USD 79.00" / "Q600.00" with fixed grouping. The
  analytics export `GET /api/admin/billing/iva.csv` predates this API and is unrelated.
- Super: `GET /api/super/billing/subscriptions?status=`, `GET /api/super/billing/events?business_id=`,
  `GET/PUT /api/super/billing/catalog` (USD as published, `gtq` list amounts, dated
  `gtq_reference`, provider `price_ids` passed through on every PUT so a GTQ edit never drops
  them), `POST /api/super/billing/catalog/sync` (503 when unconfigured),
  `POST /api/super/businesses/:id/billing/cancel`.
- Fallbacks: the owner page shows "El pago con tarjeta estará disponible pronto" and keeps the
  wave-1 request form (`UpgradeRequest.tsx` → `POST /api/admin/concierge-request`); the trial
  banner and lock screen lead to `#plan` only when `trial.upgrade_available` is true. The super
  section replaces each block with a Spanish notice.

## 6. Background work

**Registry.** `src/app/scheduler.js` declares every periodic job once with the roles that
run it. The worker runs its share unconditionally; the API runs its share only when
`IN_PROCESS_WORKERS` is true (default `true` outside production, `false` in production).
A `BOTH` job therefore runs twice if an API instance has `IN_PROCESS_WORKERS=true` next to
a worker.

| Job | Schedule | Runs in |
| --- | --- | --- |
| `native-wallet.updates` | every 60 s | api + worker |
| `mobile-push.updates` | every 30 s | worker |
| `webhooks.deliver` | every 60 s | api + worker |
| `jobs.process` | every `JOB_WORKER_INTERVAL_MS` (15 000), batch `JOB_WORKER_BATCH_SIZE` (10) | api + worker |
| `marketing.tick` | every 60 s | api + worker |
| `guided-growth.tick` (`second-visit.prepare`, `owner-briefs.process`) | every 60 s | worker |
| `pos.sync` | every 300 s | api + worker |
| `daily.maintenance` | cron `0 ${CHURN_SEND_HOUR_LOCAL} * * *` in `CRON_TZ` | api + worker (steps filtered by role) |

Daily steps, in order: `support.purge-expired-attachments` (worker), `lifecycle.daily`
(both), `mfa.prune-counters` (worker), `ledger.reconcile-and-certify` (worker). Startup
tasks (`runStartupMaintenance`, run before any timer and regardless of
`IN_PROCESS_WORKERS`): `support.purge-expired-attachments` (worker) and
`secrets.rotate-to-current-key` (both). Failures are logged and never propagate
(`runGuarded`/`runSequence`). Note that the daily hour is `CHURN_SEND_HOUR_LOCAL` (default
9); `LEDGER_RECONCILE_HOUR_LOCAL` is declared in `src/config/index.js` and forwarded by
`docker-compose.yml` but nothing reads it.

**Job queue** (`src/app/services/job-service.js`). Jobs live in `background_jobs`; the
worker claims one at a time with `SELECT ... WHERE status='QUEUED' AND run_after <= now()
ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1` under a platform-admin context, then
marks it `RUNNING`. Handlers: `growth.campaign.prepare`, `customer.import`,
`analytics.calculate`, `lifecycle.run`. Lease recovery and heartbeats for
`RETRYABLE_JOB_TYPES` are in `job-recovery.js`. Redis is an optional accelerator: with
`JOB_QUEUE_DRIVER=redis` and `REDIS_URL` set (and `JOB_QUEUE_FORCE_DB` false) job ids are
also pushed to the list `pf:jobs:queue`; the client is created lazily, has an `error`
listener (a missing listener previously could crash the worker) and falls back to the DB
queue on connection failure. Enqueue with `enqueueJob({ businessId, jobType, payload, runAfter })`.

**Schema lock and migrations** (`src/app/db/migrations.js`). `initDatabase()` and
`runManagedMigrations()` run inside `withSchemaLock`, a session-level
`pg_advisory_lock(SCHEMA_LOCK_KEY)` (`0x50465343`, "PFSC") taken on a dedicated
`migrationPool` connection, so API, worker and the CLI (`src/scripts/migrations.mjs`,
`npm run ops:migrate`) cannot interleave `schema.sql` with each other's migrations.
`initDatabase` re-applies the idempotent `src/app/schema.sql` on every boot, applies
`schema-extensions.sql` if `loyalty_tiers` is missing and `AUTO_APPLY_SCHEMA_EXTENSIONS` is
on, and applies managed migrations only when `AUTO_APPLY_MIGRATIONS` is on (production
default: off — run `ops:migrate` explicitly).

Managed migrations are `src/app/migrations/*.sql` (87 files), tracked in
`schema_migrations(version, checksum, applied_at, execution_ms)` with a SHA-256 of the
file; each file runs in its own transaction; a checksum mismatch aborts startup. Order is
sorted filename plus the explicit prerequisites in `src/app/db/migration-order.js`
(depth-first), which repair same-day ordering without renaming files. Filename conventions
as they exist: two legacy `001_*.sql`/`002_*.sql`; dated `YYYY-MM-DD-topic.sql`; same-day
variants distinguished by suffixes (`_canonical`, `_lockdown`, `_rls`, `-fix`, `-hotfix`,
`index2`...) or ordering letters (`-a-`, `-b-`, `-z-`, `-zz-`). `checksums.json` in the
same directory pins every file (`npm run ops:migrate:lock` to add a new one,
`ops:migrate:lock-check` in CI). **Applied migrations are never renamed or edited**: the
version is the filename, so a rename re-applies the file and an edit fails the checksum.

## 7. Frontend conventions (vanilla PWA)

- **No `innerHTML`.** First-party `public/**/*.js` contains zero `innerHTML` uses; DOM is
  built with `createElement`/`textContent`. `npm run ops:security-scan`
  (`src/scripts/security-scan.mjs`) flags `innerHTML`, `outerHTML`, `insertAdjacentHTML`
  and `dangerouslySetInnerHTML`. The committed Vite bundles under `public/merchant` and
  `public/revision-astryx` are third-party output and are handled separately by the scan.
- **`lib.js` `api()`**: `fetch` with `credentials: "include"`, JSON content type, and
  `X-CSRF-Token` taken from the `pf_csrf_readable` cookie (falling back to
  `localStorage["pf_csrf_token"]`) on POST/PUT/PATCH/DELETE; it stores a refreshed token
  from the `x-csrf-token` response header, maps `code` through `ERROR_BY_CODE`, appends
  `(Ref: <request_id>)` and exposes `code`, `status`, `requestId` on the thrown error.
  Base URLs come from `/runtime-config.js` (`window.__PF_RUNTIME_CONFIG__`).
- **`session-epoch.js`** is the single implementation of the cross-tab logout epoch and
  pending-logout handshake for the `staff`, `super` and `customer` scopes (storage keys
  `pf_staff_epoch`, `pf_staff_logout_pending`, `pf_staff_snapshot`, `pf_super_epoch`,
  `pf_super_logout_pending`, `pf_customer_epoch`). Staff, super, staff-login and customer
  session code import it; the merchant app implements the same `staff` handshake over the
  same storage keys in `web/merchant/src/api.js`, so a logout in either stack blocks the other.
- **Composition roots**: `public/staff/index.js` (64 lines) and `public/super/index.js`
  (54 lines) wire focused modules around one shared context (`page-context.js`); cross-module
  reactions are injected as hooks to avoid import cycles. DOM ids, classes, storage keys
  and API paths did not change in the split (`f8ce5c0`).
- **Service worker** (`public/sw.js`): navigations, documents, scripts, styles, workers and
  fonts (and any `.js/.css/.html` path) are **network-first** with cached fallback and
  `NAVIGATION_FALLBACKS`; everything else is stale-while-revalidate; `private`/`no-store`
  responses are never cached. The block between `// BEGIN GENERATED` and
  `// END GENERATED` (`CACHE` and `CORE_ASSETS`) is produced by
  `src/scripts/build-sw-assets.mjs`: `CACHE` is `pf-` + 12 hex digits hashed over the asset
  list and file bytes, so it rotates exactly when a precached file changes. Run
  `npm run sw:build` after changing any page, module or stylesheet; `npm run sw:check` and
  `tests/unit/service-worker-assets.test.js` fail when the block is stale. Never hand-edit
  the generated block; runtime-only URLs go in `EXTRA_ASSETS`, and `CACHE_EPOCH` forces a
  rotation without an asset change. `npm run sw:build` first runs
  `src/scripts/build-asset-versions.mjs`, which rewrites the local asset references of the
  hand-written pages and stylesheets to `?v=<8 hex digits of the file's SHA-256>` (leaf
  first: fonts -> stylesheets -> pages; `public/merchant/` Vite output, `ayuda/`,
  `revision-astryx/` and `pwa-test/` excluded; `.js` sources never rewritten), and
  `express.static` serves `?v=` requests as `public, max-age=31536000, immutable`
  (`src/utils/static-cache-headers.js`) while documents and `sw.js` keep `max-age=0` /
  `no-store`.
- **Type checking of browser files**: `tsconfig.json` (`checkJs`) includes `src/**` and
  `tests/**` plus an explicit allowlist of `public/` files (`admin.js`, `customer/*`,
  `session-epoch.js`, `staff/*`, `super/*`, `types.ts`);
  `paths` maps `/lib.js` and `/idb.js` to `src/types/public-*.d.ts`. Add new browser modules
  to that list when they are typed.

## 8. Testing map

See [TESTING.md](../TESTING.md) for commands and knobs; this is the shape.

| Command | What runs | Needs |
| --- | --- | --- |
| `npm test` | `tests/unit/*.test.js` (293 files) + `test:integration` (`api-security`, `customer-flow` with a stubbed `pool.query`; the `RUN_INTEGRATION`-gated files `describe.skip`; PWA and cache-privacy browser shells) | Node, Playwright browsers for the browser shells |
| `npm run test:db` | `src/scripts/run-live-integration-isolated.sh`: ephemeral PostgreSQL 16 + Redis + API, restricted `loyalty_app` role with RLS, all 10 `RUN_INTEGRATION` suites, super smoke and ledger smokes | Docker |
| `npm run test:integration:domains` | `src/scripts/run-domain-integration-isolated.mjs`: private PostgreSQL container, one database per `*_TEST_DB_URL`-gated domain suite | Docker |
| `npm run test:e2e` | `src/scripts/run-e2e-isolated.sh`: `docker-compose.e2e.standalone.yml` + Playwright (`tests/e2e`, 16 specs) | Docker |
| `npm run test:all` | `npm test` then `npm run test:db` | Docker |

Helpers and guardrails worth knowing:

- `tests/helpers/browser-module-graph.js` — `loadBrowserModule(entryUrl, { stubs, instance })`
  loads a browser ES module graph from `data:` URLs, rewriting relative imports recursively
  and requiring every absolute specifier (`/lib.js`) to be stubbed; it replaced hand-rolled
  specifier rewriting in the staff/super/session tests.
- `tests/unit/module-size.test.js` — line-count ceilings for refactored hotspots (every new
  staff/super module has one). Raise a threshold deliberately, not reflexively.
- Source-text contract tests (26 `*contract*.test.js` plus files such as
  `pg-client-mount-scope`, `server-static-cors-scope`, `no-inline-style-attrs`,
  `no-fixed-secrets`) read source files and assert on patterns. After the Prettier adoption
  (`18b47ef`) their matchers were made whitespace-tolerant so a reformat cannot break them;
  write new ones the same way (`\s+`, not literal spacing).
- `tests/unit/service-worker-assets.test.js` fails when `public/sw.js` is stale;
  `tests/unit/migrations-schema-lock.test.js`, `scheduler-registry.test.js`,
  `error-middleware.test.js`, `money.test.js`, `config-production.test.js` cover the
  `5c084b4` changes.
- **Type checking**: `npm run typecheck` runs `tsc` over `tsconfig.json` (`checkJs`,
  `strict` off, but `strictFunctionTypes`, `strictBindCallApply`, `noImplicitThis`,
  `alwaysStrict`, `noFallthroughCasesInSwitch`, `useUnknownInCatchVariables`,
  `noImplicitReturns` and `noImplicitOverride` on, zero errors). `npm run typecheck:strict`
  runs `tsconfig.strict.json`, which extends the base with `strictNullChecks` and
  `strictPropertyInitialization` and excludes `tests/**`: the application layer
  (`src/app/services`, `routes`, `db`, `repositories`) is clean (`ce8dac0`), about 372
  errors remain in `src/utils`, `src/middleware`, `src/config`, `src/scripts` and the
  allowlisted browser files, so the strict configuration is not a CI gate yet. Catch blocks
  narrow through `src/utils/error-shape.js`. `web/merchant` has its own base and strict
  configurations, both run by its `typecheck` script in CI. See
  `docs/TYPESCRIPT_ADOPTION.md`.
- CI (`.github/workflows/ci.yml`): migration lock check, typecheck (root and
  `web/merchant`), lint, `format:check`, browser gates, `npm test`, OpenAPI freshness
  (`openapi:generate` + `git diff --exit-code`), migrate, `rls-check`, `security-scan`,
  `perf-sanity`, `npm audit`; separate jobs for domain integration, the live integration
  runner (`test:db`), help-center build check, container scan and the alerts drill.

## 9. Configuration

`src/config/index.js` is the only module that reads `process.env` for runtime settings.
Exceptions, by design: `src/utils/logger.js` (bootstrap: `LOG_LEVEL`, `NODE_ENV`), the
dependency-injection loaders `src/app/services/native-wallet/config.js` and
`src/app/services/mobile-push/config.js` (`env = process.env` parameter, testable), and
`src/content/guides/preview.mjs` (dev tool). CLI scripts under `src/scripts/` read their
own flags and env.

Conventions: `envValue(name)` prefers `${name}_FILE` (secret files mounted read-only from
`SECRETS_DIR`); `requireSecret` rejects placeholders and short values in production;
`LEDGER_CERTIFICATION_OUTPUT_ROOT` and `LEDGER_CERTIFICATION_RETENTION_DAYS` are live
accessors (read on each use). Production start fails fast unless: every `CORS_ORIGIN` and
`APP_ORIGIN` is https, `TRUST_PROXY >= 1`, `METRICS_TOKEN` is set,
`WEBHOOK_SECRET_ENC_KEY` has 32+ characters, `SUPER_ADMIN_EMAIL` comes with
`SUPER_ADMIN_PASSWORD_HASH`, both QR PEM keys are present, and
`CONTACT_TURNSTILE_SITE_KEY` is set whenever `CONTACT_TURNSTILE_SECRET` is set.

Keys added or centralized in `5c084b4` (all verified in `src/config/index.js`):

| Key | Default | Purpose |
| --- | --- | --- |
| `DB_POOL_MAX` | 20 | request-pinned pool ceiling per process; non-integer aborts startup |
| `DB_TX_POOL_MAX` | 10 | transaction pool ceiling per process |
| `CONTACT_TURNSTILE_SITE_KEY` | (empty) | public widget key served by `GET /api/public/support/config`; required in production when the secret is set — the hardcoded fallback is gone |
| `IN_PROCESS_WORKERS` | `true` outside production, `false` in production | API runs its scheduler share |
| `JOB_QUEUE_FORCE_DB` | `false` | keep the DB queue even with `JOB_QUEUE_DRIVER=redis` |
| `APP_SESSION_IDLE_MS` / `APP_SESSION_ABSOLUTE_MS` | 900 000 / 28 800 000 | staff and customer browser sessions |
| `SUPER_SESSION_IDLE_MS` / `SUPER_SESSION_ABSOLUTE_MS` | 600 000 / 14 400 000 | super console sessions |
| `RECENT_REAUTH_WINDOW_MS` | 600 000 | how long a fresh re-authentication satisfies sensitive routes |
| `RELEASE_SHA` / `BUILD_TIMESTAMP` | `GITHUB_SHA` / `GITHUB_RUN_STARTED_AT` fallbacks | release metadata on `/api/info` and build-info metrics |

Related existing keys: `JOB_WORKER_INTERVAL_MS` (15 000), `JOB_WORKER_BATCH_SIZE` (10),
`JOB_QUEUE_DRIVER` (`db`), `RATE_LIMIT_DRIVER` (`memory`), `REDIS_URL`, `CRON_TZ`,
`CHURN_SEND_HOUR_LOCAL`, `LEDGER_RECONCILE_LIMIT`, `LEDGER_RECONCILE_REPAIR`.

## 10. Owner progress ("Tu progreso")

Design of record: `docs/product/2026-11-23-owner-progress.md` (v2). Landed in `83ae51c`
(server) and `aeec174` (merchant UI).

- **Service** `src/app/services/owner-progress-service.js`: `loadOwnerProgressFacts` runs one
  parameterized facts query under the tenant context; `buildOwnerProgress` is a pure model
  over those facts: `LAUNCH_STEPS` (rules, card, practice, team, live), fourteen `MILESTONES`
  with strict counting (genuine awards exclude reversals, rehearsals and imported history; a
  returning customer needs genuine awards on two calendar days in the business timezone),
  `GOALS` (one suggested at a time, 30-day dismissal), `computeMomentum` (weekly counter, a
  freeze every 8 weeks) and the explicit review (`keep`/`adjust`, due after 30 days).
  `getOwnerProgress`, `acknowledgeOwnerProgressMilestones`, `setOwnerProgressGoal`,
  `recordOwnerProgressReview`, `setOwnerProgressVisibility` persist the owner's choices and
  audit them; `ownerProgressBriefLine` feeds the weekly owner brief for treatment businesses.
- **Test accounts** (`customers.is_test`, migration `2026-11-26-d-customer-test-accounts.sql`,
  additive with a partial index; design note of 2026-11-26 in the design doc). The owner marks
  an account from the customer profile (`PATCH /api/admin/customers/:id/test-account`, owner
  role, CSRF, body `{ is_test }`, `CustomerDirectoryRepo.setTestAccount`, audited as
  `customer.test_account.update`); the platform owner uses **Administrar cuentas de prueba** on the business card with a customer UUID through
  `PATCH /api/super/businesses/:businessId/customers/:customerId/test-account`
  (`super.customer.test_account.update`). The flag is read-only data for every counting
  surface and never changes points: excluded from the owner-progress facts and momentum
  (`realCustomer` in `owner-progress-service.js`, hence from the trial activation facts and
  the day-10 trial reminder), activation insights, `BusinessRepo.activeCustomerCount` (plan
  soft-cap usage), `businessSummary` and `TxnRepo.summaryByBusiness`
  (`/api/admin/analytics/summary`), `getMerchantOverview` (`/api/admin/analytics/overview`,
  Reportes), the advanced dashboard, the weekly owner brief purchase counts, the pilot
  evidence metrics, and the customer counts of the super business and trial listings
  (`test_customers` is reported apart). Kept: the directory (badge), CSV export (`is_test`
  column), ledger, audits, `churnCandidates`, and the customer's own card (`is_test` on
  `GET /api/customer/me`, label rendered by `public/customer/me.js`). Mantine:
  `OwnerCustomers.tsx` badge and toggle; demo fixture row 3 is a test account. Help article:
  `help/docs/negocio/cuentas-de-prueba.md`. Real-DB coverage:
  `tests/integration/customer-test-accounts.test.js`.
- **Routes** `src/app/routes/owner-progress-routes.js`: `GET /api/admin/owner-progress` and
  `POST /api/admin/owner-progress/{acknowledge,goal,review,visibility}` (`requireStaff`,
  `requireOwner`, `tenantContext`, CSRF on writes, `validateRequest` with strict zod bodies,
  no plan-feature gate, `Cache-Control: no-store`). When the platform mode is `off` every
  route answers `404 NOT_FOUND`. `src/app/routes/super-owner-progress-routes.js`:
  `GET/PUT /api/super/platform-settings/owner-progress` (`requireSuperAdmin`), logged as
  `super.owner_progress.update`.
- **Tables** (`src/app/migrations/2026-11-23-owner-progress.sql`, additive):
  `owner_progress_milestones (business_id, key, reached_at, acknowledged_at)`,
  `owner_progress_state (business_id, hidden, current_goal, dismissed_goals jsonb,
  last_review_at, last_review_decision, freezes_used, updated_at)`, both with RLS enabled and
  forced under the `tenant_isolation` policy, and `businesses.owner_progress_variant`
  (`treatment` | `holdout` | NULL).
- **Settings**: `platform_settings` key `owner_progress` = `{ mode: off | checklist | full,
  holdout_pct: 0..100 }` (`PlatformSettingsRepo.getOwnerProgress/setOwnerProgress`,
  defaults `full` / `0`, normalized by `resolveOwnerProgressSettings`). The variant is
  assigned deterministically on a business's first read
  (`assignOwnerProgressVariant`: `sha256(business_id)` first 32 bits mod 100 `< holdout_pct`
  → holdout) and never reassigned, so a holdout share changed later applies only to
  businesses not yet read. Activation insights and platform health expose
  `owner_progress_variant`.
- **UI**: `web/merchant/src/OwnerProgress.tsx` (`#tu-progreso`, "Tu progreso" in the daily
  menu) and `OwnerProgressCard` on the Overview; `demo-owner-progress.ts` drives
  `/demostracion/#tu-progreso`; the merchant goal list is pinned to the server's `GOAL_KEYS`
  by a root unit test. Help article: `help/docs/negocio/tu-progreso.md`. Real-DB coverage:
  `tests/integration/owner-progress.test.js` (`npm run test:db`).

## 11. Known debt and open decisions

- **Two web stacks** (vanilla PWA for customer, staff, signup and super screens; React/Mantine
  merchant app for owners) plus the Expo native app. The vanilla owner dashboard was retired
  on 2026-11-25 (section 1); `/administracion/` is a permanent redirect, kept so saved links,
  magic links with the stored `admin-dashboard` target and old bookmarks still work. Moving
  the remaining vanilla screens is not planned.
- **TypeScript strictness.** `strict` is off. `strictNullChecks` is clean for the application
  layer only (`npm run typecheck:strict`, about 372 errors left in the infrastructure and
  browser halves); `--noImplicitAny` adds about 13 000 errors and is not scheduled
  (section 8, `docs/TYPESCRIPT_ADOPTION.md`).
- **Native app gaps.** `apps/customer/src` has no `CASHBACK`, `GIFT_CARD`, `STAMP` or
  `DISCOUNT` program handling and no `expo-updates`, so parity requires a store release.
  Releases are owner-triggered only (`AGENTS.md`).
- **Two CSS palettes.** `DESIGN.md` tokens (`#f7f5ef` paper, `#302820` espresso,
  `#a43d28` terracotta, `#f0dda5` gold) are what `public/styles/marketing.css` and the
  `customer-modern.css`/`operations-modern.css` overrides use; `public/styles/base.css`
  still defines the older application palette (`--bg #f4ede4`, `--text #241712`,
  `--accent #b8572f`, `--accent-3 #d7a554`) with its own dark theme.
- **`src/app/repositories/` naming.** The folder name promises a data layer it is not
  (section 3). Renaming is cheap in code but churns imports across 68 files; decide before
  adding more repositories.
- **Validation response shapes.** Four idioms (section 4). The inline `safeParse` responses
  and every `validate()` failure response still carry no `code`; the shared middleware
  (`validateQuery`, `validateParams`, `validateRequest`) does.
- **Login error codes.** Staff login returns `401 VALIDATION_ERROR` (section 4); super
  login now carries `AUTH_REQUIRED`. Changing the staff value would break the installed
  staff login page's handling, so it stays.
- **`LEDGER_RECONCILE_HOUR_LOCAL`** is configured and passed to the worker but unused; the
  daily job runs at `CHURN_SEND_HOUR_LOCAL`.
- **Application page views.** Application screens send a fixed page category directly to Privatrack using `public/area-pageview.js`. The request omits credentials, the referrer, parameters, fragments and account data. It runs on the production app origin, honors browser privacy signals, and skips the public demo. Public marketing pages use Privatrack's script for their named events.

- **Hard limits to know.** Campaign audience snapshots are capped at 200 customers
  (`growth-campaign-service.js:203`, `LIMIT 200 FOR SHARE` at line 279); customer imports
  commit in chunks of 100 rows per job tick (`customer-import-job-service.js:233`).
- **Test accounts are a manual marker.** `customers.is_test` (section 10) excludes an
  account from customer participation metrics, but nothing sets it automatically: a demo phone
  that is never marked still counts, and marking an account after it reached a milestone
  does not revoke the stored first-reached timestamp. A plain branded-QR download is
  likewise not persisted, so it cannot satisfy the card step on its own.
- **Holdout applies only to businesses not yet read.** The owner-progress variant is
  persisted on first read and never reassigned (section 10); raising `holdout_pct` later
  does not move existing treatment businesses into the holdout.
- **Help source lock.** `help/reviewed-sources.json` is behind the code: 41 locked sources
  changed since the 2026-11-18 review (mostly Prettier/typing reformatting and `?v=` asset
  versioning, but also `Overview.jsx`, the navigation modules and `OwnerSettings.tsx`), and
  `python3 help/scripts/check.py` also reports eight new owner routes without a guide
  (`reportes`, `niveles`, `limites`, `logros-y-retos`, `tarjetas-de-regalo`, `identidad`,
  `puesta-en-marcha`, `tu-progreso`). `review-sources.py --record-reviewed` is an
  attestation that the guides were re-read, so it was not run; the help author has to add
  the guides and re-baseline.
