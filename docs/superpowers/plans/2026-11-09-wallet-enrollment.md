# Wallet enrollment completion

**Goal:** Let a customer save a Wallet card directly after PF phone verification, and reuse an active PF session for the same business.

**Accepted design:** Business QR links keep using `/registro/:slug`. PF creates the account through its existing verified-phone service; Apple and Google are card destinations, not identity providers. A focused completion step offers enabled Wallet providers and a permanent link to the PF web card. Existing account login uses the same completion step. Keep the current fonts, tenant branding, and accessible light/dark themes.

**Boundaries:** Messaging is in another VM and the user explicitly deferred wiring it. Google credentials/approval and real-device acceptance remain external requirements. No native app, auth bypass, production test accounts or transactions. Preserve the dirty checkout and deploy only an overlay on the current production image; no commits.

## Implementation

- [x] Extend `tests/unit/customer-auth-entry-behavior.test.js` with verified handoff, same-business resume, wrong-business rejection, failed verification, storage restrictions and session invalidation tests; run the tests and observe failures before implementation.
- [x] Update `public/customer-auth-entry.js`: retain existing verification and cache clearing, remove timed redirect, validate the authenticated `/api/customer/me` identity, then render `public/customer/native-wallet.js` in the completion panel. Guard async UI with the customer epoch and active page state. Status failure keeps the web-card fallback available; explicit retry rechecks the session.
- [x] Update `public/join.html` and `public/ingresar.html`: sequential forms, phone/name then code, keyboard submit, progress and focus, Wallet completion buttons, retry, and web-card link. Add scoped `public/styles/wallet-enrollment.css`; preserve existing IDs used by branding.
- [x] Bump `public/sw.js` and include the new stylesheet. Keep API responses and issue URLs out of persistent caches.
- [x] Run mocked browser flows against a local static server at mobile and desktop sizes. Check new/returning customers, unavailable providers, verification and Wallet errors, offline/reconnect, code resend/edit, no overflow, keyboard focus, theme and page errors. No real messages or memberships.
- [x] Review any independently confirmed protocol gaps, test first and fix narrowly.
- [x] Run unit tests, typecheck and lint. Update setup/acceptance documentation with exact completed work and external dependencies.
- [x] Build a scoped overlay on current production, verify it before deployment, retain rollback, deploy authorized changes and check public health/assets and both providers' local readiness without printing secrets.

## Acceptance

The first Wallet save uses an explicit customer gesture after a verified PF session. Existing session must match the business. No duplicate account creation on save/retry, no automatic navigation, no claim that a provider saved a card merely because issuance returned a URL. A customer may always proceed to the PF web card. Google remains hidden until configured. Messaging and actual device validation remain honestly marked pending.

## Release evidence

Deployed `wallet-enrollment-20261109`; 765 unit tests, 12 browser scenarios, 95 exact-image tests, lint/typecheck and eight public HTTPS checks pass. API and worker are healthy. All nine scoped deployed files match the manifest. Apple is enabled; Google remains disabled. Physical-device acceptance, Google account activation and the explicitly deferred messaging VM connection remain external prerequisites.
