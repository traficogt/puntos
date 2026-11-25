# PuntosFieles

Loyalty platform for Guatemala, operated as a hosted service at `app.puntosfieles.com`; the stack (Express API, worker, PostgreSQL, optional Redis) is self-hostable with Docker Compose. QR-based customer cards, staff scanning, rewards, analytics, and offline-capable web clients. Architecture: [docs/ARCHITECTURE.md](/opt/puntos/docs/ARCHITECTURE.md).

## Stack
- Node.js 24.22.3 for server/web development (`.nvmrc`); the customer app has its own Node 22.23.5 pin.
- Express 5 (API and worker processes)
- PostgreSQL 17 on the central database VM (`APP_DB_HOST`, default `10.10.1.51` in `docker-compose.yml`); PostgreSQL 16 in the test and e2e compose stacks
- Redis 7, optional (`RATE_LIMIT_DRIVER=redis`, `JOB_QUEUE_DRIVER=redis`)
- Vanilla HTML/CSS/JS PWA in `public/` (customer wallet, staff scanner, internal signup at `/crear-negocio/`, self-serve 14-day trial signup at `/prueba/`, published prices at `/precios`, super console); React 19 + Mantine 9 merchant app in `web/merchant` (the owner dashboard at `/negocio/`, including "Plan y facturación" at `#plan` for card checkout through Recurrente; the vanilla `/administracion/` was retired on 2026-11-25 and redirects there); Expo native app in `apps/customer` (frozen, see `AGENTS.md`)
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
- A curated OpenAPI subset is served at `/api/v1/openapi.json`, `/api/v1/openapi.yaml`, and Swagger UI at `/api/v1/docs`
- `docker-compose.yml` runs `api` and `worker` only; PostgreSQL lives on the central database VM (`APP_DB_HOST`). The e2e compose files start their own disposable PostgreSQL 16 and Redis
- Secrets are loaded from files via `*_FILE` env vars and should live outside the repo tree
- Subscription billing (self-serve trial wave 2): the owner page `#plan` and the super console's "Suscripciones y cobro" section talk to `/api/admin/billing*` and `/api/super/billing*`; without a configured provider the API answers `503 BILLING_UNAVAILABLE` and both surfaces fall back to the upgrade request form or a notice (see `docs/ARCHITECTURE.md` §5)

## Commands
```bash
npm run typecheck
npm run lint
npm run format            # Prettier; CI runs format:check
npm test                  # unit + Docker-free integration
npm run test:db           # all gated integration suites on an ephemeral Postgres (Docker)
npm run test:integration:domains
npm run test:e2e
npm run sw:build          # refresh ?v= asset versions and the service worker precache block
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

### Asset versions and service worker assets
Hand-written pages and stylesheets under `public/` reference their local assets as
`/asset.ext?v=<8 hex digits of the file's SHA-256>`. `src/scripts/build-asset-versions.mjs`
rewrites those values (`<script src>`, `<link>` stylesheets/icons/manifest/preloads,
`<img>`/`<source>` `src` and `srcset`, CSS `url()` and `@import`), leaf first (fonts ->
stylesheets -> pages), and `express.static` serves any `?v=` request as
`Cache-Control: public, max-age=31536000, immutable` (`src/utils/static-cache-headers.js`)
while documents and `sw.js` keep their headers. Vite output under `public/merchant/`,
`public/ayuda/`, `public/revision-astryx/` and `public/pwa-test/` are not touched.
JavaScript sources are never rewritten: assets a script requests by string literal
(`/styles/demand-notebook.css`, `/runtime-config.js`, ES module imports) stay unversioned and are served network-first by the worker; the list is
`RUNTIME_REFERENCED_ASSETS` in the script.

`public/sw.js` no longer carries a hand-maintained precache list or version. The block
between `// BEGIN GENERATED (npm run sw:build)` and `// END GENERATED` is produced by
`src/scripts/build-sw-assets.mjs`, which starts from the offline application documents
(`NAVIGATION_FALLBACKS`, the Spanish document routes and the `sendFile` routes) and walks
their scripts, ES module imports, stylesheets, `@import`/`url()` fonts, icons and the web
manifest. `CACHE` is content-hashed (`pf-` + 12 hex digits over the asset list and file
bytes), so it rotates exactly when a precached file changes; nobody bumps it by hand.

```bash
npm run sw:build   # refresh ?v= versions, then rewrite the generated block (after changing any page, module, stylesheet or image)
npm run sw:check   # exit 1 when a page carries stale versions or public/sw.js is stale (also enforced by test:unit)
```

Assets that only appear at runtime (URLs assembled from variables) go in the documented
`EXTRA_ASSETS` list inside the script; `CACHE_EPOCH` there forces a rotation without an
asset change.

## Release gate
- [release-gate.yml](/opt/puntos/.github/workflows/release-gate.yml) blocks release candidates on scans, DB checks, HTTP smoke, Chromium flows, and visual regression.
- Run it manually with `workflow_dispatch` or by pushing a `v*` tag.
- [ci.yml](/opt/puntos/.github/workflows/ci.yml) also supports `workflow_dispatch` now, so you can run the full CI/security path on demand for a branch before release tagging.

## Documentation
- [docs/ARCHITECTURE.md](/opt/puntos/docs/ARCHITECTURE.md) — system shape, request lifecycle, tenancy, money, background work, frontend and testing conventions, known debt
- [QUICKSTART.md](/opt/puntos/QUICKSTART.md)
- [DEPLOYMENT_GUIDE.md](/opt/puntos/DEPLOYMENT_GUIDE.md)
- [TROUBLESHOOTING_GUIDE.md](/opt/puntos/TROUBLESHOOTING_GUIDE.md)
- [TESTING.md](/opt/puntos/TESTING.md)
- [SECURITY.md](/opt/puntos/SECURITY.md)
- [docs/OBSERVABILITY.md](/opt/puntos/docs/OBSERVABILITY.md)
- [docs/INCIDENT_RUNBOOK.md](/opt/puntos/docs/INCIDENT_RUNBOOK.md)
- [docs/ORDERS_API_INTEGRATION.md](/opt/puntos/docs/ORDERS_API_INTEGRATION.md)
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
