# Reward fulfillment and pilot consolidation implementation plan

> Execute the approved scope in the existing merchant worktree using focused independent implementers and separate spec/quality review. No native releases or unpublished order/contact work.

**Goal:** Trace completed PF redemptions to actual POS records, with optional product/service mappings, explicit pending/reversed states, verified Odoo 18 receipt linking, and trustworthy pilot/onboarding evidence.

**Architecture:** Preserve existing points/redemption APIs. Add separate fulfillment records and immutable events using PostgreSQL transactions, tenant/branch permissions, versions and stable request identities. A database insert trigger captures every new completed redemption, including installed-client writers. Historical evidence remains unknown. POS software owns stock movements. Odoo links an already-completed eligible order line and sends durable signed evidence without creating a second stock movement.

**Tech stack:** Existing Express/Zod/PostgreSQL/RLS, Mantine/React/browser modules and Odoo 18 ORM/transient wizard/ACL/cron/outbox. Reuse existing HMAC transport and recovery services; no new framework/native dependencies.

## Approved behavior

- Optional owner mapping: PF reward, POS source, product/service reference, positive quantity, display name and version. No full inventory catalog or currency conversion.
- New completed redemptions are pending POS recording. Legacy history has unknown evidence. Mapping edits never rewrite recorded snapshots.
- Branch-authorized staff may attest a manual receipt; no-POS resolution is explicit. Staff-reported evidence never claims verified inventory.
- Signed lookup returns redemption/mapping/branch/currency only, without customer contact data. Signed events require source, stable event ID, order+line reference, matching product/quantity/currency/mapping version. Identical retries replay; conflicting reuse, duplicate receipt-line use and second fulfillment fail.
- POS recording and stock completion are separate. Refund/cancellation evidence marks review/reversal without silently restoring points or stock. Existing recovery workflow handles points; native POS handles returns.
- Odoo wizard links a completed zero-price/fully discounted mapped line of exact quantity. Local linkage and outbox are atomic. Validate company/config, product, quantity, return status and non-reuse. Durable retries retain payload identity; linked returns emit reversal evidence. New validation requires connectivity; queued evidence resumes later.
- Odoo purchase export skips zero-total complimentary receipts and excludes mapped free reward quantities from ITEM earning at initial immutable capture. Paid quantities retain normal earning.
- Merchant screen: mappings, reconciliation status/branch/evidence, explicit manual actions. Scanner shows reference and next POS step, without implying inventory synchronization.
- Preserve a validated internal owner return destination across login; authenticated managers/cashiers get role-appropriate access guidance.
- New pilots store checklist version plus optional POS/version profile. Existing active/closed pilots retain their original checklist. Missing-row updates fail. Launch retains completed pilot evidence with a historical label.
- Owner briefing failures appear separately in operations diagnostics, with independent entitlement and no automatic resend.

## Implementation tasks and acceptance

- [x] 1. Capture guarded source/runtime/native baseline; finalize service/connector contracts; add RED state-machine, duplicate, concurrency, tenant/branch and legacy-capture tests.
- [x] 2. Add fulfillment migration/services/routes: `redemption-pos-*`, `reward-pos-*`; register only new scoped routes/grants. Verify no points/stock mutations, immutable evidence and safe replay under real PostgreSQL.
- [x] 3. Extend `integrations/odoo/pf_pos_connector` wizard/outbox/views/ACL, free-item earning and package/docs. Run isolated Odoo18 ORM, transport contract and retry/refund tests.
- [x] 4. Add merchant `Fulfillment.jsx`, model/demo, scanner next-step feedback and navigation. Browser-test desktop/mobile/light/dark, errors, keyboard/accessibility and no overflow.
- [x] 5. Fix access helper/login/main access view; version `merchant-pilot-service.js` checklists/profile and demo/launch; add owner-brief diagnostics. Test old pilots, missing checks, preserved return routes and no sends.
- [x] 6. Independent spec then quality review; full schema restricted-role smoke; lint/typecheck/unit/web/build; capture external acceptance limits separately.
- [x] 7. Verified backup; scoped pinned API/worker overlay from central-america-20261111; filtered migrations/grants; live checks; guarded source sync and unchanged native hashes.

## Scope limits

No automatic points redemption from inside POS, anonymous/offline bearer rewards, inventory replacement, merchant Odoo installation or managed-Odoo commercial launch. This verified linking step follows the actual POS transaction; a future counter shortcut must preserve its checks. No real customer/provider messages during testing.

## Released verification

Website/server release `reward-fulfillment-20261111` is deployed. Server unit tests: 1,180; merchant tests: 93; fulfillment PostgreSQL: 18; operations PostgreSQL: 14; pilot PostgreSQL: 10. Full filtered schema (64 migrations) and restricted-role smoke passed with actual redemption writers and no provider sends. Odoo fresh install and upgrade each passed 28 ORM cases; 8 Python contracts and 3 package/wire checks passed. Desktop/mobile/light/dark browser checks and live demo passed without accessibility violations. All 83 native baseline files are unchanged.

Review fixes: signed-only fulfillment endpoints, corrected-redemption lookup, shared original/return line uniqueness, canonical UUID locks/replays, frozen Odoo receipt identity, exact fractional return display and unassigned-branch copy.

Real merchant installation, Odoo wizard interaction, physical/offline POS and Wallet device acceptance remain pilot checks. Receipt linking follows a PF redemption; it is not automatic POS redemption or a replacement inventory system. See `docs/POS_CANJES_ES.md` and `integrations/odoo/VERIFICATION.md`.
