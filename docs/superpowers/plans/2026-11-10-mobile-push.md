# Native iPhone Notifications Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for the independent backend task and spec/quality reviews. Work in isolated source trees; do not stage unrelated existing changes.

**Goal:** Deliver opt-in points/reward push notifications, revoke them reliably on account changes, and ship an updated internal TestFlight build.

**Architecture:** Native Expo notifications register a production APNs device through PF's authenticated mobile API. A per-installation secret authorizes only revocation after logout. A tenant-isolated durable worker sends generic alerts from confirmed balance changes using the existing server-only Apple key.

**Tech Stack:** Expo SDK 57, expo-notifications/crypto/device as needed via expo install, Node HTTP/2/crypto, PostgreSQL/RLS, existing session and worker infrastructure, Codemagic/Xcode 26.6.

## 1. Backend and contract

Worktree `/opt/puntos/.worktrees/mobile-push-backend`, seeded with current source and no credentials. Root dependencies are a read-only reused symlink. Preserve originals under `/var/lib/puntos/releases/mobile-push-20261110/source-before`.

- [x] Add `src/app/services/mobile-push/{apns,config,service,runtime}.js`, `src/app/repositories/mobile-push-repository.js`, and additive `src/app/migrations/2026-11-10-mobile-push.sql`. Wire the exact API contract in the spec into the mobile route factory and worker interval. Extend migration checksum/role grants and document non-secret environment names.
- [x] Write failing APNs and service/route tests for malformed configuration and ownership; registration baseline; reward threshold/plan/stock/expiry; explicit session revocation/deleted customer; retry/invalid-token behavior; no token/secret output. Implement and run focused tests plus root lint/typecheck.
- [x] Verify actual SQL in a named disposable database: cross-tenant/installation takeover rejected, balance triggers, two-worker claims, expiry/revocation, and stale lease acknowledgements. Never use production for fixtures.

## 2. Native app

Worktree `/opt/puntos/.worktrees/customer-app`, scope `apps/customer` only. Read Expo v57 notifications docs before changing APIs and use Impeccable's established native settings style.

- [x] Install compatible native modules with `npx expo install`; add config plugin and regenerate iOS project. Preserve the existing Xcode Cloud config plugin and dependency compatibility patch. Update native CocoaPods lockfile on the hosted Mac when required.
- [x] Add a testable notification controller and native/web adapters. Implement secure installation credential storage, per-account opt-in, serialized registration/revoke, generation guards, pending offline revoke, token refresh, foreground reconciliation, and safe notification routing. Integrate with session state after restore completes.
- [x] Add the Account notification section, permission explanation, recovery/settings action, opt-out and explicit test action. Hide it for unsupported platforms/demo. Preserve theme/fonts/accessibility and error states.
- [x] Run meaningful controller tests (deferred promises for stale account changes and offline revocation), app lint/typecheck/unit tests, Expo doctor, web export and browser fixtures/screenshots. Validate generated entitlements and Xcode config.

## 3. Review and scoped rollout

- [x] Obtain spec review, then quality review; resolve substantive findings before publication.
- [x] Back up production DB/runtime config, build scoped overlay API/worker images from the currently running release, add protected APNs runtime mount, apply the additive migration and runtime grants, and deploy with a documented rollback. Verify health, unauthenticated mobile rejection, existing Wallet routes and the new configuration endpoint using authorized test fixtures only.
- [x] Commit only app/cloud changes and clean backend artifacts where independently publishable. Cherry-pick app commits into `/opt/puntos/.worktrees/ios-cloud-publish` and push PF's existing `feat/xcode-cloud-20261110` branch. Preserve unrelated backend working state.
- [x] Start Codemagic internal signed build, resolve native compile/export errors, verify the IPA's APNs production entitlement, and wait for Apple processing. Assign the new accepted build to the existing PF Internal group. Record actual delivery status; ask the user only for the final phone action if required.

## Release result

Completed November 10, 2026. Scoped API/worker release deployed and healthy; source integrated without overwriting unrelated work. The first migration attempt used the container's runtime role and rolled back before schema changes; smoke checks restored the prior images. The corrected deployment uses the configured migration role and verifies the applied checksum before service restarts. Final migration SHA-256 is `35d04d891b2197fb9e3d5e4ae8074fc306acbc63b438e5e0b95fe592be815875`.

The lockfile resolver and signed Codemagic build succeeded. Apple accepted 0.1.0 (2), with production APNs entitlements verified from the signed executable; build `d3cb0160-15c9-4861-a39b-7fc68cbc5f59` is assigned to the existing PF Internal group. Source, test evidence, release images and rollback are documented in `/var/lib/puntos/releases/mobile-push-20261110`.

- [ ] Physical-device acceptance: the user updates TestFlight, signs in, opts in and sends the explicit test notification. No registered device or APNs delivery was manufactured.
