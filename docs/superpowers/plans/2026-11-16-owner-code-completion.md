# Owner workspace and code assurance implementation plan

> For agentic workers: use subagent-driven-development for independent tasks,
> followed by independent review and combined verification.

**Goal:** Complete the five approved website/backend improvements without native
app work, real-device requirements or production test data.

**Architecture:** Extend the existing Mantine merchant workspace and its guarded
APIs. Check merchant source and API/form contracts, reuse the disposable PostgreSQL
runner for failure/scale scenarios, and collect the browser regressions through
the existing exact-source release gate.

**Tech stack:** React, Mantine, Vite, TypeScript/checkJs, Node test runner,
Playwright, PostgreSQL and Docker. Keep current fonts and design tokens.

## 1. Owner workspace

- [ ] Add bounded owner-only customer directory/list/detail/name-update APIs in
  `src/app/routes/admin/customers.js` and a dedicated customer-directory repository.
  Preserve phone as account identity; use `previous_name` to detect stale edits.
  Keep the existing CSV export feature gate and no-store/session/CSRF rules.
- [ ] Add typed customer, staff and branch screens and a settings landing in
  `web/merchant/src/`. Reuse existing staff reauthentication and branch list/create
  contracts. Preserve permissions, plan limits, confirmations, dirty guards,
  loading/error/empty states and independent request context.
- [ ] Add browser-only fictional fixtures; wire Spanish fragments and grouped
  navigation in `main.jsx`, `navigation.js`, `merchant-navigation.js`, `demo-api.js`.
  Keep old routes as compatible fallbacks. Everyday links use new screens.
- [ ] Verify actual screens with desktop/mobile, keyboard and dark-mode browser
  checks, including stale responses, validation and save-failure recovery.

## 2. Merchant type checking

- [ ] Add merchant TypeScript config/check script covering production source,
  Vite and scripts, plus strict API/form contracts and negative contract tests.
- [ ] Resolve the actual baseline diagnostics with precise types and behavior
  fixes where warranted. Do not exclude production screens or blanket-disable
  checking. Document legacy browser harness scope separately.
- [ ] Include new owner components, run typecheck and prove invalid payloads and
  nonexistent response fields fail the contract tests.

## 3. Failure simulations

- [ ] Add `tests/integration/failure-simulations.test.js` using the full managed
  schema in the existing disposable runner, a dedicated database and explicit
  isolated-run marker. No live providers, external target URLs or copied secrets.
- [ ] Exercise connection termination/rollback, committed import chunks followed
  by expired/reclaimed job leases, queue delivery failures, overlapping requests,
  and replay/out-of-order provider records. Assert durable state and exact effects.
- [ ] Fix reproduced failures with red-green regression evidence; distinguish
  simulated failure boundaries from real-device/provider acceptance.

## 4. One release gate

- [ ] Extend `src/scripts/release-readiness.mjs` to require merchant typecheck,
  contract tests, merchant navigation/import/owner browser suites, customer offline
  shell, and staff offline browser cases alongside existing checks.
- [ ] Use Node TAP wrappers for standalone merchant runners and the existing
  Playwright JSON wrapper for both staff browser engines. Validate expected
  project coverage; skipped/zero/flaky/incomplete runs cannot pass.
- [ ] Register new database suites in `run-domain-integration-isolated.mjs`;
  apply resource bounds and an isolated-run marker to the existing test environment.
- [ ] Update `.github/workflows/ci.yml`, readiness documentation and parser/catalog
  regression tests. Preserve exact-commit/content checks and external acceptance
  as separate, untested evidence.

## 5. Larger fictional businesses

- [ ] Add `tests/integration/merchant-scale.test.js` and deterministic seed helpers
  using managed migrations. Start with 10,000 customers and 100,000 purchases plus
  a second business to verify scope. Run no production queries.
- [ ] Measure actual overview, customer-directory searches, audience selection and
  5,000-row import preview/chunk processing. Verify totals, ordering, scope and
  import effects as well as query counts and durations.
- [ ] Record machine-readable sample counts and timings with generous regression
  ceilings. Profile slow paths with EXPLAIN in the disposable database, optimize
  only measured bottlenecks, and compare identical before/after fixtures.
- [ ] Document dataset, hardware constraints, measured improvements and limitations;
  these observations are not a production capacity or SLA claim.

## Integration and release

- [ ] Cross-review agent commits for requirements and correctness, integrate,
  inspect rendered UI and build assets once the implementation is settled.
- [ ] Run the complete expanded release gate from a clean non-hidden disposable
  checkout with synthetic services, locked dependencies and installed browsers.
- [ ] Verify GitHub checks, source/image hashes and a database backup, deploy via
  the guarded API/worker procedure, and verify public routes/browser flows.
- [ ] Merge and push the exact reviewed revision. Preserve the owner's dirty
  root AGENTS/package files and all native source/releases. Remove only this
  task's temporary branch/worktree after verified integration.
