# Wallet QR access and official badge

**Goal:** Make the business signup QR retrievable from the owner dashboard and show Apple's official Wallet badge on the homepage and customer save controls.

**Scope:** Existing business-specific PF enrollment and signed-pass flow remain intact. No SMS/WhatsApp configuration, Google activation, native app, real test members or ledger transactions. Preserve fonts and current designs. Apple artwork is taken unchanged from the official Spanish (Mexico) SVG package. The homepage link opens the existing customer card and explains the prerequisite signup; it does not issue a generic pass.

- [x] Verify current QR/link access and Apple's current badge guidelines and obtain official SVG.
- [x] Add homepage Wallet explanation, official badge, accurate signup-versus-member QR FAQ and trademark credit; use same badge on customer save controls.
- [x] Add owner-scoped registration URL/QR endpoints, existing Branding invitation panel, copy fallback and SVG download; preserve tenant/session guards.
- [x] Verify meaningful backend/UI tests, mobile/desktop renders, unchanged homepage interactions and customer save flow.
- [x] Deploy only scoped files over the current live API image, retain rollback and verify public health/assets and authenticated endpoint boundaries.

**Files:** Homepage HTML/CSS; customer HTML, join/login HTML and native-wallet CSS; official SVG; admin dashboard stylesheet inclusion and service worker; owner invitation route in `admin/branding-routes.js`, module in `admin-dashboard/modules/customer-enrollment.js`, Branding module/fragment and dedicated CSS. Tests owned by the invitation module cover auth scope, canonical URLs, QR output, clipboard fallback, failures and stale session responses.

**Verification:** 777 unit tests, 12 enrollment browser scenarios (13 node:test entries), four marketing browser tests, 43 focused tests in the exact production image, typecheck and lint passed. Mobile/desktop homepage and invitation renders reviewed; copy, SVG download and error/retry checked with isolated browser fixtures.

**Release:** `wallet-access-20261109`, deployed November 10 UTC. Fourteen runtime files over the previous live API image; worker unchanged. Manifest hashes match the source, package and image. All 11 public checks passed, including authenticated invitation boundaries, official badge hash and service-worker cache v39. API/worker healthy; Apple locally ready. Evidence and rollback: `/var/lib/puntos/releases/wallet-access-20261109`.
