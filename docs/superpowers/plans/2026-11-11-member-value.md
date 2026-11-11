# Member value implementation plan

Design: `docs/superpowers/specs/2026-11-11-member-value.md`.
Workspace: existing isolated `merchant-web` worktree; release baseline saved under `/var/lib/puntos/releases/member-value-20261111` before edits.

- [x] Customer statement: test ledger classification and complete SQL aggregates; add service and additive authenticated customer route; extend cached history rendering and browser tests.
- [x] Post-redemption return report: test cohort maturity, local-day boundaries, refund exclusions and tenant scoping; implement service and analytics route; add merchant report and demo data.
- [x] Hospitality pilot: test exact whole-unit cap and all-record totals; add reporting to existing service; extend owner setup/results and demo fixtures.
- [x] Integrate routes and fixtures; review implementation against spec, then independently review correctness/security and rendered design.
- [x] Run unit, isolated PostgreSQL, browser, lint/type and web build checks relevant to changed code; verify native source and dependencies unchanged.
- [x] Prepare reviewed source manifest and scoped production image overlay, deploy website/server, verify read-only live behavior, preserve rollback and report limitations.

Ownership: parent owns customer statement, route integration, demo router, release and verification. Independent agents may own return-report service/route/component and hospitality service/component/fixture respectively; no shared-file concurrent edits. No commits or blanket worktree deployment.

## Release evidence

Website/server release on 11 November 2026. 1,241 server unit tests, 125 merchant tests and 42 isolated PostgreSQL checks pass. Customer statement checked in Chromium and Firefox; combined merchant demo checked at 390/1200px in both themes with zero axe violations and no real API calls. Independent financial/permission reviews approved; final visual review resolved the live timestamp label. Restricted production role read the customer statement and return report in a READ ONLY transaction and rejected cross-tenant access. Production reports represent recorded activity, not causal lift or profit. All 83 native files and dependencies unchanged; no cloud native builds, new migrations, production test writes or provider messages. Runtime remains at 66 migrations; seven unpublished order/contact migrations remain excluded.
