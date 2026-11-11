# Referral growth implementation plan

**Goal:** Let owners configure existing referral incentives, inspect the path from a recorded referral to a genuine purchase, and share the separate public enrollment QR.

**Architecture:** Extend the established Mantine owner surface at `#referidos`. Reuse GET/PUT `/api/admin/referral-settings` and enrollment endpoints. Add an owner-only, referrals-plan-gated read endpoint `/api/admin/referral-growth`, backed by one tenant-scoped SQL snapshot. No migration or native changes.

**Design:** An open results section with a registration cohort selector, three explicitly nested counts (recorded referrals, those with purchases, those with purchases and rewarded status), independent reward status totals, and a paginated referral table. Below it, a two-column incentive form and public enrollment panel inherit existing typography, spacing and controls. Drafts participate in the shell guard. Loading, error, empty, clipboard failure, mobile, and disabled plan states are included.

**Definition:** `days=30|90` selects referral creation dates in the local business reporting timezone through now. A first purchase is the first transaction at or after referral creation and before now with sale sources online/offline/external/order, purchase/null type, POSTED/PENDING status, positive amount/visit/item activity, and no original/reversed reference. This matches the overview's activity definition. Soft-deleted customers remain in aggregate history but never expose names. Explicit tenant predicates cover referrals, both customers, and transactions.

**Legacy limitation:** Referral reward processing currently totals all `amount_q` transaction values, without the strict purchase exclusions used by the new report. The new endpoint does not assess eligibility, replay awards, or alter that engine. Signup awards can appear without purchases. Current configuration is not a snapshot of historical reward rules. Describe settings as existing award rules; show actual status separately. Pausing the referral program prevents access to sharing codes in the customer flow, but existing codes can still be applied and pending referrals are not cancelled. The UI states these limits explicitly.

**API:** `GET /api/admin/referral-growth?days=30&phase=all&limit=25&offset=0`; phase is all/awaiting_purchase/purchased; limit 1–100; offset 0–10000. Returns `ok`, `generated_at`, `timezone`, `period`, `summary`, `referrals`, `pagination`, and `notes`. Summary always covers the complete cohort; phase filters table rows only. The endpoint requires an authenticated owner and the referrals feature, independently of analytics.

- [x] Add failing route tests for authentication, owner/plan gate, strict query parsing, and authenticated tenant.
- [x] Add failing PostgreSQL tests for cohort windows, real purchases, source exclusions, independent rewards, pagination, tenant isolation and deleted PII.
- [x] Implement read-only service and standalone route factory; parent integrates mount.
- [x] Add tested form normalization/validation and synthetic demo handler; parent integrates exact demo routes.
- [x] Build `Referrals.jsx` with existing Mantine components and draft handling; parent integrates navigation and feature prop.
- [x] Verify focused tests, disposable PostgreSQL tests, build/lint/type checks, desktop/mobile browser workflow and detector. No production writes, external messages, native builds, deploys or commits.


## Verification evidence

- 20 focused tests pass: six authenticated route tests, seven PostgreSQL integration tests, four form/link model tests, and three synthetic demo tests.
- PostgreSQL ran only in disposable container `pf-referral-growth-test`, database `referral_growth_test`, exposed on local port 55438. The container was removed after the checks. No schema migration was needed.
- `PLAYWRIGHT_BROWSERS_PATH=0 node web/merchant/tests/referrals-browser.spec.mjs` builds an isolated fixture into ignored `artifacts/referrals/build`, leaving the shared production build untouched. Ten checks pass: funnel/filter/pagination, actual settings PUT plus CSRF, draft/save/retry/discard, concurrent baseline change, read error recovery, empty/signup states, plan locking and desktop/mobile light/dark accessibility.
- Axe reports no WCAG 2 A/AA or 2.1 AA violations in the three captures. Mobile has no document overflow; the native horizontal table container is keyboard focusable. Primary save/copy buttons have at least 44px height. Captures are in `artifacts/referrals/`.
- Focused ESLint passes. Impeccable detector returned `[]`; the final layout was inspected against the existing operational styles. No new design identity or DESIGN.md changes.
- Repository typecheck has no referral errors, but at this checkpoint remains blocked by two concurrently developed `tests/unit/pos-preflight-routes.test.js` typing errors (`__openapi` and server address `port`). Root owns combined verification.
- Root has integrated the standalone route factory, exact demo routes, `features.referrals`, and the `#referidos` navigation. Combined application browser verification and independent final review remain with the parent task.

The settings conflict check reads the current stored baseline before PUT; it detects prior changes but is not an atomic server version precondition. Existing settings API behavior is preserved.
