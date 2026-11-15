# Wallet Featured Actions Implementation Plan

> Execute scoped server and web tasks with the subagent-driven-development skill, then review and verify the integrated result. User authorization includes both slots and necessary website/server work; no further design approval is needed.

**Goal:** Deliver both Apple Wallet actions through valid signed passes and useful authenticated web destinations.

**Architecture:** Extend the existing Apple pass JSON and the existing login/account pages. Reuse passkit-generator, session/tenant checks and the normal pass-refresh worker. Fixed Spanish destinations are not authentication credentials.

**Tech Stack:** Node 24, passkit-generator 3.7.0, vanilla browser modules, node:test, Playwright, existing PostgreSQL pass revisions.

- [x] Confirm official action types/schema and installed-library support; isolate worktree; baseline 31 targeted tests pass.
- [x] Write failing signed-pass tests in `tests/unit/native-wallet-apple.test.js` for exactly two actions, order/types, business-specific URLs, unsafe/missing slug handling, older-iOS detail links, unchanged identity/QR and revoked suppression. Run `NODE_ENV=test node --test tests/unit/native-wallet-apple.test.js` to establish the expected failures.
- [x] Extend `src/app/services/native-wallet/apple.js`: `featuredActions: voided ? [] : [{identifier:'pf-offers',type:'viewOffersRewards',url:offersUrl},{identifier:'pf-benefits',type:'membershipBenefits',url:benefitsUrl}]`; construct URLs using a fixed origin and encoded validated public slug; retain old links. Re-run signed ZIP/signature and provider regressions.
- [x] Add fixed-destination browser navigation, business-checked login continuation and accessible one-time focus in `public/customer-auth-entry.js`, `public/customer/index.js` and a small browser helper. Extend existing auth-entry/lifecycle tests and add helper tests before production changes. Preserve normal entry flows, unknown-destination handling and background refresh behavior. Increment the service-worker asset version and include the helper.
- [x] Validate browser links at 390/1440 pixels with intercepted fictional APIs: matching session, signed-out verification, wrong business, both destinations, no active offers, unknown destination and repeated refresh. Inspect the rendered destination and focus. Run Impeccable's detector once over changed frontend files.
- [x] Review integrated diff for privacy, auth boundaries, revocation, old-client compatibility and unsupported UI claims. Run wallet/customer unit regressions, root unit suite, typecheck/lint and appropriate PWA checks.
- [x] Commit and push source; deploy API/worker/browser overlay from the current healthy images with environment guards and rollback selectors. Verify a production-signed fictional package without publishing or issuing a customer pass. Enqueue a one-time active-Apple content revision refresh through the existing worker, preserving leases/backoff and recording aggregate outcomes privately.
- [x] Record exact source/release hashes, test and live evidence, physical-device limits and GitHub PR. Do not launch native/cloud workflows or modify `apps/customer`.

## Verification evidence

- Root unit suite: 1,402 passed, no failures/skips. Full typecheck and ESLint passed.
- Wallet provider suite: 111 passed, including signed ZIP manifests and detached CMS signatures.
- Customer action suite: 66 focused tests passed; independent review caught and verified a blocked-logout recovery fix.
- Chromium: eight intercepted desktop/mobile scenarios at 1440/390 pixels; delayed offers/notebook rendering, below-header focus, repeat refresh, wrong-business verification, missing offers, missing tier and unknown destination.
- PWA integration: both offline-cache and service-worker-upgrade tests passed.
- Impeccable detector: no findings in the new navigation code; existing customer HTML advisories concern the intentionally hidden merchant-logo image and loading-placeholder dashes. Rendered checks showed no broken image or overflow.
- Physical iPhone rendering and Safari/Wallet handoff remain unverified; automated browser/package checks do not establish device behavior. No native files, dependencies or release versions changed.

## Deployment receipt

- Deployed source: `43ceea78dfaa31b282b2cc0ad2af509b5b1e9ff1` (later changes to this receipt are documentation only).
- API image: `puntos-api:wallet-actions-20261114-43ceea7`; worker: `puntos-worker:wallet-actions-20261114-43ceea7`. Both healthy; all ten changed runtime files match the committed source by SHA-256.
- A fictional pass signed by the configured production certificate contains both exact action URLs. All four manifest hashes and the detached CMS signature verified. No real customer pass was issued for this check.
- One active Apple pass revision queued through the existing worker, preserving backoff and leases; worker acknowledged it. Zero devices are registered for that pass, so this is not evidence of an APNs delivery or an iPhone display update.
- PF apex/www, support, app login shell, new navigation asset, `pf-v49` service worker and Pertenece returned HTTP 200. Existing healthy images and environment selectors retained for rollback. No migration required.
- Source pushed in [PR #6](https://github.com/traficogt/puntos/pull/6). Native app work and Codemagic remain untouched; main is not changed by this feature branch.
- Private release evidence: `/var/lib/puntos/releases/wallet-featured-actions-20261114/` (package/signature checks, runtime hashes, HTTP checks, browser screenshots, test logs and refresh aggregate).
