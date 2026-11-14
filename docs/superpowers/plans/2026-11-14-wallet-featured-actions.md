# Wallet Featured Actions Implementation Plan

> Execute scoped server and web tasks with the subagent-driven-development skill, then review and verify the integrated result. User authorization includes both slots and necessary website/server work; no further design approval is needed.

**Goal:** Deliver both Apple Wallet actions through valid signed passes and useful authenticated web destinations.

**Architecture:** Extend the existing Apple pass JSON and the existing login/account pages. Reuse passkit-generator, session/tenant checks and the normal pass-refresh worker. Fixed Spanish destinations are not authentication credentials.

**Tech Stack:** Node 24, passkit-generator 3.7.0, vanilla browser modules, node:test, Playwright, existing PostgreSQL pass revisions.

- [x] Confirm official action types/schema and installed-library support; isolate worktree; baseline 31 targeted tests pass.
- [ ] Write failing signed-pass tests in `tests/unit/native-wallet-apple.test.js` for exactly two actions, order/types, business-specific URLs, unsafe/missing slug handling, older-iOS detail links, unchanged identity/QR and revoked suppression. Run `NODE_ENV=test node --test tests/unit/native-wallet-apple.test.js` to establish the expected failures.
- [ ] Extend `src/app/services/native-wallet/apple.js`: `featuredActions: voided ? [] : [{identifier:'pf-offers',type:'viewOffersRewards',url:offersUrl},{identifier:'pf-benefits',type:'membershipBenefits',url:benefitsUrl}]`; construct URLs using a fixed origin and encoded validated public slug; retain old links. Re-run signed ZIP/signature and provider regressions.
- [ ] Add fixed-destination browser navigation, business-checked login continuation and accessible one-time focus in `public/customer-auth-entry.js`, `public/customer/index.js` and a small browser helper. Extend existing auth-entry/lifecycle tests and add helper tests before production changes. Preserve normal entry flows, unknown-destination handling and background refresh behavior. Increment the service-worker asset version and include the helper.
- [ ] Validate browser links at 390/1440 pixels with intercepted fictional APIs: matching session, signed-out verification, wrong business, both destinations, no active offers, unknown destination and repeated refresh. Inspect the rendered destination and focus. Run Impeccable's detector once over changed frontend files.
- [ ] Review integrated diff for privacy, auth boundaries, revocation, old-client compatibility and unsupported UI claims. Run wallet/customer unit regressions, root unit suite, typecheck/lint and appropriate PWA checks.
- [ ] Commit and push source; deploy API/worker/browser overlay from the current healthy images with environment guards and rollback selectors. Verify a production-signed fictional package without publishing or issuing a customer pass. Enqueue a one-time active-Apple content revision refresh through the existing worker, preserving leases/backoff and recording aggregate outcomes privately.
- [ ] Record exact source/release hashes, test and live evidence, physical-device limits and GitHub PR. Do not launch native/cloud workflows or modify `apps/customer`.
