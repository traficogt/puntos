# Reward promises and staff hospitality implementation

Website/server only. Installed native clients retain their request/response shapes.

## Reward protection

The additive `2026-11-11-reward-promises-hospitality.sql` migration observes future edits. It does not reconstruct earlier promises. Before active base earning terms, reward terms, or branch eligibility change, it records one current cycle for each nondeleted customer with positive net available-plus-pending progress. Zero/negative net progress does not create a cycle. Unrelated program flags and unused rate fields do not create cycles.

A cycle records the current balance observation, original program type/base rates/rounding/region, and the original active, unexpired reward choices, names, descriptions, point prices, expiry and branch scope. Later edits do not replace that cycle. New staff/external purchases evaluate the protected base rule inside the purchase transaction. Current campaign/guard/hold rules remain applicable. Pending points remain unavailable until their ordinary release. The first successful positive-point redemption closes the entire cycle; a courtesy costing zero points does not close it. The following cycle uses current terms. This intentionally protects one current earning cycle, not unlimited lifetime redemption at old terms.

Normal staff/native redemption requests honor protected terms automatically. New browser fulfillment can select an owner-approved alternative only with explicit customer acceptance. Alternative stock and actual fulfillment cost are recorded, with the original point price. Availability pauses block fulfillment without deleting entitlements. Recorded original expiry/branch conditions still apply. Standard redemption daily/cooldown rules also apply to the browser protected route.

## Hospitality

An owner authorizes one named reward for one staff member, optionally a fixed branch, for up to 31 days. Each issuance is exactly one unit. Bounds are finite total units, per-unit cost ceiling, total cost commitment, and a customer redemption lifetime (1–2160 hours). A known current reward cost is required. Every issuance reserves the entire ceiling, so a later known cost increase within that ceiling cannot exceed the approved commitment. Unknown or over-ceiling fulfillment cost is blocked for owner review. Expiry and revocation stop issuance; neither removes a previously issued benefit nor replenishes budget. Physical stock is checked at issue and deducted only on fulfillment; issuance does not reserve stock.

Owner-approved grant identity/terms, issued benefit identity/terms, and fulfillment records are immutable. Request UUIDs and fingerprints reject changed retries. Grant revocation is monotonic. Audit writes share the mutation transaction, so a failed audit rolls back budgets, stock, points, and history. Issuance/fulfillment require connection; browser actions retain the request identity after a lost response.

## Routes

Owner only:
- `GET /api/admin/reward-promises`: reward availability/protected customer counts and latest 100 fulfillment records.
- `PUT /api/admin/reward-promises/:rewardId/availability`: `available`, up to five `alternative_reward_ids`.
- `GET/POST /api/admin/hospitality`: current/history overview and bounded grant creation.
- `POST /api/admin/hospitality/:grantId/revoke`.

Authenticated staff:
- `GET /api/staff/reward-entitlements?customer_id=UUID`.
- `POST /api/staff/reward-entitlements/redeem`: `request_id`, `customer_id`, exactly one of `promise_id`/`hospitality_id`, optional `fulfillment_reward_id` and `customer_accepted`.
- `GET /api/staff/hospitality` and `POST /api/staff/hospitality/issue` (`request_id`, `grant_id`, `customer_id`).

Customer own identity only: `GET /api/customer/reward-entitlements`.

All routes use tenant middleware and no-store. Writes require CSRF and strict payloads. The services additionally recheck live staff role, active state, branch and customer state. New service responses include `region`; original `/staff/program` additionally exposes region without removing existing fields.

## Runtime grants and integration

All six new tables have forced tenant RLS. Runtime roles require:

- `reward_promise_cycles`, `reward_availability`, `hospitality_grants`: SELECT, INSERT, UPDATE.
- `customer_reward_promises`, `hospitality_entitlements`, `reward_entitlement_fulfillments`: SELECT, INSERT.

Do not widen existing branch or redemption privileges; their read/insert-only runtime contracts were exercised in integration tests. Locking order in protected purchase is business SHARE then balance UPDATE. Protected redemption is business SHARE, sorted reward locks, balance UPDATE, customer SHARE. Snapshot triggers lock balances in customer-id order and do not take a business lock after taking a reward lock. Economic cost changes can therefore keep their business-before-reward order.

Root integration owns route registry, merchant navigation/lazy imports, demo dispatcher, grant script, checksum refresh, release overlays and deployment. Components are `RewardPromises.jsx` and `Hospitality.jsx`; demo handler is `demoRewardHospitality(url, options)`.

## Verification

- Disposable PostgreSQL suite: `REWARD_PROMISE_TEST_DB_URL=postgres://.../reward_promise_test NODE_ENV=test node --test tests/integration/reward-promise-hospitality.test.js` (exact localhost/database guard).
- Route tests: `NODE_ENV=test node --test tests/unit/reward-hospitality-routes.test.js`.
- Checkout browser tests: `tests/e2e/reward-hospitality.spec.js`.
- Owner browser script: `node web/merchant/tests/reward-hospitality-browser.spec.mjs`.

The isolated browser checks exercise response-loss retry identity, substitute acceptance, protected/current checkout rule display, availability edits, regional currency labels, offline clearing, and 390/1200px light/dark screens with axe. Owner tables are keyboard-focusable horizontal regions. Screenshot artifacts are `/tmp/pf-reward-hospitality-{390,1200}-{light,dark}.png` and `/tmp/pf-{hospitality,promises}-owner-{390,1200}-{light,dark}.png`. No production merchant records, messages, native sources or cloud build minutes were used.

Remaining release verification belongs to root: fresh full-schema runtime smoke, consolidated regression suite, independent spec/quality review (including screenshots), migration locks/grants and guarded release. Orders and other unpublished purchase sources have not been extended by these hooks; do not enable an untested purchase writer without applying the same protected-term transaction contract.


## Regional followup contract

The overview, reward-economics and service-restoration report services read the actual business region. Their default report bounds use the business timezone; explicit timezone injection remains supported. Responses add `region` and use the actual `currency`, retaining all legacy `_q` field names. PostgreSQL fixtures cover USD/New_York midnight boundaries across both DST changes. Actual reward unit costs, hospitality ceilings/budgets, staff/external purchase amounts and gift-card issue/redemption amounts enforce the business currency precision inside their transaction. Cost-per-point remains a six-decimal analytical ratio. Cost/assumption and new gift-card transaction/audit metadata identify currency. Gift-card request/replay response fields remain additive.

External POS awards check supplied currency against the locked business; absent currency keeps the legacy API interpretation of configured business currency. A PostgreSQL test passes an intentionally stale MXN pre-read while the business is CLP and verifies mismatch/fraction rejection with no ledger write. Root owns final trusted expectedCurrency handoff across POS/payment-webhook entrypoints.

Browser enrollment uses the known business country. GT retains the existing eight-digit default; other countries require an explicit `+` international number and do not guess a national prefix. Public business/customer-me responses expose region. Customer history, growth offers and staff benefit/amount displays use it. The legacy dashboard fetches staff-program region before showing monetary controls; its shared money formatter and gift/program labels are regional. Merchant report/amount/date components use the shared region loaded by the root-owned shell. The service-worker static dependency list includes both benefit modules and advances to cache v45.

Campaign message windows and body currency/expiry timezone use the current business region; second-visit eligibility gates are preserved. The automation caller sweep belongs to agent B. POS sources/UI, payment webhooks, regional settings/schema/imports and release wiring belong to root. Root confirmed contact-sync/customer-resolution/order sources are unpublished and excluded from this release.

Regional validation artifacts: `/tmp/pf-regional-db-tests.txt` (47 PostgreSQL tests, exact isolated database guards on port 55451), `/tmp/pf-benefit-browser-final.txt` (4 Chromium tests), `/tmp/pf-owner-benefit-browser.txt` (owner light/dark mobile/desktop flows and axe), `/tmp/pf-regional-typecheck-final.txt`, `/tmp/pf-regional-lint.txt`, and `/tmp/pf-merchant-build-final.txt` (isolated output in `/tmp/pf-regional-merchant-build`). Independent review and production-like consolidated release validation still belong to root. No native regional behavior was tested or claimed; installed Guatemala APIs retain their defaults.

Latest handoff verification: all 1,117 server unit tests passed (`/tmp/pf-regional-all-units-verified.txt`); the protected-benefits PostgreSQL suite was rerun after the final hospitality lock/audit change and passed all 14 (`/tmp/pf-benefit-final-db.txt`). Typecheck and owned ESLint checks passed. Merchant unit tests passed 76/77; the one outstanding test was the root-owned POS installation-copy expectation `/GTQ/` after copy correctly changed to configured currency (`web/merchant/tests/pos-installation.test.js:13`), already reported to root. The isolated merchant Vite build succeeded.

## Final review corrections

New rewards are inserted inactive, receive their branch assignments, and are published as the final step in the same transaction. Promise triggers ignore inactive reward/branch changes, so unpublished unrestricted creation state cannot become a customer promise. Published branch edits, including the first restriction on a previously unrestricted reward, still preserve their original scope. Legacy redemption daily limits now use the locked business timezone while retaining original reward identity for substitutions. The final isolated PostgreSQL suite passes 20 tests, including the new creation/scope/calendar regressions and root's substitution-limit regressions; 10 focused staff/route unit tests, typecheck and ESLint also pass (`/tmp/pf-promise-review-*`). The promise migration content changed and requires the root-owned checksum refresh before release.
