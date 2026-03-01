# Tenant RLS Model (Postgres) - PuntosFieles

This document describes the production tenant isolation model implemented via:
- Postgres Row Level Security (RLS)
- request-scoped DB sessions (per HTTP request)
- explicit background worker DB contexts

If you change anything related to tenant scoping, read this first.

## Goals / Invariants

1) No cross-tenant reads or writes from the runtime DB role (default: `loyalty`).
2) "Tenant context" is explicit and enforced at the DB layer.
3) Platform-wide operations are explicit (separate flag), auditable, and minimized.
4) Webhook ingestion can create/update "unmapped" rows (business_id NULL) without granting full platform access.

## Terminology

- Tenant: a `businesses.id` UUID.
- Tenant-scoped table: any table that contains `business_id` or can be derived to a tenant via FK joins.
- RLS GUCs: per-session settings read by RLS policies:
  - `app.current_tenant` (uuid as string)
  - `app.platform_admin` ("true" or "")
  - `app.webhook_ingest` ("true" or "")

## Source of Truth

- Canonical RLS policies + helper functions (final desired state):
  - `src/app/migrations/2026-02-27-tenant-rls_canonical.sql`
- Historical migrations (kept for applied history; do not edit; may not reflect the final state alone):
  - `src/app/migrations/2026-02-27-tenant-rls-strict.sql`
  - `src/app/migrations/2026-02-27-tenant-rls-webhook-ingest.sql`
  - other `src/app/migrations/2026-02-27-tenant-rls-*.sql`
- Request-scoped DB session + GUC cleanup:
  - `src/middleware/pg-client.js`
  - `src/middleware/tenant.js`
- Background job / worker contexts:
  - `src/app/database.js` (`withDbClientContext`)

## RLS Behavior (What the DB Enforces)

### 1) Default (no flags set)

When neither `app.current_tenant` nor `app.platform_admin` is set:
- Tenant tables must return 0 rows.
- Tenant table inserts/updates should fail (or be no-ops) unless explicitly allowed by policy.

### 2) Tenant context (`app.current_tenant = <business uuid>`)

When `app.current_tenant` is set:
- Tenant tables are restricted to `business_id = current_tenant`.
- Derived tenant tables (no `business_id`) are restricted via joins.
- Most writes require `business_id = current_tenant` via `WITH CHECK`.

### 3) Platform admin (`app.platform_admin = 'true'`)

When `app.platform_admin` is set:
- Platform operations can read/write tenant tables across businesses.
- This should only be enabled for:
  - Super admin routes (`requireSuperAdmin`)
  - trusted internal startup/maintenance tasks

Important:
- Platform admin is a *GUC*, not a DB role. It is only safe because:
  - it is set by strongly authenticated server code, and
  - it is cleared on connection release (`withPgClient`), and
  - background workers use explicit `withDbClientContext`.

### 4) Webhook ingest (`app.webhook_ingest = 'true'`)

This is narrower than platform admin.

It exists so `/public/payments/webhook/:provider` can:
- create/update `payment_webhook_events` rows when `business_id IS NULL`
  (e.g. missing/invalid mapping in provider payload)

Without granting broad cross-tenant read/write access.

## App-Layer Patterns (How To Use It Correctly)

### HTTP request (normal)

1) `withPgClient` runs for every request and creates a request-scoped pg client.
2) `tenantContext` sets `req.tenantId` and calls `setCurrentTenant(req.tenantId)` before continuing.
3) Repositories use `dbQuery(...)` which automatically uses the request/tx client from AsyncLocalStorage.

Do:
- Add `tenantContext` to any route that touches tenant tables.
- Use repositories (or `dbQuery`) rather than `pool.query`.

Do not:
- use `pool.query` directly inside routes/services (it bypasses request scoping).
- start detached async tasks that still reference the request DB context after the response finishes.

### HTTP request (super admin)

- `requireSuperAdmin` sets platform admin mode by calling `setPlatformAdmin(true)`.
- Super admin routes should still avoid mixed-tenant queries unless intentional.

### Background workers / cron / startup jobs

Background code must not rely on an HTTP request context.

Use:
- `withDbClientContext({ tenantId, platformAdmin }, fn)`

Examples:
- "process all tenants": use `platformAdmin: true` only to list IDs, then run per-tenant work with `tenantId` set.
- secret rotation / maintenance: run under `platformAdmin: true` and `tenantId: null`.

### Webhook delivery (outbound)

Outbound delivery includes per-business billing.
Pattern:
- claim pending jobs under platform admin (fast DB-only section)
- for each delivery, switch to tenant context when updating per-tenant tables

See:
- `src/app/services/webhook-service.js`

## Adding a New Tenant-Scoped Table (Checklist)

1) Add table to schema.
2) Add/update RLS policy in `2026-02-27-tenant-rls_canonical.sql`:
   - if it has `business_id NOT NULL`, add to the "NOT NULL business_id" list
   - if it is derived (e.g. `customer_id` only), add a join-based policy block
3) Ensure all access paths set tenant context:
   - routes include `tenantContext` (or `setTenantForRequest` for public routes)
   - background jobs use `withDbClientContext({ tenantId })`
4) Update `src/scripts/rls-check.mjs` if needed.

## Verification

Run:
- `npm run ops:rls-check`
- `npm run ops:migrate:lock-check`

This script validates:
- strict isolation with no tenant set
- correct tenant filtering when a tenant is set
- global visibility when platform admin is set

The lock check prevents accidental edits to existing managed migrations.
