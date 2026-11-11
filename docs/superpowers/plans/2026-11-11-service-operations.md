# Merchant service operations implementation plan

> For agentic workers: use isolated parallel tasks with explicit ownership, followed by independent spec and quality reviews. The owner approved the proposed workflows and authorized useful extensions; no renewed design approval is needed.

**Goal:** Make recorded loyalty activity explainable, enable bounded service recovery and staff delegation, and turn operational evidence into actionable decisions without overstating data quality.

**Architecture:** Extend existing Express/Postgres tenant services, ledger adjustments, immutable cost history, React/Mantine owner UI and vanilla staff browser UI. Add only backward-compatible APIs/data. Use the existing merchant-web worktree and baseline-guarded runtime overlays; preserve unpublished order/contact exclusions. Native applications and cloud workflows remain untouched.

**Tech stack:** Express, Zod, PostgreSQL forced RLS, existing role/permission middleware and audit context, Mantine, Node tests, Playwright/axe.

## Approved design and boundaries

- Explanations use recorded inputs and allowlisted rule evidence. Future awards capture evaluated terms; historical records without evidence explicitly remain partial. Never reconstruct historical truth from today's configuration or expose program secrets/customer contact details.
- Service cases are durable, tenant-scoped, versioned and audited. Counter staff can report an unavailable/failed reward. A case can be fulfilled as originally promised, resolved with a documented agreed alternative, closed without compensation, or have points restored for a verified existing redemption. Claims and physical fulfillment are staff attestations, not automatically observed facts.
- Restoring points is an atomic, idempotent recorded ledger adjustment (zero lifetime-point change), never a silent balance edit. One redemption may be restored at most once. Existing cost snapshots remain immutable; resolution history records the correction. Do not infer entitlement from an uncompleted attempt.
- Owner-delegated authority is predefined and bounded: per staff member, optional existing branch, approved service action, points per action, total point allowance, start/end times and revocation. This is denominated in points, not an invented cash value. Grant consumption and recovery action commit together. All new service remedies require an online authenticated session.
- A shift briefing records acknowledgements and shows only changed published notices. Practice uses fictional local state and actual nonsecret program configuration; never writes balances, sends messages or claims real readiness.
- Decisions are deterministic evidence-backed records with stable keys, review/snooze lifecycle and clear next actions. Imported or stale/incomplete POS data must not masquerade as observed customer inactivity. Enforce a shared data-readiness gate before inactivity-based messaging; don't block unrelated transactional/authentication messages.
- Cost view distinguishes observed redemption costs, outstanding point scenarios, pending/reserved commitments and unknown costs. Avoid double counting refunded/restored rewards. Quiet/busy and collision extensions may be included only where enforceable with current channels and contracts; do not imply guaranteed Wallet delivery.

## Task 1 — Explain transactions (agent transaction_explanations)

- [x] Read points calculation, staff/external award paths and existing ledger schemas; write failing unit tests for historical unknown evidence, secret filtering, rounding/promotions and tenant boundaries.
- [x] Add `transaction-explanation-service.js`, a pure allowlisted rule-evidence helper, owner-only `transaction-explanation-routes.js`; modify only points-service/staff-award-service/external-award-service as required to capture exact evaluated evidence without changing awarded totals.
- [x] Add read-only paginated owner history/detail view `TransactionHistory.jsx`, demo module and focused browser/unit tests. Route target `#movimientos`. Include purchases, redemptions, reversals, opening balances and recorded adjustments; show limits of evidence and no invented rejection history.
- [x] Verify tests with a dedicated disposable database, full typecheck and local browser evidence. Do not edit shared route registry/nav/grants/checksums or staff redemption files.

## Task 2 — Resolve service cases (agent service_recovery)

- [x] Add failing tests for tenant/branch isolation, duplicates, stale case versions, concurrent restoration, insufficient/expired authority, audit rollback and reconciliation.
- [x] Add `2026-11-11-service-recovery.sql`, `service-recovery-service.js`, `service-recovery-routes.js`, and case/event tables with forced tenant RLS. Retain original evidence and append events.
- [x] Capture known staff redemption failures in the existing browser route without changing existing error contract; tolerate failure-to-record by preserving original error. Add optional case identifier. Do not claim HTTP rejection means points were deducted.
- [x] Implement owner and authorized staff resolution; restoration must reference a same-tenant successful redemption, deduplicate across cases, use ledger_balance_adjustments with delta_lifetime_points=0, and enqueue Wallet refresh transactionally. Consume delegated allowance through agreed helper; owners require no grant.
- [x] Add owner `ServiceCases.jsx`, isolated demo and a small staff case panel module. Agent owns `public/staff/index.js`, `public/staff.html`, staff service/routes; root coordinates other staff mounting.
- [x] Publish exact API/mount contracts and pending table grants to root. No production or real customer actions.

## Task 3 — Delegate and brief staff (agent staff_delegation)

- [x] Add tests for active/expired/revoked grants, same-tenant active staff/branch validation, action/per-use/total limits, atomic concurrent consumption, idempotency and owner override.
- [x] Add `2026-11-11-staff-delegation.sql`, `staff-delegation-service.js`, `staff-delegation-routes.js`, owner `StaffAuthority.jsx`, demo and tests.
- [x] Export `consumeServiceAllowance(client,{businessId,staff,action,points,requestId,now})` for `action='restore_redemption'`; use row locks, server clock, branch matching, strict integer bounds, unique consumption request identity and audit attribution. Return grant/remaining details. Owner is authorized after verifying live staff membership/role. Inform service_recovery agent of exact contract before dependent edits.
- [x] Owner creates/revokes bounded grants. Staff reads only own authority. Add published shift notices and acknowledgement with a clear version; bounded plain text, no private customer details.
- [x] Add separate `public/staff/service-briefing.js` and local fictional practice flow using actual program configuration. Do not edit `public/staff/index.js` or staff.html; give service_recovery agent/root the mount contract.

## Task 4 — Trustworthy decisions and cost scenarios (root)

- [x] Add pure data-readiness classification and tests: incomplete/stale automatic import vs manual/CSV absence of schedule, unknown history and recorded-data semantics.
- [x] Integrate data-readiness with recovery recommendations and inactivity message execution; exact durable suppression/pause reasons, no consent bypass and no paused authentication messages.
- [x] Add decisions inbox using current operations/service cases/cost evidence with bounded snooze lifecycle, stable keys, owner-only controls and Spanish `#decisiones` route. Start with actionable operational situations; snoozing never repairs the underlying issue.
- [x] Extend cost scenarios using entered assumptions and explicit source labels, preserving historical unknowns and showing service-restoration effects accurately.
- [x] Integrate nav/main/demo dispatch, router mounts, additive SQL lock and least-privilege grants after agent contracts are reviewed.

## Task 5 — Review, test and publish

- [x] Independent spec then quality reviews per domain; fix all material findings. Verify desktop/mobile/light/dark critical flows and errors, empty state, keyboard/contrast.
- [x] Full lint/typecheck/unit/merchant suites, focused real PostgreSQL concurrency/tenant/ledger tests and full-schema restricted-role smoke. No real merchant messages or rewards.
- [x] Snapshot baseline-scoped changed sources; preserve installed native API compatibility and unpublished route/migration exclusions. Build overlays from pinned live API/worker images only.
- [x] Verify production backup, apply additive migrations/grants, publish website/server, verify live demo/health/private endpoints, persist image selectors and baseline-guarded source sync. Report concrete changes and remaining limits.
