# Deployment Guide

This guide describes the current production model.

## Requirements
- Node.js 20+
- PostgreSQL 16+
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

Use `TRUST_PROXY=1` only when all inbound traffic comes through a trusted reverse proxy hop.

## 3. Database

Run migrations explicitly:

```bash
npm run ops:migrate:status
npm run ops:migrate
npm run ops:rls-check
```

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
