# Merchant launch readiness implementation plan

> For agentic workers: use subagent-driven-development and independent parallel tasks, followed by integration and review.

**Goal:** Make the website easier to launch, migrate into, connect, and operate; assess current competitive strengths and remaining product gaps.

**Architecture:** Extend existing tenant-scoped Express/Postgres services and the React/Mantine merchant application. Reuse established validators, transactions, auditing, ledger rules, provider configuration, and demo boundaries. Keep native applications and cloud build workflows unchanged. Preserve current runtime route/migration exclusions during the scoped release.

**Tech stack:** Express, PostgreSQL with forced tenant RLS, Zod, React, Mantine core/form, Node test runner, Playwright.

## 1. Guided setup (root)
- [x] Inspect existing brand/program/reward editors and API contracts.
- [x] Extend Launch.jsx into a resumable task flow, deriving readiness from saved server data. Include editable safe program settings using existing routes, branding/rewards deep links, reward-cost completeness, migration, POS choice, and pilot/operational checks.
- [x] Do not auto-activate automations, invent completed physical tests, or mark optional POS integration required for manual scanner users.
- [x] Add focused readiness-model tests; verify validation, saving and mobile/browser accessibility.

## 2. Customer and starting-balance migration (isolated implementer)
- [x] Add bounded CSV/column mapping preview with normalized phone identity, duplicate/conflict validation and no marketing-consent inference.
- [x] Implement owner-only tenant-scoped import API, persistent idempotent batch identity and atomic audited ledger opening balances. Existing customer balances must never be overwritten or silently increased; require a safe explicit policy, preferably skip existing records. Do not mark phone verified or mint sessions.
- [x] Add a Mantine migration UI, template, preview, totals and result summary, isolated demo module.
- [x] Test duplicate file/retry/concurrency, tenant isolation, invalid rows, rollback, verified signup claiming an imported record, and ledger reconciliation.
- [x] Root integrates navigation/router/grants/checksums only after reviewing exported contracts.

## 3. Unified operational actions (isolated implementer)
- [x] Extend merchant-operations-service.js and Operations.jsx with durable POS refund queue, lifecycle outbox states, missing reward-cost coverage, accurate Wallet/provider state and ranked next actions.
- [x] Reuse existing schemas/queries and preserve backward-compatible response fields.
- [x] Distinguish configuration, provider acceptance, actual delivery, and physical readiness; queries must be read-only and tenant-scoped.
- [x] Add meaningful service tests and isolated demo data. Root owns demo-api.js routing.

## 4. Repeatable POS preparation (isolated implementer)
- [x] Inspect existing preflight, CSV and Loyverse capabilities. Improve PosConnect.jsx and pos-handoff-model.js with a guided method choice and vendor-specific prerequisites/acceptance checklist.
- [x] Research official Loyverse/Odoo docs. Provide an executable safe local fixture/contract validation workflow only if it can avoid real writes; never represent an untested adapter as a completed integration.
- [x] Export a reusable installation handoff using existing contracts, correct currency/phone/scope/idempotency requirements and precise offline limits.
- [x] Test handoff correctness, configuration states and preflight behavior; no real POS requests/transactions.

## 5. Competitive assessment, integration and release (root)
- [x] Research at least Boomerangme, Devotio, PassKit, Smile, Yotpo, Talon.One and Antavo through current official sources. Compare observed PF implementation with documented capabilities, not unsupported rankings or ROI claims.
- [x] Record specific remaining product/architecture/ecosystem/governance gaps beyond missing real-world evidence.
- [x] Run full typecheck/lint/unit/merchant checks plus focused disposable PostgreSQL suites and browser desktop/mobile/a11y checks.
- [x] Independent spec and quality reviews; resolve material findings before publish.
- [x] Build scoped API/worker overlays from current live images, verify new migrations in disposable DB and restricted role, verified production backup before apply, deploy web/server only, verify health/private routes/demo/no native changes, sync scoped files with baseline guards.

## 6. Flexible audience targeting (owner added during implementation)
- [x] Reusable segments combine all/any inclusion rules and all/any exclusions, with a bounded purchase window (30/90/180/365 days). Metrics: recorded purchase count and spend, all-time last purchase age/has-purchase, PF record age, current available points, explicit marketing consent.
- [x] Owner-only tenant-scoped CRUD and preview; strict validated fields/operators, parameterized SQL, max100 saved definitions, optimistic versions, archive instead of destructive deletion, audited edits and idempotent creates.
- [x] Dynamic preview shows total matches, contactable consent count and 10 sample customers; no inferred consent and no exports of phone details in samples.
- [x] Mantine audience builder with reusable presets and preview invalidation when criteria change; Spanish #audiencias route and offline/empty/error states; demo isolated.
- [x] Existing growth campaigns accept either a recovery list or a saved segment/version with explicit member limit 10..200. Persist immutable definition/name/version/cutoff/matched-total with campaign; preserve backward compatibility, idempotency and existing holdout/activation rules. Edits never rewrite an existing campaign audience; messaging rechecks consent before sending.
- [x] Test true OR/AND and exclusions, never-purchased behavior, opening balance/nonpurchase/refund exclusion, tenant isolation, stale versions, overflow disclosure, retry/concurrency and old recovery campaign flow.
