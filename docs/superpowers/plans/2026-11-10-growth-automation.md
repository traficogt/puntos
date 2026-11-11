# Targeted loyalty campaigns, dependable messaging and branded QRs

> Execute with subagent-driven-development, independent specification review followed by quality review. User explicitly authorized proposals 1, 2 and 4 and branded higher-tier QRs; prior parallel-work preference continues. Default implementation choices are resolved here without another approval cycle.

**Goal:** Enable an owner to offer a bounded incentive to a selected customer audience, communicate with consenting members, and compare results with a randomized holdout; offer branded enrollment QR downloads on Negocio/Empresa.

**Architecture:** Additive PostgreSQL tables with tenant RLS; existing authenticated Express APIs, ledger transactions, message adapters and worker scheduling; React/Mantine website UI. Preserve all installed-app API contracts, browser Spanish slugs, fonts and existing commerce behavior. No native builds, external test messages, fabricated delivery receipts, automatic enrollment in marketing, or real customer campaign creation during development.

**Tech:** Existing pg transactions, zod, node-cron, message router/providers, qrcode, Mantine/React. Extend existing infrastructure instead of a second application framework.

## Offers and measurement

- [ ] Add `growth_campaigns` and `growth_campaign_members` with composite tenant keys/RLS. Draft created from an existing recovery list (max200 current active customers) with name, integer bonus_points (1..10000), minimum_purchase_q (0..999999.99), duration_days (7/14/30), holdout_percent (10/20/30 default20), optional estimated_cost_per_point_q (0..100). Idempotent request UUID. No client tenant, timestamps, allocations or earned-point totals.
- [ ] Explicit owner activation freezes active customer membership and random assignment (cryptographic random ordering, fixed holdout count, stored assignment). At least10 members required for comparison; no activation with empty/single customer group. Activated terms immutable. Start at server time; expiration fixed. Owner pause prevents new grants/messages but preserves measurement. Show sample-size limitations.
- [ ] One fixed point bonus per assigned treatment customer, only on a genuine paid qualifying purchase during the active server-time window; no stacking of targeted offers (choose earliest expiration/id consistently). Control members get ordinary program benefits. Transactional locking/unique claim binds usage to the original transaction. Duplicate event/receipt does not consume twice. Include bonus in that purchase's existing ledger points, status/pending balance and response; reversal follows existing ledger reversal of the purchase; consumed offers are not reissued after refund. Do not trust offline client time to backdate an expired offer.
- [ ] Integrate hook in staff online/offline and external/POS transaction writers. Preserve undeployed workspace-only order routes; provide compatible hook for order service only if safely testable without publishing those routes. Legacy behavior untouched without an activated targeted-offer flag. Activation changes program_json atomically, preserving existing rules. Plan enforcement follows existing campaign_rules and analytics entitlements.
- [ ] Customer GET active offers (authenticated tenant-only) for browser display. No native-source edits.
- [ ] Owner API `/api/admin/growth-campaigns`: GET list, POST draft, GET/:id detail+results, POST/:id/activate, POST/:id/pause. Staff+OWNER+tenant+campaign_rules; measurement additionallyanalytics. MutationsCSRF, strictvalidation/no-store. Responses clear status/dates/terms/allocation counts and observed metrics.
- [ ] Results compare all allocated treatment/control customers (intention to treat) over the same campaign window, qualifying purchase/refund definition consistent with ledger, including customers who did not buy (zero outcomes). Report group size, returning customers/rate, recorded sales, average sales/member, estimated incremental sales (difference of means times treatmentN), awarded bonus points and optional estimated bonus cost. No claiming ROI/profit or proven significance. Small samples flagged; costs are owner-supplied estimates, not redemption accounting.
- [ ] PostgreSQL tests: RLS/tenant/deletion, allocation stability, activation replay, concurrent purchases, budget/one-time usage, dates/minimum, pending and reversal, cross-writer idempotency, cohorts with zero outcomes.

## Messaging and preferences

- [ ] Marketing preferences explicit per customer/business, defaultoptedout, authenticated optin/out and token-based unsubscribe with POST confirmation (GET never changesstate). Expose Spanish customer preference page with safe same-origin requests and actualcurrentchoice; no assumption loyalty enrollment equals messaging consent.
- [ ] Campaign outbox keyed uniquely by campaign/customer, only treatment+optedin active members; queues created by explicitownerrequest. Do not send on draftcreation/activation alone. Recheck consent/deletion/plan/expiry/pause and frequency caps at dispatch. No holdout recipients.
- [ ] Persist queued,processing,accepted,failed,uncertain,suppressed states. Provider acceptance is not device delivery. No fake delivered state. Bounded retries only for definite failures; ambiguous network acceptance/crash becomes uncertain and is not automatically resent. Preserve provider/log identifiers and safe error summaries; prevent concurrent duplicate processing. Use existing worker/adapter infrastructure; dev transport must not count as live delivery.
- [ ] Existing lifecycle/churn marketing respects preferences. Fix lifecycle `sent` count on failure; transactional verification/security messages remain compatible. Make marketing failure visible without exposing secrets.
- [ ] Owner campaign message preview/counts and explicit queue endpoint; confirmation before queueing. Backend can be wired without sending any real messages in this task. Exact provider receipt support reported honestly.
- [ ] Unit and PG tests for optin/out, cancellation, caps, retry/uncertain, atomicclaims/replays, acceptedvsdelivered, worker lease recovery, tenant isolation. Mock providers only.

## Branded QRs

- [ ] New `branded_qr` feature falseEmprendedor,trueNegocio/Empresa, existing override mechanism. Download branded SVG/print asset via owner/tenant/plan-protected endpoint using business name/color/logo safely. Keep QR modules, quiet zone and contrast scannable; no QR advertising/redirect service dependency.
- [ ] Existing plain QR remains compatible for everyplan. Do not modify signed customer/POS QR credentials or businessslug identities. Logo must be safe and downloadable without external dependencies; if existing logo cannot be safely embedded, render business name/color and explain the logo limitation. No arbitraryserverfetch.
- [ ] Mantine customization/preview/download workflow in dedicated new BrandedQr component, reuse existingbranding and qrcode. Decode generated output in tests where supported. Escape SVG text/no script injection and test plan/tenant.

## Integration and release

- [ ] Root owns sharedroute mounts, main.jsx/demo-api/navigation, customer page mount, migrationchecksums and releasepackaging. Each agent owns separate files; no overlapping edits to sharedfiles.
- [ ] Website demos synthetic/localonly, clear activation/message simulation; unknown routes fail closed. Liveaccount links disabledindemo. Unsaved/pending guards, errorstates, mobile/accessibility. No messages from tooltests.
- [ ] Compare several primary competitor sources (wallet-focused + commerce loyalty + enterprise), separate shippedcapability from provenoutcomes/integrationcoverage/scale. No unsupported claim of categoryleadership.
- [ ] Fullunit/type/lint + disposablePG + realbrowser/QR tests, independentspec/qualityreview. Scoped API and worker overlays fromtheir respective liveimages, backup+additivemigrations, runtimepermissions/healthchecks, externalURLchecks. Preserve workspace-only unpublishedorder/contactroutes; no nativebuilds. Persist tags androllback evidence.
