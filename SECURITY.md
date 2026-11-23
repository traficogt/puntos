# Security Baseline

## Core controls
- Helmet and CSP headers
- HTTP-only auth cookies
- Double-submit CSRF protection
- Request rate limiting
- Zod request validation
- Tenant isolation via Postgres RLS and request-scoped DB context
- Webhook SSRF protection and secret encryption at rest
- Ed25519-signed short-lived QR tokens with replay protection

## Operational expectations
- Keep secrets outside the repo tree
- Rotate secrets immediately if they were ever stored in the workspace
- Do not store cookie jars, HAR files, or other live session artifacts in the repo
- Keep Postgres bound to loopback or private network only
- Require a metrics token for both `/api/metrics` and the worker `/metrics` endpoint
- Keep `TRUST_PROXY=0` unless traffic always arrives through a trusted reverse proxy
- In production, require HTTPS origins, a metrics token, and a webhook encryption key at startup

## Unreleased hardening (commit `5c084b4`, 2026-11-23)
- Request-pinned database connections (which carry the tenant and platform-admin session
  settings) are mounted on `/api` only (`src/middleware/pg-client.js`); static assets and
  HTML pages never hold one.
- A connection whose `app.current_tenant` / `app.platform_admin` / `app.webhook_ingest`
  settings cannot be reset is destroyed rather than returned to the pool
  (`withDbClientContext`, `withTransaction`, `withPgClient`).
- API error responses carry an explicit stable `code`; PostgreSQL SQLSTATE values and Node
  system codes are never echoed to clients (`src/utils/http-error.js`,
  `src/middleware/common.js`).
- Schema initialization and migrations run under a PostgreSQL advisory lock so concurrent
  process starts cannot interleave DDL.
- `CONTACT_TURNSTILE_SITE_KEY` must be configured in production whenever
  `CONTACT_TURNSTILE_SECRET` is set; the site-key fallback that lived in code was removed.
- Security-event and audit write failures are logged instead of silently swallowed.

Request lifecycle, tenancy and the RLS session settings are described in
[docs/ARCHITECTURE.md](/opt/puntos/docs/ARCHITECTURE.md); the policy model is in
[docs/TENANT_RLS.md](/opt/puntos/docs/TENANT_RLS.md).

## Recommended checks
```bash
npm run typecheck
npm run lint
npm test
npm run ops:security-scan
npm run ops:rls-check
```
