# Security Review Report (Living Document)

This repo ships with multiple security controls (auth, CSRF, RLS, SSRF defenses, secret encryption, etc.).

This file is intentionally short and points to the living, verifiable artifacts:

- Production hardening checklist + operational gates:
  - `docs/PRODUCTION_HARDENING_STATUS.md`
- Tenant isolation model (Postgres RLS + request/job DB context):
  - `docs/TENANT_RLS.md`
- Security baseline expectations:
  - `SECURITY.md`
- Static security scan (local rules):
  - `npm run ops:security-scan`

If you are deploying to production, you should treat `docs/PRODUCTION_HARDENING_STATUS.md` as the go-live gate.

