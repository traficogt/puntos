# Customer app implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development for independent backend work and review. Preserve the user's existing work. The later user request authorizes committing and pushing the app/Xcode Cloud branch to PF's repository; do not publish to app stores.

**Goal:** Deliver a runnable iOS/Android customer app using PF accounts, plus a clearly marked browser preview and verified native API foundation.

**Architecture:** A separately installed Expo/TypeScript package in `apps/customer` calls scoped `/api/mobile` routes. Server-managed opaque sessions remain authoritative; native credentials use SecureStore, while browser preview credentials stay in memory. Account cache is minimal, business-scoped, cleared on logout, and never supplies an expired QR or a redemption authorization.

**Tech stack:** Expo SDK 57, React Native, Expo Router, TypeScript, existing Express/PostgreSQL services, Node test runner, Playwright for browser-preview acceptance. Physical native acceptance is a separate, explicitly reported gate.

## 1. Isolated workspace and contracts

- [x] Create ignored `.worktrees/customer-app`, copying the current tracked/unignored source state without credentials. Reuse root dependencies without modifying them.
- [x] Create `apps/customer` with `npx create-expo-app@5 --template blank-typescript@sdk-57 --no-install --yes`, then install its independent dependencies.
- [x] Record public business, verification, snapshot, QR, logout and Wallet endpoint contracts in `apps/customer/README.md`.

## 2. Native API adapter

Files: `src/app/routes/mobile-routes.js`, `src/app/services/mobile-customer-service.js`, `tests/unit/mobile-routes.test.js`; mount with two lines in `src/app/routes/index.js`.

- [x] Write and run failing route tests: missing bearer/cookie-only requests rejected; expired/staff sessions rejected; verified phone returns opaque customer session without cookie; business scope comes only from session; logout revokes; deleted customer rejected; QR expiry and snapshot shape preserved.
- [x] Implement factory-injected dependencies, existing verification schemas/phone normalization/rate limits, private no-store responses, server session lookup/expiry/touch/revocation, tenant context and existing customer/reward/history/Wallet services. Never bypass existing OTP or browser protections.
- [x] Expose `GET /mobile/business/:slug`, `POST /mobile/business/:slug/:mode/request-code`, `POST /mobile/business/:slug/:mode/verify` (`mode=login|join`), `GET /mobile/customer`, `POST /mobile/customer/qr`, `POST /mobile/customer/logout`, Google Wallet save and Apple authenticated download. Scope account deletion to authenticated identity and revoke all sessions.
- [x] Run `NODE_ENV=test node --test tests/unit/mobile-routes.test.js` and root lint/typecheck on affected files. Review spec compliance before quality/security review.

## 3. App data/session layer

Files: `apps/customer/src/api.ts`, `model.ts`, `session.ts`, `storage.ts`, `demo.ts`, `tests/*.test.ts`.

- [x] Test business link allowlist, API origin validation, network/error mapping, cache identity validation, stale-request rejection after signout, session persistence failures, expired QR rejection and no offline mutation queue.
- [x] Implement bounded HTTP timeouts and bearer transport with credentials omitted. Persist the session only in native secure storage. Cache only matching account snapshots with timestamp, never verification codes, bearer tokens or QR payloads in ordinary storage. Clear cache and invalidate in-flight work on account changes.
- [x] Provide explicit sample data separate from real API responses and never display a scannable demo membership QR.

## 4. Native screens

Files: `apps/customer/App.tsx`, `src/theme.ts`, `src/components.tsx`, `src/screens/*.tsx`, local font/logo assets, `app.json`, `eas.json`.

- [x] Build business entry, sequential phone/code sign-in and registration with resend delay, keyboard-safe forms, accessible labels and recoverable errors.
- [x] Build Card, Rewards, Activity and Account tabs using Expo Router, safe areas, Spanish copy, PF fonts and light/dark themes. Apply validated business branding.
- [x] Card displays points and live short-lived QR with expiry/reconnect behavior. Rewards distinguish available/locked states and direct redemption to staff; activity shows actual records; account includes support, theme, signout and deletion confirmation.
- [x] Google opens only validated Google save URLs. Apple opens the existing PF web card in Safari, with explicit browser-sign-in copy; native PassKit handoff is deferred as a separate improvement.
- [x] Honor offline state, AppState foreground refresh and account-generation checks. Native hardware Back follows navigation. Store metadata/build profiles contain no provider secrets.

## 5. Verification and delivery

- [x] Run app unit tests, strict TypeScript, Expo dependency doctor and iOS/Android/web JavaScript exports. Review first the approved spec, then code quality; fix substantive findings.
- [x] Test the exported browser preview at narrow/wide phone widths, light/dark, scaled type, sample tabs, mocked real API sign-in, session failure/offline/logout and QR expiration. Record browser evidence without claiming simulator/device validation.
- [x] Integrate only new app files and the targeted backend mount into the main workspace. Build a scoped overlay from the live API image; do not deploy the dirty checkout wholesale. Use disposable verification infrastructure where needed, preserve production credentials, and record rollback.
- [x] Publish a sample preview only after tests pass; verify production health, unauthorized API behavior, public test-business lookup and preview assets. Do not create customer transactions or test accounts.
- [x] Document commands, known messaging/Google/device gates, source paths and results. No App Store submission or production-native release in this first slice.

## Added scope: Xcode Cloud

- [x] Generate and validate a checked-in iOS workspace, shared scheme, automatic signing/team settings, and reproducible config plugin.
- [x] Add Node bootstrap, npm checks, and CocoaPods setup in the post-clone script; document first Mac setup and native-build limitations.
- [x] Commit and push app/Xcode Cloud/Codemagic source and preview test helpers to `feat/xcode-cloud-20261110` in `traficogt/puntos`. Published commit `75550d84c325e45ca7722c947a0cedf629d73fe3` is one scoped commit over origin/main. GitHub reauthorized successfully.
- [x] Compile on Codemagic's hosted Mac, collect the simulator app and native lockfile, and commit Podfile.lock in published commit `211a0ffcaf58633ba70b0234f390e041badb8306`.
- [ ] Activate the first Apple Xcode Cloud workflow if that alternative is selected. Codemagic is the current build service.
- [x] Produce a signed iPhone archive and upload it to App Store Connect. Codemagic build `6af2a2423e77cfd64c93c207` succeeded with version 0.1.0 (1).
- [x] Confirm Apple processing: build 0.1.0 (1) is VALID and READY_FOR_BETA_TESTING for internal TestFlight. Requested owner invitation is sent and verified; device acceptance remains outstanding.

## Verification / delivery evidence

- Clean standalone app install: npm ci, lint, TypeScript, native configuration validation, 35 unit tests pass.
- Browser fixtures: 5/5 scenarios across 320/390/430/1024 widths and light/dark; includes OTP, offline/stale recovery, QR and session expiry; 30 screenshots reviewed.
- iOS/Android/web JS/Hermes exports pass. Expo Doctor 20/20 applicable checks; native-config sync advisory intentionally disabled because project is committed and regenerated explicitly.
- Codemagic root YAML validated against official schema plus shell syntax. Two simulator builds compiled successfully; build `6af290d868cf3c59a27a88e1` also produced both expected artifacts.
- Xcode Cloud artifacts prepared; first Apple-managed workflow not activated. Codemagic provides the current hosted Mac path.
- Latest npm audit: 11 moderate transitive build/lint-tool findings; no high or critical. Query-string compatibility fixed while retaining patched decoder 0.5.1.

## Live delivery (2026-11-10)

- Preview deployed at https://app.puntosfieles.com/app-preview/. Scoped API/worker release customer-app-20261110 healthy; no root checkout rebuild or database migration.
- API image `57ede7c8f164b13e8578d56fceea437693ace88a3c953ef4ea45a59d9c586e9d`; worker `d47762bf7bf8927cda754425ca3bb03cb3d2f18655891d776a07b6dcd4db1066`.
- 41 focused integrated backend tests, root TypeScript/lint, public test-cafe lookups, cookie-free unauthorized responses, 28 static assets and browser demo rendering verified.
- WAHA and Evolution keys configured in protected files; default provider order waha,smtp_email; no real message sent; sending phone remains disconnected.
- First real iOS native simulator build `6af28de8ae57ef123d1bd8cd` passed. Artifact collection was empty; absolute-path correction pushed in `a64309645308eeb9453713e6a3387401bc0e4408`; second build `6af290d868cf3c59a27a88e1` passed and produced the simulator ZIP and build-log archive. Both artifacts are preserved in the protected release directory. Native lockfile contains 181 pods and matches the checked-in Podfile.
- Apple key8TL7UU92UP validated, bundle com.puntosfieles.customer registered, user created App Store app6832824995. Codemagic app-scoped encrypted signing variables and numeric app ID configured; signed TestFlight workflow finalized.
- Signed build `6af292453c26820c61d57426` failed before archive creation with Apple's distribution-certificate limit (HTTP 409). The generated PF distribution key does not match existing certificates. No IPA or TestFlight upload exists. Local PF credential directories and the authorized share contain no reusable distribution key; user asked for the existing Trafico/Garita signing key location. Existing certificates were not revoked.
- User does not know the existing signing-key location. Read-only Codemagic checks found encrypted `CERTIFICATE_PRIVATE_KEY` variables in Trafico's `trafico_appstore_signing` and Garita's `garita_native` app groups. Their values are not readable or transferable through the documented API; no global group was available through the account's API. Recover a saved key from the relevant app setup and verify its certificate match before configuring PF. Do not expose secrets through logs or build artifacts. Signing status documentation pushed in `e1475ca`.
- Signing blocker resolved without another user credential: Codemagic's documented iOS-specific certificate option allowed Apple to issue `IOS_DISTRIBUTION` certificate `P249MB7K2B` for PF's existing private key (HTTP 201, public key match verified, expiry 2027-11-10). Both prior distribution certificates remain intact. Protected signing manifest saved outside the repository. Second signed build `6af2a2423e77cfd64c93c207` submitted from PF's own source branch; waiting for archive/upload results. No secret was extracted from another app or published to the shared folder.
- Second signed build passed every stage and uploaded successfully to Apple (delivery `ec729a16-9b2a-4ea0-8c30-6b21b8ec0b6b`). IPA and logs archived under the protected release directory; size/hash recorded. Package verified as com.puntosfieles.customer, version 0.1.0 (1), minimum iOS 16.4, with distribution entitlements, matching embedded profile, and code-signature resources. PF provisioning profile `XRD9M43797` was also backed up and verified. Apple processing/Codemagic post-processing remain pending.
- Apple processing completed: build `ec729a16-9b2a-4ea0-8c30-6b21b8ec0b6b` is VALID, internalBuildState READY_FOR_BETA_TESTING, externalBuildState NOT_APPLICABLE. Codemagic's optional post-processing tried external beta review and failed for absent review contacts. Corrected `submit_to_testflight` to false (it controls external review, not upload); internal-only export and public-store submission=false remain. The accepted binary remains usable for internal testing; no tester invitation or public submission was sent.
- Corrected publishing configuration and verified signing documentation passed official Codemagic schema, shell syntax, internal-only configuration assertions, and scoped diff checks; pushed to PF's source branch as `0a8e47d`. No app-code change or recompilation was required for this publishing-setting correction.
- User pasted Google's JSON-validator sample. Prepared `docs/wallet/google-wallet-validator-demo.json` with PF's existing service-account identity, issuer, and verified existing Test Café class. Validated the demo object against Google's current Discovery schema plus JWT envelope checks. Its QR is explicitly non-redeemable; no demo pass or customer record was created.
- At the user's explicit request, created internal group `PF Internal` (`038c43cb-b636-4f0b-85af-4f013b77d216`), assigned accepted build 0.1.0 (1), and invited the specified owner address. Apple verified membership and state `INVITED`. Tester IDs are app-specific: associating the other app's tester ID returned 409; creating the PF association by the same authorized email succeeded with tester ID `10b82c21-887d-45da-bb2a-a0eea1675490`. Existing other-app memberships were preserved. Protected manifest records the recipient and verification time; no duplicate resend was issued.
- User supplied APNs key `9FDM3HC9ZW` through the shared folder. Downloaded it to protected operator storage (0600), verified EC P-256 and a local ES256 signature, and saved a separate push manifest. Enabled PUSH_NOTIFICATIONS for com.puntosfieles.customer and generated active App Store profile `LNXMZJ2353` with production APNs entitlement and the existing PF signing certificate. Previous profile became invalid for future signing; no certificate was revoked. Credentials/account setup are prepared; app notification permissions, device registration, backend delivery, a new TestFlight build, and device acceptance are not yet implemented or verified. No test push was sent.
