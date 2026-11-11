# Merchant growth controls implementation plan

> Use subagent-driven-development with separate specification and quality reviews. User explicitly approved items1–4; routine design choices are covered by that authorization. Continue existing isolated merchant-web worktree. Website/server only; no native app files/builds/OTA.

**Goal:** Complete POS refund operations, acquisition attribution, honest incentive economics and guided lifecycle automation.
**Architecture:** Extend existing Express/PostgreSQL tenant RLS + ledger + durable messaging and React/Mantine interfaces. Keep installed-client contracts compatible. Established qrcode/jsQR, Mantine and SQL facilities remain; no new platform migration. Root owns shared mounts, navigation/demo dispatch, migration checksums, runtime-role grants and scoped deploy.

## A. POS refunds and reconciliation (agent)
- Inspect native Loyverse receipt format using official documentation and current ledger reversal service. Ingest validated refund receipt IDs + original receipt ID into a durable tenant-scoped reconciliation queue; stable fingerprints and replay/conflict behavior. Resolve same source/merchant/store and original external transaction only; never guess a customer from phone for refund.
- Automatically reconcile complete refunds using existing ledger reversal/gamification rules, preserving pending/posted policies, negative-balance policy and idempotency. Partial/ambiguous/missing-original/insufficient-balance cases remain explicitly actionable for owner review; do not silently ignore or guess proportional points. Agent should evaluate safe partial support and communicate limits before final release.
- Add generic authenticated refund API contract for adapters, owner list/retry/reconciliation view in Conectar caja, real source evidence and safe status counts. No fabricated successful refund status or manual mark-as-success shortcut. No production refund calls/test messages.
- Additive migration, strict owner/tenant/CSRF gates for admin writes, existing POS auth for external ingestion. Disposable PostgreSQL concurrency/replay/rollback/cross-tenant/full/pending/partial/manual-already-reversed tests.

## B. QR acquisition funnel (agent)
- Owner creates named source links, optional valid business branch; stable Spanish registration URL using public opaque source code. Owner sees visits, new registrations, first/repeat purchasers and recorded sales from attributed customers. Distinguish observed attribution from causal revenue and visits from unique people/scans.
- No fingerprinting/IP/contact details stored for anonymous visits. Short-lived opaque visit token, tenant-bound and linked only on successful verified new enrollment. Existing customers do not become new acquisitions, repeated verification and multiple links cannot duplicate/overwrite first attribution. Unknown/old links cannot break normal registration. Bounded lists/strict writes/RLS.
- Integrate source into enrollment form/request/verification, brand QR source selector and QR canonical target validation, without accepting arbitrary export URLs. Stable printed links. Preserve no-source behavior and demo isolation.
- New Acquisition.jsx and demo-acquisition.js; root adds navigation/mounts. Tests valid enrollment, mismatch/replay/expiry, deleted customer handling, no-source fallback, QR decode with source and metrics definitions.

## C. Reward economics (agent)
- Owner records per-reward unit costs in GTQ and optional gross margin/cost-per-point assumptions. Use dedicated schema/settings preserving reward contracts. Record immutable cost/point snapshots on completed redemptions; never apply today's entered cost retroactively to unknown historical costs.
- Owner report: completed redemption costs, cost coverage, outstanding/pending points, recorded sales, merchant-assumption margin estimate clearly separated from observed numbers. Unknown cost remains unknown, not zero; incomplete cost data blocks misleading complete margin/profit claims. No accounting certification or causal ROI claims.
- Reuse existing redemption transaction hooks, enforce tenant/OWNER/analytics/CSRF, audit changes, deleted/expired/reversed cases correctly. Agent coordinates refund sales semantics; full reversed purchases excluded. New Economics.jsx and demo-economics.js; root mounts/nav.
- Disposable DB snapshot/concurrency/null/zero/historical/edit coverage tests; examples stay synthetic. No financial settings guessed for real businesses.

## D. Guided automations (root)
- Owner interface for existing birthday and inactivity-recovery rules, editable points, inactivity threshold, schedule, monthly point cap and frequency controls. Keep unknown unrelated lifecycle settings intact; write explicit supported fields atomically and enforce current plan.
- Read-only preview separates eligible customers, consented/reachable customers, budget availability and provider configuration. New automations default off; owner explicitly saves/enables. Pause is explicit and stops future queued dispatch. Expose execution/results history and distinguish accepted vs delivered.
- Reuse existing loyalty ledger/lifecycle events, messaging consent/provider classifier, quiet-hour/frequency rules and unsubscribe capability. Durable results/queue, idempotent awarding and budget commitment in one transaction. Gross budgets do not replenish on refunds; concurrent workers cannot exceed cap. Uncertain dispatch not auto-retried. Keep grants and events tenant-scoped, skip deleted customers, no demo outbound calls.
- New Automations.jsx/demo-automations.js, service/routes + additive migration; targeted DB and realHTTP tests, no real sends in tests.

## Integration and release (root)
- Collect exact router/service contracts and migrations; update role allowlists/checksums. Preserve source-only unpublished order/contact paths in source and exclude them from runtime registry, as prior releases did.
- Full unit/type/lint plus meaningful disposable PG and browser tests; API/worker image overlay from exact respective current images, migration status assertion, verified DB backup, additive migrations only, staged source sync and live read-only smoke. Old assets/rollback images retained. No unrelated dirty work changed, no native builds. Independent reviews before publishing.
