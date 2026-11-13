# Complete owner, manager, and platform operations

> **For agentic workers:** Use superpowers:subagent-driven-development, with isolated branches for the independent tracks below. The user has expressly approved implementing the full twelve-feature specification and completing previously partial implementations; do not repeat approval gates.

**Goal:** Complete all twelve approved workflows in the browser product and shared server, preserving installed native clients.

**Architecture:** Extend existing Express services, PostgreSQL append-only histories, tenant context and Mantine screens. Add migrations, never edit deployed migrations. Reuse current reward promises, hospitality, ledger corrections, POS evidence, campaign guardrails and import jobs. Keep estimates distinguishable from observations; retain existing earned promises.

**Tech Stack:** Existing Node/Express, PostgreSQL, Zod, React/Mantine, vanilla staff/customer/admin screens, node:test and Playwright. No new frameworks or native builds.

## Completion criteria per feature

- [ ] 1 Decisions: evidence-backed inbox with actionable impact/cost or explicit unknown; assignment to same-business staff/manager, dismiss reason, snooze/reopen, changed evidence reopens; staff can access only delegated decisions. Optimistic concurrency, audit history.
- [ ] 2 Commitments: separately show promised units, customer retail value, entered fulfillment costs and missing coverage for active promises/courtesies/offers. Point balances remain a separate scenario, never double counted as guaranteed rewards. Snapshot issue-time values; do not rewrite historical unknowns. Scenarios explicitly estimates, currency-aware.
- [ ] 3 Operating switch: quiet/normal/busy, automatic expiry, capacity and owner-preapproved capped offers. Authorized managers trigger approved templates with fixed audience and economic boundaries. Busy pauses unsent invitations without revoking issued entitlements.
- [ ] 4 Collision checker: preview simultaneous campaign contacts, stacking, location eligibility/availability, tier benefits, and most generous supported combination for entered sample purchase. Unknown external discounts remain explicitly unknown. Explain remediation and enforce hard caps at write time.
- [ ] 5 Demand notebook: staff and signed-in customer requests, controlled categories and notes, optional reward/product context, grouped counts/deduplication by member/topic, merchant triage and follow-up. Explicit requests are not guaranteed purchases or representative market research.
- [ ] 6 Supplier funding: merchant-managed supplier agreements, eligible rewards/dates, funding cap, immutable redemption claims/evidence, submitted/approved/rejected/paid transitions and reconciliation. No customer identities in sponsor exports. Claims must reference real eligible fulfilled redemptions and reserve funding atomically; no fabricated receivables.
- [ ] 7 Briefing/practice: automatically show changed active offers, unavailable rewards/substitutes, cases and rule versions; private acknowledgements by version. Practice real configuration without live mutations, including ineligibility and refund.
- [ ] 8 Delegation: action/location/time/frequency/points/cost limits enforced transactionally for service recovery and approved operational actions; expiring grants, owner-only rule changes, escalation pattern suggestions grounded in records.
- [ ] 9 Recovery: durable case assignment/escalation, reasons aggregation, real approved substitute and original-promise fulfillment, explicit expiry extension preserving issued terms, audited balance restoration. Distinguish attempted/code-generated/attested/fulfilled evidence.
- [ ] 10 Explanation: recorded award/redemption/rejection/reversal inputs and events, rule version and links, read-only historical replay using saved evidence with unsupported historical records clearly marked. Safe corrections append recorded adjustments; never rewrite ledger.
- [ ] 11 Health: platform-admin cross-merchant health plus owner freshness; source-specific expected sync deadlines/heartbeat for connected systems, branch visibility when recorded; stale/incomplete ingestion pauses inactivity recommendations and messaging, not earned rewards. Do not equate no observed sales with outage.
- [ ] 12 Rehearsal/migration: fictional signup/earn/unlock/redeem/refund from real configuration with persistent completion; configuration blockers include staff ability and descriptive rule checks. Preview/deduplicate imports with approved paper-card progress conversion and evidence/source recording; no unapproved merging or photo-as-proof.

## Tracks and ownership

A: owner controls 1–4; merchant decisions/economics/campaign preflight services and their existing components. New migration 2026-11-13-owner-operations.sql. Preserve new subsystem references until integrated.
B: demand and funding 5–6; new services/routes/components; customer/staff demand entry isolated module. New migration 2026-11-13-demand-funding.sql. Coordinate funding summaries with A.
C: staff/recovery/activation 7–9 and 12; delegation/recovery/promise/launch/migration services and screens. New migration 2026-11-13-service-completion.sql. Coordinate manager permissions with A and event evidence with root.
Root: explanation and health 10–11; central API registry, navigation/screen registry, demo integration, migration lock and full verification/release. New migration 2026-11-13-evidence-health.sql.

## Execution and verification

- [ ] For each track, add behavior regressions that fail before changes; run unit and isolated PostgreSQL integration checks including cross-tenant denial, invalid transitions, retries/concurrent limits and rollback on audit failure.
- [ ] Integrate new routers and Spanish navigation; maintain legacy API behavior and avoid apps/customer changes.
- [ ] Review each track against its full criteria, then inspect permission boundaries, concurrency, money rounding, evidence provenance and error paths; fix review findings.
- [ ] Build merchant browser bundle; run lint, typecheck, migration lock checks and relevant existing/new unit/integration suites. Use a new isolated DB, never production for tests.
- [ ] Browser verification of all twelve workflows including small-screen controls, empty/error states, actual API-backed persistence in isolated runtime, and no live customer messages.
- [ ] Back up production DB; apply additive migrations with established deployment tools; deploy API/worker/browser artifacts preserving Pertenece and native compatibility. Verify live endpoints and record release/rollback evidence.
- [ ] Push branch/PR without triggering native workflows; report feature entry URLs, verification evidence and any actual external acceptance limits precisely.
