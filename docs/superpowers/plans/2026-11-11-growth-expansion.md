# Eight-part merchant growth expansion

User explicitly approved implementation of roadmap items 1–8. Extend the existing website/server, preserving installed native APIs and all `apps/customer` sources. No native/cloud builds or automatic merchant messages. Keep the existing fonts and Mantine interface. Use the established Express/Zod/PostgreSQL services, ledger, durable queues, audit and tenant permissions.

## Scope and architecture

1. Reward promise: snapshot customer progress/earned terms before changes; original entitlements remain redeemable after a program edit. Provide controlled availability and preapproved alternatives. Historical evidence that was not recorded stays unknown; never fabricate earlier promises. Preserve completed-redemption history and stock/cost accounting.
2. Hospitality: owner-configured approved gestures; staff authorizations bounded per action, total, branch and time. Issue an individual entitlement with immutable terms and redemption history. No unrestricted points issuance or unlogged free-text giveaways. Stable request identities, atomic budgets and exactly-once fulfillment.
3. Second visit: disabled-by-default guided automation after a first recorded purchase. A bounded time-limited reason to return, explicit consent/contact constraints, budget and return-rate denominator. Imported opening balances are not visits. Avoid speculative lost-customer messages on incomplete data.
4. Quiet hours: owner preapproves a short-lived capped offer and relevant audience; activate explicitly during a slow period. Automatic expiry; honor existing entitlements. Reuse campaign ledger/queues/eligibility; distinguish short promotions from controlled experiments.
5. Campaign preview: before activation show stacking policy and maximum legitimate incentive, audience/contact exclusions, data freshness, required cost assumptions, availability where a reward is involved, and maximum commitment. Block actual contradictions; label unsupported cross-channel or external discounts unknown. Server revalidates activation.
6. Weekly owner brief: disabled-by-default schedule and owner destination; three actionable evidence-backed findings with authenticated deep links, persistent delivery status and retry handling. No unauthenticated mutation links. Preparing a sample never sends it; no real sends during development.
7. Odoo connector: installable module for explicitly documented supported versions, transactional outbound queue, paid-sale/refund normalization, stable source/receipt IDs, signed PF API delivery, diagnostics, retry/backoff, secret-safe settings and operator documentation. No claim of installation against an unavailable merchant instance; use local fixtures/contract tests and an isolated Odoo environment when practical.
8. Scale/regionalization: bounded queued imports up to thousands, resumable progress and idempotent chunks; queued large campaign audience preparation. Keep existing small synchronous API contracts. Business timezone/currency/country settings with explicit single settlement currency per merchant, immutable monetary denomination after ledger use, no implicit FX conversions, correct validation/formatting and safe legacy defaults. Document supported regions/adapters and any native channel restriction rather than mislabel money.

## Ownership and contracts

- `reward_promise_hospitality`: items 1–2. Own new reward-promise/hospitality services, routes, migrations, merchant/customer/staff components and tests. Own existing staff-service, staff-delegation service/routes/UI as needed; coordinate existing point award writer hooks with root before editing. Do not edit shared route registry/nav/grants/checksum/worker.
- `campaign_expansion`: items 4–5 and campaign portion of 8. Own growth-campaign-service/routes, customer-audience-service snapshot bounds, targeted-offer-service integration, new quiet/preflight/bulk-campaign services, GrowthCampaigns and isolated new screens/demo/tests. Root owns customer import jobs and regional helper; agree on handler contract for existing job queue. No shared registry/nav/grants/checksums/worker edits.
- `odoo_connector`: item 7. Own only `integrations/odoo`, connector packaging/download route/module, POS installation UI/docs/tests as agreed. Research official Odoo sources. No changes to deployed API contracts, native projects or credentials. After completion a separate agent implements items 3/6.
- Root: item 8 regional defaults/currency/timezone primitives and queued customer imports; integrate shared routes, navigation, grants, checksums and queue handlers. Later assign items 3/6 to a separate worker after a slot opens.
- Regional helper contract to be finalized after inspection, shared before other workers adopt it. Do not hard-code new GTQ-only assumptions into new feature code.
- Use dedicated disposable databases. Production has 54 migrations; source has 61 with seven unpublished order/contact changes. Preserve runtime exclusions. Baseline guarded overlay release: `/var/lib/puntos/releases/merchant-growth-expansion-20261111`, prior live tag `merchant-service-operations-20261111`.

## Verification and release checklist

- [x] Record exact per-domain API/table/UI contracts and implementation decisions.
- [x] Failing tests then working 1/2, including preserved terms, concurrency, budgets, idempotency, audit rollback, tenant/branch restrictions and immutable costs.
- [x] Failing tests then working 3/6, including consent/frequency, second-purchase races, expiry, budgets, DST/timezone schedule, owner-only destination and lost provider acknowledgements.
- [x] Failing tests then working 4/5/large campaigns, including stale previews, capped issuance/claims, collision semantics, concurrent activations and worker restart.
- [x] Connector code/contract tests, install package, version constraints, secrets/ACLs, duplicate sales, refunds, disconnection and safe diagnostic outputs.
- [x] Queued import tests: large-file validation, cross-batch duplicates, signup races, chunk crash/replay, cancellation with explicit partial progress, deletion/tenant guards and opening-ledger reconciliation.
- [x] Regional tests: defaults, allowed ISO currencies/timezones, precision/mismatch refusal, immutable denomination, reports and messaging using correct units, legacy API compatibility.
- [x] Independent spec and quality review; resolve material findings.
- [x] Full lint/typecheck/unit/web tests; focused real PostgreSQL and restricted-role fresh full-schema smoke.
- [x] Desktop/mobile/light/dark critical-flow, accessibility, error and retry tests; inspect screenshots.
- [x] Refresh migration locks and release manifests; confirm all native source hashes unchanged.
- [x] Verified backup; additive schema/grants; pinned API/worker overlays; live demo/health/private endpoints; persist selectors and synchronize only baseline-guarded changes.
