# POS connection hub implementation plan

**Goal:** Let owners connect sales without modifying POS source code: a native Loyverse reader, self-service authenticated API access, and a previewed CSV import.

**Architecture:** Preserve Express/Postgres/vanilla JS and the deployed backend. Store connection settings under `businesses.program_json.pos_integration`; encrypt access tokens, reuse encrypted `external_awards.api_key`, and expose masked status only. Add owner-only tenant-scoped routes under `/api/admin/pos` and public authenticated sales under `/api/public/pos/:slug/sales` (both also mounted at `/api/v1`). No migrations. Add a worker poll every five minutes for explicitly enabled Loyverse connections. Preserve existing frontend design and fonts.

**Tech stack:** Existing Node, Express, pg, zod, Node test runner, Playwright, fetch, crypto.

## Shared contracts

- Normalized sale: `{ saleId, source, customerPhone, amountQ, currency: "GTQ", visits: 1, items, occurredAt? }`. Unknown/refund/cancelled/anonymous records do not earn points. All awards use the existing transactional external-award service with deterministic IDs; repeat deliveries cannot add points twice.
- Connector page: `{ sales: NormalizedSale[], issues: [{ saleId, code, message }], nextCursor: string|null }`.
- `GET /admin/pos`: `{ ok, business: { slug }, integration: { enabled, mode: "api"|"csv"|"loyverse", automatic, has_api_key, api_key_masked, loyverse: { configured, merchant_id, merchant_name, store_id }, last_sync: object|null } }`.
- `PUT /admin/pos`: body `{ enabled, mode, automatic?, loyverse?: { access_token?, store_id? } }`; changing token validates merchant and currency before saving. Omitted token preserves existing. Enables external awards as needed and generates a key if missing. Response is the same safe shape as GET; secrets are never returned here.
- `POST /admin/pos/key`: rotates key; returns `{ok, api_key, integration}` once. Requires owner role, plan feature, and CSRF. UI warns that rotation requires updating existing integrations.
- `POST /admin/pos/loyverse/preview`: read-only sample since connection start; returns the preview shape below.
- `POST /admin/pos/loyverse/sync`: imports the bounded next page; returns `{ok, result:{awarded,duplicates,errors,ignored,issues,has_more}}`; worker uses the same function. Initial automatic sync starts at connection activation, never old sales.
- CSV inspect/preview/commit: `POST /admin/pos/csv/preview` with `{csv,source,columns:{saleId,customerPhone,amountQ,status?,items?},amountUnit:"major"|"minor",assumePaid:boolean}`. CSV parser handles quoted cells, UTF-8 BOM, comma/semicolon delimiters and up to 100 data rows; preserves identifiers and phone strings. Columns are header names. `assumePaid` must be explicitly true if no status column. Status matches only paid/completed/pagado/pagada.
- CSV preview returns `{ok,headers,rows:[{row,saleId,customerPhone,amountQ,points,status:"ready"|"error"|"ignored"|"duplicate",message}],summary:{total,ready,errors,ignored,duplicates}}`; when columns are missing, return headers only with empty rows. Commit at `POST /admin/pos/csv/import` uses same input, recomputes validation, and returns `{ok,result:{awarded,duplicates,errors,ignored,issues}}`. Never automatically create customers.
- Public sales: `POST /public/pos/:slug/sales`, `Authorization: Bearer <owner-generated-key>` or `x-signature` HMAC-SHA256 raw JSON with that key; body `{saleId,source?,customerPhone,amountQ,currency:"GTQ",status:"paid"|"completed",items?}`. Also accepts `dryRun:true` for validation without writing points. Generic clients can use any implementation language; no brand-specific payload required.

## Work

- [x] Loyverse adapter: fixed official HTTPS host, bounded requests with timeout/no redirects, merchant GTQ verification, paginated receipts, customer phone resolution, safe normalization, fixture tests.
- [x] CSV parser and normalization with failure-first tests for ambiguity, quotes, units, bad rows, unknown status, refunds, and limits.
- [x] Integration service/routes: tenant isolation, encrypted settings, safe responses, self-service key rotation, previews/imports and idempotent native polling. Add authorization and functional tests.
- [x] Spanish owner UI: one connection selector, conditional setup, actionable errors, masked key plus one-time copy, previews and clear confirmation before imports. Test mobile/desktop and themes.
- [x] Worker scheduling, service worker cache update, documentation, independent review, isolated HTTP/database verification.
- [x] Package only reviewed changes onto deployed images, retain rollback, deploy, and perform read-only live checks. Native merchant accounts stay disconnected until owners supply credentials and enable them.

## Verification and release

- 568 unit tests passed; focused ESLint passed. Typecheck exactly matches the existing 61-error baseline.
- Isolated HTTP/database verification used schema only, fresh credentials, a non-superuser runtime role, and test-only customers. Covered real owner sessions, CSRF, encrypted keys, API/HMAC, CSV, idempotency, native retry persistence, tenant RLS and concurrent settings preservation.
- Browser fixtures passed 320/390/1440 light/dark, and actual dashboard fragment wiring passed.
- API and worker released as `pos-hub-20261109`, layered onto their respective running images. No migrations. Runtime route mounts preserve the older deployed backend.
- Release manifest, snapshots and rollback: `/var/lib/puntos/releases/pos-hub-20261109/`. No businesses were configured at deployment.
- Native adapter uses official Loyverse contract fixtures; live merchant verification remains dependent on an owner supplying a real token. Refund reversals remain manual.
