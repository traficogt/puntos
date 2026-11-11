# Wallet and installed-app data refresh implementation plan

Use superpowers:subagent-driven-development for the mobile compatibility task and independent reviews. Parent handles Wallet content and release. Specification: ../specs/2026-11-11-wallet-server-refresh.md.

Goal: apply updates that the existing Wallet passes and installed app contracts can receive without any native build.

- [x] Mobile API regression: protected choice data wins over edited catalog, unavailable choices are excluded without falsifying stock, tenant/plan checks and existing response fields hold. Implement a narrow adapter around getCustomerRewardProgress and use it in /mobile/customer. Add optional reward_progress separately.
- [x] Existing native push classifier: use authoritative customer reward eligibility before announcing an unlocked reward; keep generic card update if none qualify. Test unavailable/protected/foreign outcomes with provider doubles and no actual sends.
- [x] Wallet model tests: business currency fallback for old protected terms, merchant-local expiry text, pending/connection explanation, revoked stripping. Implement only in engagement and provider payload modules.
- [x] Run full unit, focused PostgreSQL and mobile contract tests; verify signed Apple ZIP and Google payloads with fixtures. Confirm lint/typecheck and no native/dependency diffs. Independent spec then correctness review.
- [x] Release a small overlay over puntos-api:reporting-actions-20261111. Read-only production smoke checks confirm current tables/contracts/RLS. Save rollback selectors; deploy API and worker; verify health.
- [x] Enqueue exactly one content refresh for current active pass IDs, preserving leases/backoff and identity. Record revisions and poll aggregate delivery status through the existing worker. Never equate acknowledgement with phone display.
- [x] Save review/test/release evidence, sync only scoped source hashes, remove own test container and report what changed versus what needs a later native/device check.

## Release evidence

Deployed 11 November 2026: six server files over the reporting-actions image. Existing installed apps receive protected reward details and authoritative availability through their existing API; timestamp formatting stays compatible. Their push classifier uses the same eligibility. Wallet passes add merchant-local expiry and pending/offline-use text, with correct currency fallback for older protected cycles. New native screens and richer additive progress presentation remain for a deliberate future app release.

Validation: 1,259 root unit tests; focused mobile unit/PostgreSQL 41/41 and Wallet PostgreSQL 24/24; Wallet payload/unit 118/118; lint and typecheck. Independent spec and correctness reviews approved. Read-only candidate/live checks used the restricted application role and confirmed tenant isolation. Private queue regression verified revision trigger handling, retry/lease preservation, revoked/newer revision exclusion, rerun idempotence, unchanged balances and rollback.

Two existing active passes refreshed through the ordinary worker. Google update acknowledged; Apple worker acknowledged the revision with no registered device, so no iPhone delivery claim. Actual phone display remains unverified. No native files, native dependencies, binaries, OTA updates or cloud-native workflows changed; all 83 native files verified unchanged. Runtime remains at 66 migrations; unpublished order/contact routes remain excluded. No manual native push, marketing broadcast or production test account/ledger writes. Articles remain deferred. Evidence: /var/lib/puntos/releases/wallet-server-refresh-20261111.
