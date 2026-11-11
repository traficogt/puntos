# Research findings: visible member value and bounded hospitality

Implement the three additions approved by the owner after the Points literature review. Website and server only; preserve native apps and existing API contracts. Extend existing surfaces and controls rather than create another rewards engine.

## Customer statement

Add a read-only, tenant-scoped 30-day statement to the customer's activity screen. Summarize points awarded, used for rewards, actually deducted through expiry, and signed corrections separately. Include pending points separately and explain that points are not a cash balance. Use all matching ledger records, not the existing 50-row history page. A reversed original and its reversal must not double-count a refund; pending reversals must not appear as earned points. Do not invent an opening balance from incomplete mutable settlement history, expose merchant cost data, or claim monetary savings. State the reporting interval and snapshot timestamp. Include completed reward counts without counting cancelled/restored redemptions. Cached statements must remain tied to the customer and visibly stale offline.

## Visits after redemption

Add an owner-only analytics report with an explicit cohort and 30-day follow-up. Each customer enters once, on their first eligible completed redemption in the selected cohort window. Count a return only from a genuine, nonreversed purchase on a later business-local calendar day, within 30 days. Separate fully observed cohorts from customers still being followed; use the full matured cohort as denominator. Include freshness/limitations and label association, not causal or incremental revenue. All branches by default; any branch filter must be validated and consistently applied. Reuse existing purchase and refund conventions. Read-only SQL and no new schema unless evidence demands it.

## Hospitality pilot

Use existing grants as bounded trials. Keep atomic issuance ceilings, assignment permissions, idempotency and earned entitlements intact. Improve owner setup with a small optional preset derived from the selected reward's known cost, a whole-unit ceiling, and an honest preview of the maximum issuable units and commitment. Add all-record aggregates per grant: issued, fulfilled, expired unused and pending; committed ceilings and known cost estimates remain distinct. Unknown historical costs remain unknown, never zero. Never infer ROI or visits caused by a courtesy. Issued promises remain valid if a grant is stopped.

## Delivery

Use the established visual design and fonts, Mantine merchant components and existing customer components. Add loading, empty, error and offline states. Test ledger edge cases, tenant/role isolation, cohort boundaries, caps and mobile layouts. Deploy a scoped overlay over the current 66-migration runtime, keeping seven unpublished source migrations and native files excluded. Record source hashes and rollback image before release.
