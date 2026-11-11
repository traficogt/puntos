# Reporting consistency and owner actions implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development task by task. The approved scope is in `docs/superpowers/specs/2026-11-11-reporting-actions.md`.

**Goal:** Keep purchases counted after point expiry and put supported reward findings in the owner's existing inbox and weekly brief.

**Architecture:** A shared reporting-only purchase predicate plus one outcome-evidence service and pure findings model. Existing analytics and notifications consume these helpers; balances, eligibility and sending authorization remain unchanged.

**Tech Stack:** Express, PostgreSQL, Node test runner, React/Mantine, Playwright.

## 1. Reporting definition

Files: new `src/app/services/reporting-purchase.js`; merchant overview, growth campaign, redemption returns and audited read-only reports; focused tests under `tests/unit` and `tests/integration`.

- [x] Add failing PostgreSQL regression: a POSTED purchase changed to EXPIRED retains count/sales/return; REVERSED removes it, PENDING remains a recorded purchase, bonus/import/empty rows never count.
- [x] Implement `reportingPurchase(alias)` returning the contract predicate, validate the code-supplied alias, reuse it without modifying write eligibility. Example: `AND ${reportingPurchase('t')}`.
- [x] Audit other purchase aggregates; use the helper for comparable reports, document ledger and automation exclusions.
- [x] Run focused tests and independent spec/correctness review.

## 2. Shared owner evidence

Files: new `src/app/services/owner-outcome-service.js` and `owner-outcome-model.js`; `merchant-decisions-service.js`, `merchant-decisions-model.js`; new unit/PostgreSQL tests.

- [x] Write tests for full courtesy expiry cohorts, tenant boundaries, current missing costs, known zero costs, unchanged refresh fingerprints and stale-data suppression.
- [x] Read complete cost/courtesy aggregates at an explicit snapshot and reuse `getRedemptionReturns({businessId,days:90,now},query)` for mature follow-up.
- [x] Build zero-to-three findings with stable keys, data-backed explanations and actions. Merge with existing inbox without duplicating economics warnings.

## 3. Weekly brief integration

Files: `weekly-owner-brief-service.js`; owner brief unit/PostgreSQL tests and demo fixtures.

- [x] Test priority selection: data blockage and delivery failure precede new outcome findings; no more than three; fallbacks maintain a useful empty-program summary.
- [x] Use `reportingPurchase('t')` with POSTED/EXPIRED confirmed versus PENDING breakdown. Keep seven-day window and field compatibility.
- [x] Add shared findings to newly generated preview/snapshots, preserve existing saved snapshots and all opt-in/delivery protections. Convert internal actions to authenticated same-origin owner URLs. Add inbox link for further findings.
- [x] Assert captured fake-provider email contains selected evidence/actions; no external messages.

## 4. Browser/demo integration

Files: `web/merchant/src/Decisions.jsx`, owner brief preview component, `RedemptionReturns.jsx`, fictional demo adapters and relevant browser tests.

- [x] Preserve incumbent design; render useful evidence, snapshot/period context and further-findings link.
- [x] Support `?ver=visitas-tras-canje#resumen` navigation to the return report and consume the focus parameter without changing existing hash navigation.
- [x] Verify all new actions, review/snooze, simulated email preview and mobile/desktop light/dark accessibility using fictional demo data.

## 5. Review and release

- [x] Run full unit/merchant suites, focused isolated PostgreSQL, typecheck/lint/build and browser checks. Resolve independent review findings.
- [x] Build only changed runtime files over the current deployed image; verify required tables, restricted-role reads and 83 native files unchanged.
- [x] Deploy website/server, run live demo/health checks, persist rollback/image selectors, sync only baseline-guarded changed sources and record evidence.

Workspace: `/opt/puntos/.worktrees/merchant-web`. Baseline/release evidence: `/var/lib/puntos/releases/reporting-actions-20261111`. No blanket staging or commits in the existing dirty trees.

## Release evidence

Website/server deployed on 11 November 2026. Server unit 1,248/1,248 and merchant 125/125 passed; focused reporting, owner-outcome, weekly email, inbox and guided-automation PostgreSQL regressions passed. Three stale additive-response assertions from the baseline were corrected without runtime changes; recovery/economics then passed 34/34. All other audited existing integration suites passed. Typecheck, lint, build and mechanical UI detection passed. Independent spec, correctness and visual reviews approved after resolving midnight fingerprint stability, fixture coverage, email snapshot metadata and singular/plural copy. Local and live fictional demo checks passed at 390/1200px in both themes with zero axe violations and zero real API requests.

Read-only production check under the restricted application role exercised real outcome SQL, decisions inbox and owner preview and confirmed cross-tenant isolation. No production test writes or test provider messages. All 83 native files and dependencies are unchanged, no cloud native jobs were started, and articles remain deferred. Runtime remains at 66 migrations; unpublished order/contact routes and migrations remain excluded. Reporting-only semantics and audit exclusions are documented in `/var/lib/puntos/releases/reporting-actions-20261111/reporting-audit.txt`.

Moving snapshot dates and rolling window bounds remain display metadata; unchanged substantive evidence does not reopen reviewed/snoozed decisions at midnight. Secondary activity/second-visit suggestions fill the three-item email without inflating the extra actionable-finding count. Historical emails remain immutable.
