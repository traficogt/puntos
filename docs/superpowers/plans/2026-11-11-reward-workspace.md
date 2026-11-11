# Vendor-neutral reward workspace and checkout implementation plan

> Execute owner-approved items1–4 with scoped implementers and independent spec/quality review in merchant-web. Preserve unrelated dirty files; no native releases or cloud builds.

**Goal:** Unified reward setup, easy product selection/import, direct checkout redemption and recent inventory checks through generic contracts; Odoo18 is one optional adapter.

**Architecture:** Keep redemption limits separate from physical stock. Generic source/product/branch IDs; existing protected reward terms, points ledger, receipt evidence and idempotency. Owner explicitly enables source/branch checkout and binds accountable PF staff. Confirm authorization before free item; exact retries; verified unpaid cancellation uses a durable tombstone and recorded reversal. Never auto-refund uncertain outcomes. Inventory snapshots are timestamped checks, not physical reservations.

**Stack:** Existing Express/Zod/PostgreSQL/RLS, Mantine/React, existing CSV parser, Odoo18 ORM/OWL. No new native/framework dependencies.

## Catalog and inventory — scoped implementer

Generic items: business, source, product_ref, sku, name, item_kind(product/service), active, origin(manual/csv/connector), revision. Owner manual/CSV preview/apply with bounded rows/fields, immutable request identity, no automatic deletion or formula execution. Signed catalog/sync: source,requestId,observedAt,items (max200). Signed inventory/snapshot: source,requestId,branchId,observedAt,items(productRef,availableQuantity nullable). Reject older observations; null/stale never imply available. No currency/quantity conversion.

Mappings gain optional inventory_required, false initially; omission by old clients preserves value. One enabled required mapping per reward/branch. Required product checks need active catalog item and a fresh matching snapshot with enough quantity. Services cannot require stock. Set business program_json.pos_inventory_checks when configured; old businesses retain behavior. Export getRewardInventory(client,{businessId,rewardId,branchId}) and assertRewardInventory; state not_required/available/unavailable/unknown/stale, quantity, requirement, observedAt, source. Root integrates existing writers and presentation. Never decrement physical stock.

## Owner UI — scoped implementer

New RewardsWorkspace/model/demo/tests, Spanish #recompensas. Existing Mantine/fonts. Create/edit reward, “Límite de canjes disponibles” or unlimited, cost unknown versus0, expiry, branches, manual availability, optional product. Search catalog, manual entry, CSV preview/import. Show stock evidence/freshness and explicit check toggle. Source/reference detail belongs to integration configuration. Root owns nav/demo dispatcher/legacy links. Add checkout source opt-in after root contract. Avoid silent partial save.

## Checkout core and integration — root

Owner GET/PUT /admin/pos-checkout/sources: source/branch/accountable staff opt-in. Generic signed POST /public/pos/:slug/checkout/options,authorize,status,cancel. POS features plus redemptions; no-store. Existing PF browser/Wallet QR proof. Options returns customer and eligible mapped rewards using protected terms and availability. Authorization freezes source,branch,cartId,cartLineId,customerId,rewardId,mappingId/version,operatorRef and proof hash. Atomic existing redemption debit, reward-limit decrement, cost snapshot and authorization outcome; exact replay before mutable eligibility checks. Unknown cancellation creates tombstone under same lock; delayed authorize cannot debit. Only unfulfilled unpaid authorization can cancel; recorded one-time ledger reversal, no physical stock mutation. Fulfillment events honor frozen mapping and validate authorization/cart-line linkage after mapping edits.

## Odoo adapter — checkout_odoo implementer

Actual POS action: scan PF card, choose reward, synchronize draft, persist immutable intent in one completed RPC before any remote PF debit RPC, then authorize and add fixed free line without merging. Restore intent/line across reload. Server validation before super._process_saved_order (Odoo can swallow action_pos_order_paid errors). Paid receipt plus fulfillment queue atomic without HTTP during payment. Cancellation first blocks payment durably and removes line from verified draft, then signed cancellation; no refund on timeout. Validate company/config/session/customer/line/price/tax/quantity and live local stock; pending intent quantities and normal cart demand included. Publish generic catalog/stock; secrets/proof excluded from POS loader. Preserve existing manual linking and free-item earning exclusions. Fresh-install/upgrade ORM, JS/browser and package contracts.

## Tasks and acceptance

- [x] Capture guarded source/runtime/native baseline and inspect incumbent code.
- [x] Catalog/import/snapshot tests RED→GREEN: bounds, revisions, replay, tenant/branch, stale evidence.
- [x] Unified owner workspace and backend save: reward/cost/mapping with no silent partial success; product entry/import and source controls.
- [x] Checkout transaction tests RED→GREEN: exact replay, changed identity, cancel tombstone, paid/cancel races, no double points/quota restoration.
- [x] Optional Odoo adapter online checkout, durable intents/cancel/payment guards, catalog/stock publishing and package.
- [x] Inventory guard integration and honest customer/Wallet availability; installed API payloads compatible.
- [x] Independent spec and quality review; database/ORM/contract checks; lint/type/unit/web/browser desktop/mobile/light/dark.
- [x] Verified backup and scoped pinned API/worker release from reward-fulfillment-20261111; filtered unpublished order/contact migrations/routes/grants, live checks, guarded source sync; native baseline unchanged.

## Boundaries

Manual entry/CSV work without Odoo. Automatic sync/checkout requires a conforming adapter. Snapshots do not reserve stock against ordinary sales. Unknown/stale data remains visible and blocks opted-in checked redemptions. No physical inventory ledger, tax/accounting engine or arbitrary remote fetcher. Real merchant hardware/offline POS, third-party modules and device acceptance require a recorded pilot even after code checks pass.

## Released verification

Website/server release `reward-workspace-20261111` is deployed. Server unit tests: 1215; merchant tests: 106; full-schema checkout with production grants: 27; catalog/workspace PostgreSQL: 25. Type checking, changed-source lint, production build, and desktop/mobile/light/dark browser checks passed. The optional Odoo 18.0.3.0.0 adapter passed fresh install, upgrade, and isolated real HTTP/OWL browser tests with simulated PF transport; see `integrations/odoo/VERIFICATION.md` for case counts and exact scope. All 83 native baseline files are unchanged. No native cloud builds or real customer messages were used.

Generic API and manual/CSV catalog remain independent of Odoo. Recent stock observations check availability but do not reserve physical inventory. Initial checkout authorization requires connectivity; durable retries recover previously recorded work. Merchant hardware, installed third-party POS modules, real offline behavior and Wallet devices still require a recorded pilot. Research documents are maintained separately and were not published as articles.
