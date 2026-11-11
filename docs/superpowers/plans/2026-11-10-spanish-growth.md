# Spanish navigation and customer growth implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development; review specification before quality. Retain the isolated website worktree and preserve installed native API contracts.

**Goal:** Put all browser-facing navigation in Spanish and develop the next useful owner capability around a measurable business outcome.

**Architecture:** Canonical Express routes with permanent legacy redirects, existing HTML/Mantine components and same-origin authentication. Existing API contracts and customer/business identifiers are stable. Website-only, no native builds or unsolicited outbound messages.

**Tech stack:** Express, PostgreSQL, React/Mantine, existing points/rewards/analytics infrastructure.

## Part 1: Spanish navigation (explicitly requested)

Canonical paths: `/negocio/` (owner overview), `/demostracion/` (sample dashboard), `/administracion/` (existing admin), `/crear-negocio/`, `/equipo/ingresar/`, `/equipo/escaner/`, `/mi-tarjeta/`, `/plataforma/`, `/vista-previa-app/`. Existing `/registro/:slug` and `/ingresar/:slug` remain. Generic join/ingresar HTML aliases use `/registro/` and `/ingresar/`.

- [x] Add router `src/middleware/spanish-web.js` and route utility `src/utils/spanish-web-routes.js`; register before static serving. GET/HEAD legacy routes return permanent same-origin redirects preserving all query parameters, translating known navigation keys. APIs and asset routes are excluded. Never rewrite business slug values.
- [x] Translate legacy admin `tab` to `seccion`: rewards→recompensas, branding→marca, tiers→niveles, branches→sucursales, staff→equipo, giftcards→tarjetas-regalo, achievements→logros, challenges→retos, referrals→referidos, operations→operaciones, analytics→analisis. `branch_id`→`sucursal`, `setup`→`configurar`, program→puntos, pos→punto-de-venta. Old query input remains readable.
- [x] Translate merchant fragments overview→resumen, launch→preparar, campaigns→campanas. Accept old fragments and normalize history without losing draft guards. `/merchant/?demo=1` redirects to `/demostracion/`; demo recognition follows the canonical path and preserves complete isolation.
- [x] Serve the current merchant shell (with CSP nonce) under both Spanish paths. Build resources under `/negocio/recursos/`; preserve old assets for open tabs. Keep the app preview's existing compiled code and expose only its hosting route under Spanish alias.
- [x] Replace navigation links/redirect targets in browser source and server-generated customer links, update web manifest start URL and service-worker canonical caches/fallbacks. No native sources/dependencies.
- [x] Test legacy paths, trailing slashes, queries, old/new hash fragments, demo isolation, no API redirects, host split, login redirects, cache/offline compatibility and existing browser flows. Run full unit/lint/type checks and visual spot check.
- [x] Spec review, then quality review; deploy a scoped overlay from the current live image, retain rollback and verify canonical and legacy URLs externally.

## Part 2: Meaningful growth capability

The owner has authorized substantive website improvements, with established components. The owner selected customer recovery, then explicitly requested acquisition/referrals and POS efficiency in parallel. Existing basic referrals and winback must not be falsely presented as new features. The recommended direction is an owner workflow connecting customer selection, a targeted benefit and measured return visits. Complete context and select a bounded specification before implementation; do not send real customer messages during development.

The implementation must expose real eligibility and results, respect tenant boundaries and existing app APIs, explain data limitations, and work in the isolated demonstration using synthetic data. It must add operational capability beyond a cosmetic refresh or a list of advice.

### Recovery specification selected after independent navigation work

Add **Recuperar clientes**, an operational follow-up workspace using Mantine and the existing authenticated analytics API. It uses completed/pending genuine purchase records with the same source/activity exclusions as the overview. Owners preview customers whose latest recorded purchase was at least 30/60/90 full days ago, prioritized by historical recorded sales; deleted customers and other tenants are excluded. Counts are based on recorded activity, not inferred churn probability.

Owners save a named list of up to 200 customers (default 50) and optional internal follow-up notes. Membership is a snapshot; the preview may change before saving. A client-generated request UUID makes a retried save idempotent. Lists persist in PostgreSQL with tenant RLS and explicit tenant predicates. Paginated customers show name, contact number, last purchase and prior recorded sales. No files or customer contacts are exported automatically.

Owners can mark a customer **Ya lo contacté** only after confirming that the customer authorized that contact and that it already happened; this is an owner record, never a delivery receipt. They can instead mark **Omitir**. Status transitions are pending→contacted or pending→skipped, guarded against races; repeats preserve the initial timestamp. No outbound messages, automatic points or discounts are issued.

Each saved list measures how many contacted customers made another genuine purchase within the following 30 days, plus those recorded sales. The result is observed activity after contact, not proven incremental revenue or ROI; refunds/reversals excluded by the same purchase definition. Results remain bounded by now and the fixed 30-day window. Removed customers do not expose PII. UI explains the missing delivery automation plainly.

API contract under `/api/admin/analytics/recovery`: GET `/audience` (`inactive_days`, `limit`, `offset`); GET/POST `/runs`; GET `/runs/:id` (paginated members); PATCH `/runs/:id/members/:customerId` with `status: contacted|skipped` and `contact_confirmed: true` for contact. Every endpoint owner + existing analytics plan; mutations CSRF. Strict input schemas, bounded pagination, tenant-safe not-found results. New migration additive only; no native contract changes.

Demo runs the same workflow entirely in browser memory. Validate tenant isolation, bounds, idempotent creates/marking, transaction safety, deleted customers, true purchase eligibility and 30-day result windows against disposable PostgreSQL. Browser checks cover draft/save/mark/reload, errors and mobile accessibility. Send no real messages and create no real customer follow-up records during deployment checks.


## Published outcome

Deployed `puntos-api:spanish-growth-20261110`; public preview is `/demostracion/`, owner workspace `/negocio/`. Browser URLs and shareable navigation are Spanish with legacy redirects. Recovery persists manual follow-up lists and observed 30-day results. Referrals adds editable existing incentives and an accurately defined recommendation/purchase funnel. POS adds guided setup and receipt preflight without awards or external requests.

Validation: 892 backend unit tests, 22 frontend tests, 12 recovery PostgreSQL tests, 7 referral PostgreSQL tests; browser workflows, actual service-worker offline navigation and mobile accessibility passed. Independent specification and quality reviews passed. Live checks: 15 route checks, 3 protected APIs; demo made zero real API requests. Native builds: zero; worker unchanged.

Deployment evidence and rollback: `/var/lib/puntos/releases/spanish-growth-20261110`. Runtime routes/index.js applies only this task's new mounts to the deployed route registry; pre-existing workspace-only order, order-return and contact-sync routes remain unpublished. Source and runtime manifests document that intentional difference. Recovery contact recording is manual; no outbound messages or automatic targeted discounts were added. Existing settings conflict checks remain GET-before-PUT, without atomic compare-and-swap.
