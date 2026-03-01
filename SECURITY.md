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

## Recommended checks
```bash
npm run typecheck
npm run lint
npm test
npm run ops:security-scan
npm run ops:rls-check
```
