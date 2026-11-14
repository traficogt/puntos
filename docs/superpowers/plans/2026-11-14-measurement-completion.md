# Campaign measurement completion implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development and independent scoped parallel work. Keep tests and review evidence with the release.

**Goal:** Complete the six approved measurement improvements in the website and backend.

**Architecture:** Extend the existing campaign contracts with a frozen plan, truthful event-time evidence, append-only cost/report revisions and a single-snapshot reporting query. Reuse fixed assignments, Wilson/Newcombe intervals, source-health checks and Mantine.

**Tech Stack:** Node 24, Express, Zod, PostgreSQL with forced tenant RLS, React/Mantine, node:test and Playwright.

## Work units and acceptance checks

- [x] Ingestion: `src/app/services/purchase-event.js`, POS/order/offline write paths and `2026-11-14-a-purchase-event-time.sql`. Write failing tests for missing/invalid/future dates, replay conflicts and old clients; preserve `created_at`; run unit and disposable database ingestion tests.
- [x] Pure models: `campaign-experiment-model.js` and unit tests. Check published two-proportion planning examples, unequal allocation and small audience; unknown versus explicit-zero costs; decisions cannot recommend profit from return-rate significance alone.
- [x] Persistence/API: `2026-11-14-b-campaign-measurement.sql`, growth/preparation services and growth routes. Validate identical creation/retry terms including plan; 50% allocation; frozen baseline; tenant-scoped append-only costs and report cuts; owner authorization, CSRF and idempotency tests.
- [x] Reporting: `campaign-report-service.js` plus existing measurement model. Single-snapshot event-time/refund cohorts; all-assigned denominators; matching and overlap diagnostics; original-group post-offer window; saved/current comparison. Test late purchases on boundaries, full/partial refunds, missing accounts, cross-tenant IDs, interrupted/ongoing campaigns and legacy fallback.
- [x] Owner website and demo: `GrowthCampaigns.jsx`, `CampaignResults.jsx`, new planner/cost components and `demo-growth.js`. Preview sample size before save, fixed terms on activation, clear decision first, data/cost/follow-up/report-history details. Test real form payloads and desktop/mobile rendering; preserve currency formatting and keyboard semantics.
- [x] Integration: run full root and merchant unit suites, typecheck, lint, migration lock, disposable full-schema/runtime-role integration tests and browser scenarios. Independent spec and code review; resolve findings.
- [x] Release: commit reviewed source, build web bundle, back up/verify database, apply additive migrations, deploy API/worker with rollback images. Verify public/site/article routes, production runtime privileges and health; push branch and reviewable PR. Do not run native workflows.

Existing baseline: 1,338 unit tests passed before changes. Explicit authorization covers implementation and necessary reversible web/server deployment. Existing root worktree changes are outside this branch and remain untouched.

## Completion evidence

Deployed API and worker source `b171569` on 2026-11-14. Backend unit suite: 1,374 passing; merchant suite: 136 passing. Ten full-schema measurement tests (including regenerated runtime privileges), 41 campaign regression tests plus two new legacy-plan regressions, three event-time/RLS tests and six Odoo core tests passed. Typecheck, lint, migration lock and desktop/mobile light/dark accessibility checks passed. Independent review closed all important findings. Verified database backup, two additive migrations, runtime read/insert privileges, live demo at 1440/390 pixels and ten public HTTP checks. Native files and cloud builds were untouched.

Operational evidence lives in `/var/lib/puntos/releases/measurement-completion-20261114/`; credentials and database backups are private, outside Git. Source changes were pushed on `feat/measurement-completion-20261114`, based on the article release branch so the published guide and five randomized future dates stay intact.
