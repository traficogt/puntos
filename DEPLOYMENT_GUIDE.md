# Deployment Guide

This guide describes the current production model.

## Requirements
- Node.js 24.22.3 for local server tooling (`.nvmrc`); supported server range is `>=24.22.2 <25`. The reviewed Docker image pins 24.22.2 separately.
- PostgreSQL 16 or 17. Production uses PostgreSQL 17 on the central database VM (`docker-compose.yml` passes `DB_HOST: ${APP_DB_HOST:-10.10.1.51}` to `api` and `worker`; the compose file has no `db` service). The test and e2e stacks run PostgreSQL 16.
- Redis 7 only if you enable `RATE_LIMIT_DRIVER=redis` or `JOB_QUEUE_DRIVER=redis`; the defaults (`memory`, `db`) need no Redis
- A TLS-terminating reverse proxy such as Caddy or Nginx
- An external secrets directory that is not inside the repo checkout

## 1. Secrets

Create a host directory such as:

```text
/var/lib/puntos/secrets
```

Populate it with:
- `db_password`
- `db_migrations_password`
- `jwt_secret`
- `qr_private_key.pem`
- `qr_public_key.pem`
- `metrics_token`
- `super_admin_password_hash`
- `webhook_secret_enc_key`

Set strict permissions on that directory and those files.

## 2. Environment

Set at minimum:

```env
NODE_ENV=production
PORT=3001
SECRETS_DIR=/var/lib/puntos/secrets

DB_HOST=localhost
DB_PORT=5432
DB_NAME=puntos
DB_USER=puntos_app
DB_MIGRATIONS_USER=puntos_app
DB_PASSWORD_FILE=/app/.secrets/db_password
DB_MIGRATIONS_PASSWORD_FILE=/app/.secrets/db_migrations_password

JWT_SECRET_FILE=/app/.secrets/jwt_secret
QR_PRIVATE_KEY_PEM_FILE=/app/.secrets/qr_private_key.pem
QR_PUBLIC_KEY_PEM_FILE=/app/.secrets/qr_public_key.pem
METRICS_TOKEN_FILE=/app/.secrets/metrics_token
SUPER_ADMIN_PASSWORD_HASH_FILE=/app/.secrets/super_admin_password_hash
WEBHOOK_SECRET_ENC_KEY_FILE=/app/.secrets/webhook_secret_enc_key

APP_ORIGIN=https://your-domain.example
CORS_ORIGIN=https://your-domain.example
TRUST_PROXY=1
AUTO_APPLY_MIGRATIONS=false
```

With Docker Compose, point the containers at the database host with `APP_DB_HOST`
(default `10.10.1.51`); `DB_HOST` above is read by host-side tooling such as
`npm run ops:migrate`.

Use `TRUST_PROXY=1` only when all inbound traffic comes through a trusted reverse proxy hop.

### Contact form email

`CONTACT_SMTP_HOST`, `CONTACT_SMTP_PORT` (default 26), `CONTACT_TO` and `CONTACT_FROM` must be set
explicitly in production. With `CONTACT_SMTP_HOST` or `CONTACT_TO` unset, the demo-request and
concierge mailers only log, so no non-production process can email the real inbox.

### Contact form challenge (Turnstile)

```env
CONTACT_TURNSTILE_SECRET=<server secret>
CONTACT_TURNSTILE_SITE_KEY=<public widget key>
```

**Required together.** In production the API refuses to start when
`CONTACT_TURNSTILE_SECRET` is set and `CONTACT_TURNSTILE_SITE_KEY` is empty
(`src/config/index.js`); there is no site-key fallback in code any more. Leave both empty
to run the support form without a challenge. The site key is public and is served to the
form by `GET /api/public/support/config`.

### Optional runtime settings (defaults shown)

```env
# PostgreSQL connection ceilings per process (API and worker each open both pools)
DB_POOL_MAX=20
DB_TX_POOL_MAX=10

# Background jobs: the worker always runs its share; the API runs its share only when true.
# Default is false in production, true elsewhere. See src/app/scheduler.js for the registry.
IN_PROCESS_WORKERS=false
JOB_QUEUE_DRIVER=db          # db | redis (redis also needs REDIS_URL)
JOB_QUEUE_FORCE_DB=false     # keep the durable DB queue even when JOB_QUEUE_DRIVER=redis
JOB_WORKER_INTERVAL_MS=15000
JOB_WORKER_BATCH_SIZE=10
RATE_LIMIT_DRIVER=memory     # memory | redis

# Browser sessions (milliseconds)
APP_SESSION_IDLE_MS=900000
APP_SESSION_ABSOLUTE_MS=28800000
SUPER_SESSION_IDLE_MS=600000
SUPER_SESSION_ABSOLUTE_MS=14400000
RECENT_REAUTH_WINDOW_MS=600000

# Release metadata reported by /api/info (CI falls back to GITHUB_SHA / GITHUB_RUN_STARTED_AT)
RELEASE_SHA=
BUILD_TIMESTAMP=

# Daily maintenance (lifecycle, MFA counter pruning, ledger reconciliation and certification)
# runs at CHURN_SEND_HOUR_LOCAL in CRON_TZ. LEDGER_RECONCILE_HOUR_LOCAL is accepted but unused.
CHURN_SEND_HOUR_LOCAL=9
CRON_TZ=America/Guatemala
LEDGER_RECONCILE_LIMIT=10000
LEDGER_RECONCILE_REPAIR=false
LEDGER_CERTIFICATION_OUTPUT_ROOT=
LEDGER_CERTIFICATION_RETENTION_DAYS=90
```

`DB_POOL_MAX` and `DB_TX_POOL_MAX` must be positive integers; anything else stops startup.

## 3. Database

Run migrations explicitly:

```bash
npm run ops:migrate:lock-check
npm run ops:migrate:status
npm run ops:migrate
npm run ops:rls-check
```

Schema initialization and managed migrations take a session-level PostgreSQL advisory lock
(`SCHEMA_LOCK_KEY` in `src/app/db/migrations.js`), so starting `api`, `worker` and
`ops:migrate` at the same time is safe: they wait for each other instead of interleaving.
Keep `AUTO_APPLY_MIGRATIONS=false` in production and run `ops:migrate` as a deliberate step.
Never rename or edit a migration that has been applied; add a new file and run
`npm run ops:migrate:lock`.

## 4. Start the app

```bash
npm start
```

Or with Docker Compose dev profile:

```bash
docker compose up -d --build
```

## 5. Reverse proxy

Forward HTTPS traffic to the API port and preserve client IP headers.

Health endpoints:
- `/api/health`
- `/api/ready`
- `/api/live`
- `/api/info`

## 6. Ongoing ops

```bash
npm run ops:backup
npm run ops:backup:verify -- --file backups/<latest>.sql.gz
npm run ops:backup:health
npm run ops:backup:retention
npm run ops:security-scan
npm run ops:perf-sanity
npm run ops:smoke -- --base-url https://your-domain.example --require-super-login
```

## 7. Release gate

Before building a release candidate, on a host with Docker:

```bash
npm run typecheck
npm run lint
npm run format:check
npm run test:all      # npm test, then npm run test:db (all gated suites on an ephemeral Postgres with RLS)
npm run sw:check      # asset versions and the service worker precache block must be current
```

`npm run test:db` is the same runner as the `live-gamification-integration` CI job; see
[TESTING.md](/opt/puntos/TESTING.md).

After every deploy:

```bash
npm run ops:smoke -- --base-url https://your-domain.example --require-super-login
```

If that fails, stop the rollout and use the rollback runbook in [docs/ROLLBACK_RUNBOOK.md](/opt/puntos/docs/ROLLBACK_RUNBOOK.md).

## 8. Restore drill

Practice restore in an isolated stack before trusting backups:

```bash
npm run ops:restore:drill -- backups/<file>.sql.gz
```

That boots a clean drill environment, verifies the backup first, restores it, waits for the API, and runs the same HTTP smoke checks against the restored app.

Artifacts created automatically:
- backup manifest: `backups/<file>.json`
- backup checksum sidecar: `backups/<file>.sha256`
- restore drill report: `artifacts/restore-drills/restore_drill_<timestamp>.json`
- production restore report: `artifacts/restores/restore_<timestamp>.json`

## 9. Load and restart drills

Critical-path load:

```bash
npm run ops:load:critical -- --base-url https://your-domain.example --require-super
```

Restart recovery drill:

```bash
npm run ops:failure:drill
```

Run those in staging before major releases or infrastructure changes.

Observability drill:

```bash
npm run ops:alerts:drill
```

That isolated drill boots both API and worker processes, verifies that both metrics endpoints expose the expected series, and evaluates the alert thresholds against a clean stack.

## 10. Observability

Import these assets into your monitoring stack:
- [prometheus-alerts.yml](/opt/puntos/deploy/monitoring/prometheus-alerts.yml)
- [grafana-puntos-overview.json](/opt/puntos/deploy/monitoring/grafana-puntos-overview.json)

See [OBSERVABILITY.md](/opt/puntos/docs/OBSERVABILITY.md) for scrape configuration and metric names.

Validate the alert inputs after rollout:

```bash
npm run ops:alerts:check -- --scope api --base-url https://your-domain.example --metrics-token <token> --mode evaluate
npm run ops:alerts:check -- --scope worker --worker-base-url https://worker.example.internal:3002 --metrics-token <token> --mode evaluate
```
