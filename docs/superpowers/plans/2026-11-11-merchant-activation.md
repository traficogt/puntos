# Merchant activation implementation plan

> For agentic workers: use subagent-driven-development and independent review. The user approved the seven-part proposal with “Implement”; proceed within the existing website/server release boundary.

**Goal:** Make existing PF capabilities discoverable and useful: public demo, understandable reward exposure, email owner briefing, contextual Wallet passes, staff activity, currency onboarding and reviewed second-visit presets.

**Architecture:** Extend the existing Express/PostgreSQL services, durable outboxes, Mantine merchant UI and vanilla public site. Keep unknown costs explicit, communications opt-in, recipient ownership verified, and ledger/native contracts backward compatible. Use the existing isolated merchant-web worktree and guarded derivative-image deployment; preserve seven unpublished order/contact migrations and routes.

**Tech stack:** Node24/Express4, PostgreSQL16 with tenant RLS, React/Mantine/Recharts, Luxon, Nodemailer, existing Apple/Google Wallet providers, Playwright.

## Approved requirements and ownership

### Public demo, currency onboarding, integration — root
- Make the interactive demonstration primary on homepage navigation/hero; retain contact as a secondary action. Add an honest plan comparison using existing configured entitlements/prices; never invent commercial rates. Surface public plans with Spanish routes if usable configured price data exists, otherwise clearly indicate quotation and inclusions.
- Add a visible merchant onboarding path from the overview to currency review, briefing opt-in and second-visit configuration. Region confirmation must explain when denomination locks; keep it editable before relevant activity and protected afterward. Preserve existing GET/PUT region compatibility.
- Measure demo entry and meaningful fixture interaction without sending fixture/customer data or requiring registration; use the existing analytics framework if present, otherwise bounded first-party aggregate events with no identities. Never imply inferred inquiries became merchants.
- Own shared Overview integration after the reporting agent creates its isolated panels, main.jsx/demo dispatcher, shared routes/grants/checksums and release scripts. Coordinate any shared file edits.

### Owner briefing and second-visit preset — briefing agent
- Extend weekly-owner-brief-service and UI from phone-only to email-first for new opt-ins. Bind delivery to the authenticated owner’s verified address; do not allow arbitrary business recipients. Keep existing phone settings/queued records working.
- Reuse auth verification/outbox mechanisms where available; expose delivery readiness separately from verified ownership. Provide preview and explicit test-send UI with strict rate/idempotency controls; no provider sends during development.
- Default OFF; onboarding calls attention to opt-in. Preserve claim fencing, suppress on recipient/role/settings change, never retry uncertain acceptance automatically. Record channel in durable messages if required.
- Add reviewed recommendations to SecondVisitControls using current earning/reward economics. Show bonus, expiry, issuance/points caps and maximum commitment; require owner activation, no universal point value or guaranteed return. Honest fallback when costs/earning data missing.
- Own new migrations/routes/services/UI/tests in this domain; no shared route registry/grants/checksum/Overview edits without coordination.

### Honest reward exposure and staff activity — insights agent
- Produce read-only owner overview panels and service endpoints for issued outstanding entitlements, known estimated fulfillment cost and missing-cost coverage. Separate issued hospitality from points-based choices; avoid counting alternate protected promises as independent liabilities. Reuse recorded original terms and current cost assumptions with explicit provenance.
- Show outstanding-points scenario separately from issued entitlements and actual redeemed historical cost. Missing cost is unknown, not zero; no formal liability or generated-revenue claims. Link to detailed economics view.
- Show this local week’s staff awards, recorded purchases, manual adjustments and reversals from ledger; retain unmapped/POS activity as a separate source. Comparisons must contextualize transaction volume and never label raw-volume outliers as fraud. Owner-only, tenant/branch bounded, drill-down into existing transaction history.
- Own isolated services/routes/components/demo/tests; coordinate root Overview insert contract. No writes to ledger, no shared registry/grants changes.

### Wallet enrichment — wallet agent
- Enrich authoritative pass snapshots with eligible next reward progress, original protected terms, availability and branch-relevant locations; available/pending points remain distinct. Do not fabricate progress from pending points or offer unavailable rewards.
- Apple/Google templates show concise Spanish progress/account links and location relevance. Existing primary balance already present. Preserve package validity and object identity/revocation/privacy.
- Treat pass refresh separately from visible notification. Add supported meaningful update notification behavior only with durable dedupe/quota/settings controls; avoid a recurring promotional push loop. Confirm current official provider docs, no unsupported delivery guarantees.
- Provide merchant location configuration only if missing, owner validated coordinates, at most provider-supported limits. Do not infer customer location or change native projects.
- Unit/contract tests for payloads, eligibility, rules/availability refresh, revocation, changes and retry; describe required real-device acceptance without claiming it ran. No real provider campaign sends during development.

## Execution and validation

- [x] Record implementation contracts and isolated test databases per domain.
- [x] Demonstrate failing then passing tests for permission, verification, channel migration, stale claim/recipient, idempotency and recommendation guards.
- [x] Demonstrate read-only exposure reconciliation and staff attribution against PostgreSQL, including missing cost, competing reward choices, reversals, tenant boundaries and local-week timezone.
- [x] Wallet payload, eligibility, update invalidation and duplicate/quota behavior verified; native baseline unchanged.
- [x] Public demo/plan navigation, currency acknowledgment and onboarding flows implemented without registration or fabricated commercial facts.
- [x] Independent specification and code review; resolve material findings.
- [x] Full unit, merchant, lint/type checks; targeted PostgreSQL; fresh complete runtime schema and restricted-role smoke.
- [x] Desktop/mobile light/dark browser flows, accessibility and screenshots checked; existing typography retained.
- [x] Scoped manifests/checksums, verified backup, additive runtime migration/grants, API/worker deployment and live verification.
- [x] Persist image selectors, synchronize only baseline-guarded source, verify native hashes and document remaining physical-device/provider acceptance.
