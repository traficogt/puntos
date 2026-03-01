# Changelog

## 1.3.7
- File-based secret handling is now the documented default
- CI gates include typecheck, lint, tests, OpenAPI freshness, RLS checks, security scan, perf sanity, dependency audit, and smoke E2E
- Admin audit tooling supports impersonation provenance, filters, and CSV export
- Payment webhooks, gift cards, analytics, plans, and RBAC remain active product areas

## 1.0.x to 1.3.x
- Core platform shipped with customer join flows, staff scanning, rewards, analytics, messaging adapters, webhooks, and tenant isolation
- Security hardening added CSRF, stricter proxy handling, webhook SSRF defenses, secret encryption, and stronger password rules
- Test coverage expanded across unit, integration, and Playwright E2E paths
