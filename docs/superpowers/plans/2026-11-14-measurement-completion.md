# Campaign measurement completion implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development and independent scoped parallel work. Keep tests and review evidence with the release.

**Goal:** Complete the six approved measurement improvements in the website and backend.

**Architecture:** Extend the existing campaign contracts with a frozen plan, truthful event-time evidence, append-only cost/report revisions and a single-snapshot reporting query. Reuse fixed assignments, Wilson/Newcombe intervals, source-health checks and Mantine.

**Tech Stack:** Node 24, Express, Zod, PostgreSQL with forced tenant RLS, React/Mantine, node:test and Playwright.

## Work units and acceptance checks

- [ ] Ingestion: `src/app/services/purchase-event.js`, POS/order/offline write paths and `2026-11-14-a-purchase-event-time.sql`. Write failing tests for missing/invalid/future dates, replay conflicts and old clients; preserve `created_at`; run unit and disposable database ingestion tests.
- [ ] Pure models: `campaign-experiment-model.js` and unit tests. Check published two-proportion planning examples, unequal allocation and small audience; unknown versus explicit-zero costs; decisions cannot recommend profit from return-rate significance alone.
- [ ] Persistence/API: `2026-11-14-b-campaign-measurement.sql`, growth/preparation services and growth routes. Validate identical creation/retry terms including plan; 50% allocation; frozen baseline; tenant-scoped append-only costs and report cuts; owner authorization, CSRF and idempotency tests.
- [ ] Reporting: `campaign-report-service.js` plus existing measurement model. Single-snapshot event-time/refund cohorts; all-assigned denominators; matching and overlap diagnostics; original-group post-offer window; saved/current comparison. Test late purchases on boundaries, full/partial refunds, missing accounts, cross-tenant IDs, interrupted/ongoing campaigns and legacy fallback.
- [ ] Owner website and demo: `GrowthCampaigns.jsx`, `CampaignResults.jsx`, new planner/cost components and `demo-growth.js`. Preview sample size before save, fixed terms on activation, clear decision first, data/cost/follow-up/report-history details. Test real form payloads and desktop/mobile rendering; preserve currency formatting and keyboard semantics.
- [ ] Integration: run full root and merchant unit suites, typecheck, lint, migration lock, disposable full-schema/runtime-role integration tests and browser scenarios. Independent spec and code review; resolve findings.
- [ ] Release: commit reviewed source, build web bundle, back up/verify database, apply additive migrations, deploy API/worker with rollback images. Verify public/site/article routes, production runtime privileges and health; push branch and reviewable PR. Do not run native workflows.

Existing baseline: 1,338 unit tests passed before changes. Explicit authorization covers implementation and necessary reversible web/server deployment. Existing root worktree changes are outside this branch and remain untouched.
