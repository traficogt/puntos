# PuntosFieles

Self-hosted loyalty platform for Guatemala with QR-based customer cards, staff scanning, rewards, analytics, and offline-capable web clients.

## Stack
- Node.js 20
- Express
- PostgreSQL 16
- Vanilla HTML/CSS/JS
- Playwright
- Docker Compose

## Quick start
Development bootstrap creates `.env.dev` plus an external secrets directory outside the repo checkout:

```bash
./src/scripts/bootstrap-dev.sh
docker compose up -d --build
```

Or use:

```bash
make up
```

The bootstrap script writes secrets under:

```text
${XDG_STATE_HOME:-$HOME/.local/state}/puntos/secrets-dev
```

`SECRETS_DIR` can be overridden before running bootstrap.

## Runtime model
- API health endpoints are mounted under `/api/health`, `/api/ready`, `/api/live`, `/api/info`
- OpenAPI is served at `/api/v1/openapi.json`, `/api/v1/openapi.yaml`, and Swagger UI at `/api/v1/docs`
- Docker Compose binds Postgres to loopback only in the dev profile
- Secrets are loaded from files via `*_FILE` env vars and should live outside the repo tree

## Commands
```bash
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run openapi:generate
npm run ops:migrate
npm run ops:rls-check
npm run ops:security-scan
npm run ops:perf-sanity
npm run ops:load:critical -- --base-url http://localhost:3001 --require-super
npm run ops:alerts:check -- --scope api --base-url http://localhost:3001 --metrics-token <token>
npm run ops:alerts:drill
npm run ops:smoke -- --base-url http://localhost:3001
npm run ops:failure:drill
npm run ops:backup
npm run ops:backup:verify -- --file backups/<file>.sql.gz
npm run ops:restore:drill -- backups/<file>.sql.gz
```

## Release gate
- [release-gate.yml](/opt/puntos/.github/workflows/release-gate.yml) blocks release candidates on scans, DB checks, HTTP smoke, Chromium flows, and visual regression.
- Run it manually with `workflow_dispatch` or by pushing a `v*` tag.
- [ci.yml](/opt/puntos/.github/workflows/ci.yml) also supports `workflow_dispatch` now, so you can run the full CI/security path on demand for a branch before release tagging.

## Documentation
- [QUICKSTART.md](/opt/puntos/QUICKSTART.md)
- [DEPLOYMENT_GUIDE.md](/opt/puntos/DEPLOYMENT_GUIDE.md)
- [TROUBLESHOOTING_GUIDE.md](/opt/puntos/TROUBLESHOOTING_GUIDE.md)
- [TESTING.md](/opt/puntos/TESTING.md)
- [SECURITY.md](/opt/puntos/SECURITY.md)
- [docs/OBSERVABILITY.md](/opt/puntos/docs/OBSERVABILITY.md)
- [docs/INCIDENT_RUNBOOK.md](/opt/puntos/docs/INCIDENT_RUNBOOK.md)
- [docs/ROLLBACK_RUNBOOK.md](/opt/puntos/docs/ROLLBACK_RUNBOOK.md)
- [docs/TENANT_RLS.md](/opt/puntos/docs/TENANT_RLS.md)
- [docs/PRODUCTION_HARDENING_STATUS.md](/opt/puntos/docs/PRODUCTION_HARDENING_STATUS.md)

## Security notes
- Do not store live secrets or cookie jars in the repo
- Keep `SECRETS_DIR` outside the checkout
- Rotate all secrets immediately if they were ever placed in the workspace
- Keep `TRUST_PROXY=0` unless traffic always arrives through a trusted reverse proxy hop

## License
MIT
