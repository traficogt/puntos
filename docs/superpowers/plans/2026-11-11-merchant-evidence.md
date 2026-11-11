# Merchant evidence implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Track acceptance below; do not commit unrelated dirty work.

**Goal:** Complete the four priorities in the browser product with trustworthy data and production verification.
**Architecture:** Add read-only derived evidence to existing customer/campaign APIs; reuse reward eligibility, campaign point limits and local staff practice. Keep native payloads backward compatible and ship a scoped overlay.
**Tech Stack:** Node/Express/PostgreSQL; vanilla customer UI; React/Mantine merchant UI; Node test runner and Playwright.

## 1. Reward progress
- [x] Add failing behavior tests for affordable-first, protected terms, pending exclusion, expiry and logout races in existing customer/Wallet tests.
- [x] Reuse `src/app/services/native-wallet/engagement.js` via a customer progress adapter in `src/app/routes/customer-routes.js`; keep legacy response fields.
- [x] Update `public/customer/{rewards,render,me,session}.js`, `public/customer.html`, `public/types.ts` and existing customer CSS as needed.
- [x] Run targeted Node tests and `tests/e2e/reward-inventory-public-browser.mjs`; inspect mobile/light/dark captures.

## 2. Cost controls
- [x] Add `web/merchant/tests/offer-cost-model.test.js` covering unknown versus zero, whole-bonus flooring, audience/control capacity, currency precision and allowance too small.
- [x] Implement `web/merchant/src/offer-cost-model.js` and `OfferCostPreview.jsx`; integrate narrowly into `GrowthCampaigns.jsx` and `CampaignPreflight.jsx`.
- [x] Mirror any additive preflight metadata in `demo-growth.js` only after coordination with measurement owner.
- [x] Verify submitted budget after conversion, changed assumptions, validation and existing atomic budget tests.

## 3. Activation
- [x] Add failing readiness tests in `web/merchant/tests/launch-model.test.js` for paused/expired/exhausted/inventory-blocked rewards.
- [x] Update `Launch.jsx` and `launch-model.js` to use reward-workspace and next-step navigation.
- [x] Add `LaunchPractice.jsx` using `createPracticeSession` from `public/staff/service-briefing.js` without production writes.
- [x] Add `launch-activation-browser.spec.mjs` for setup navigation, practice, demo consistency, mobile/themes and accessibility.

## 4. Campaign evidence
- [x] Add `tests/unit/campaign-measurement.test.js`: known Wilson/Newcombe examples, zero/all outcomes, unequal groups, invalid counts, running/paused/stale/missing/small/quiet states.
- [x] Implement `src/app/services/campaign-measurement.js`; enhance `getGrowthCampaign` in `growth-campaign-service.js` with same-snapshot as-of time, missing assigned members, readiness and message counts.
- [x] Preserve raw assigned-group aggregates and legacy fields. Add report metadata rather than changing award or allocation paths.
- [x] Extract `web/merchant/src/CampaignResults.jsx`, mirror representative results in `demo-growth.js`; parent owns these files and final `GrowthCampaigns.jsx` integration.
- [x] Extend PostgreSQL growth-campaign tests for denominator, refund/window, no cross-tenant exposure, missing/stale data and channel evidence. Extend browser checks for honest statuses and recorded-sales labeling.

## 5. Review and release
- [x] Cross-review each slice for spec compliance, then code quality; resolve concrete findings.
- [x] Run root unit/lint/type checks, merchant unit/build, focused database/browser checks and inspect screenshots.
- [x] Compare with `/var/lib/puntos/releases/merchant-evidence-20261111/baseline.json`; build a scoped overlay over `puntos-api:reward-workspace-20261111` preserving 66 live migrations and existing grants/routes.
- [x] Deploy API and worker using the existing release process; verify health, browser assets, additive API behavior and logs.
- [x] Guarded sync only changed files to canonical source; verify 83 native baseline hashes unchanged; save release report.

## Release evidence

Deployed website/server on 11 November 2026. Server unit suite: 1,231 pass; merchant suite: 118 pass; focused measurement: 8 unit and 14 PostgreSQL pass. Customer progress: 5 isolated PostgreSQL checks including runtime role/RLS; budget regression: 17 PostgreSQL checks. Mobile/desktop light/dark browser checks and axe passed, including post-deployment demo; live customer progress was read with restricted production role in a read-only transaction. No live campaign exists to inspect; measured comparisons were verified against disposable PostgreSQL. Native 83-file baseline unchanged; no cloud native builds, provider messages, schema changes or test writes to production. Research ingestion is tracked separately.
