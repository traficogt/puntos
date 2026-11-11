# Merchant operations and pilot readiness implementation plan

> Execute with subagent-driven-development and independent specification then quality review. User authorized continuing the remaining improvements; prior instruction to work in parallel applies. Website/server only, native release freeze remains.

**Goal:** Give owners a clear view of integration health, a measurable pilot workflow, an installer handoff and enforced campaign point budgets.

**Architecture:** Extend existing Express/PostgreSQL tenant/RLS/ledger and React/Mantine owner UI. Preserve installed-client contracts. Use live recorded evidence and explicit owner attestations; no fabricated proof, automated real messages, new POS-vendor claims, real loyalty transactions or external account setup.

**Tech:** Existing pg transactions, Zod, React/Mantine, existing POS/Wallet/messaging services. Additive migrations. Continue /opt/puntos/.worktrees/merchant-web; root owns mounts, UI/demo integration, checksums and scoped deployment.

## 1. Operational health (agent)
- New services/merchant-operations-service.js and routes/merchant-operations-routes.js; GET /admin/operations-health, staff+owner+tenant, no-store, strict no query/body. Available all plans to explain locked/unconfigured states without leaking forbidden feature data.
- Return generated_at and sections for POS, campaign messaging, Apple Wallet, Google Wallet. Section fields: id,title,state (needs_attention/configured/not_configured/not_in_plan/unknown),summary,last_observed_at,metrics [{key,label,value}],action {label,href}. Spanish copy/links. No secret values, IDs, phones, raw provider bodies/errors, credentials or tenant-crossing values.
- Existing config readiness means configured, never connected/delivered. Use tenant-recorded POS last_sync/pending receipt counts and last_completed_at; messaging queued/stale/accepted/failed/uncertain/suppressed counts; wallet pass records and updates pending/failed (no claim installed on Google). Mark stale/backlog conditions clearly; no network calls or provider mutation. Fail genuine DB errors rather than zero success.
- Tests real tenant/OWNER denial/strict inputs, fixtures with no data/failures/stale queues, no raw secrets in payload, correct schema and RLS.

## 2. Campaign point budgets (agent)
- New 2026-11-10-growth-limits.sql: nullable positive points_budget and nonnegative points_committed counters; backfill historical granted member points including refunded claims (consumed budget is gross). Max budget 2,000,000; no old migration edits.
- Extend draft create contract optional points_budget default null (legacy compatibility), >= one bonus when set; replay fingerprint includes budget. Fixed after activation. Public campaign fields include points_budget,points_committed,points_remaining,budget_exhausted.
- Atomic check/increment under campaign row lock in same purchase transaction; concurrent customers cannot overspend. Exhausted offers skipped while normal base points still apply; choose next eligible campaign in deterministic expiry order. Refund/deletion do not replenish consumed budget; failures roll back increment. Keep original ledger guards/pending/replay behavior.
- Customer offer list excludes exhausted budgets and adds optional availability terms for capped campaigns. Messaging preview/queue/claim/final-dispatch exclude exhausted campaigns and clearly say subject to remaining campaign points. Existing marketing consent gates remain. No simultaneous-agent edits to message service.
- Root UI adds optional total points limit, computed estimated maximum cost from per-point estimate, spent/remaining state and honest availability copy. Null remains existing behavior. No claim monetary budget reflects actual redemption cost.
- PG tests: concurrent final remaining bonus across distinct customers, no duplicated commitment, rollback/refund/deletion, pause/expiry, legacy unbudgeted, next campaign fallback, no invite after exhaustion; route bounds and replay tests.

## 3. Pilot workspace (root)
- New 2026-11-10-merchant-pilots.sql tables merchant_pilots and merchant_pilot_checks, composite tenant FKs/RLS/runtime grants. One active pilot/business; immutable name,duration_days 14|30|60 and started_at, baseline identity; owner create UUID request_id idempotency; owner updates checklist; explicit close. No automatic business activation.
- GET /admin/pilots list bounded 20; POST create; GET /:id detail with checks + aggregate results; PUT /:id/checks/:key status pending/passed/failed/not_applicable and note up to500 chars; POST /:id/close. Strict schemas, CSRF, OWNER/tenant/no-store, analytics plan. Close accepts `{outcome: completed|stopped, note}`; stopping requires a reason and permits another pilot. Completing is allowed only when required enrollment,purchase,duplicate_receipt,redemption,refund,offline_reconnect pass; wallet_installation,message_delivery,pos_installation may be not_applicable with note. Checks are owner-reported with timestamp, never presented as automatic test proof.
- Results actual PF purchase/customer/redemption counts and sales during pilot versus equally long immediately preceding period, capped at planned end/close/current clock. No uplift causality claims. Baseline and current exact windows visible. Empty cohort does not become success. Export UTF-8 JSON report generated from already-authorized detail, no customer PII or secret data; public case studies still need consent and evidence.
- Owner Spanish tab #piloto with checklist, notes, progress and observed metrics; complete synthetic demo cycle and stale session/unsaved guards.

## 4. POS handoff (root)
- Extend existing Conectar caja screen with downloadable installer brief (plain text, static/public capability guidance + owner-entered vendor/version/deployment/capabilities; no keys or customer data). Stable PF enrollment/business only if authenticated matched tenant.
- Include paid receipt ID/customer identity/GTQ/timestamp/items, refund semantics, duplicate replay/offline/reconnect requirements, deployment and access questions; accurate current routes and documented limitations. Direct Loyverse vs CSV vs API adapter distinction explicit. No universal/plug-and-play claims and no remote vendor testing without actual setup.

## 5. SEO status in parallel
- User asks about evergreen articles and current SEO. Independent read-only audit of live public pages/indexing/title/canonical/sitemap/schema and Search Console availability; explain technical readiness versus actual search traffic. Recommend article resources without claiming unpublished guides exist. User subsequently authorized an empty Spanish /guias/ section and reusable publication templates; no actual articles yet. Keep the empty section noindex and out of the sitemap until content is published.

## Validation/release
- Meaningful backend/ledger TDD, disposable PG only; no production writes except additive migrations/configured release, no outbound test messages. Existing full unit/type/lint, browser mobile/light/dark/accessibility/demo no-network, new feature tests. Independent spec then quality review.
- Snapshot current baseline under /var/lib/puntos/releases/merchant-operations-20261110. Preserve all preexisting dirty work. Scoped API/worker overlays from current respective live image hashes; runtime route registry based on deployed routes (root source still has unpublished order/contact routes). Backup, only new migrations, deploy, read-only smoke/runtime permission checks and persistent tags/rollback. Do not delete old hashed assets or update native code/builds.
