# Consistent purchase reporting and useful owner findings

Approved scope: implement next priorities 1 and 2. Defer articles. Website/server only; no native changes, native builds, new marketing opt-ins, provider test messages or production test transactions.

## Reporting contract

A recorded purchase has source online/offline/external/order, type PURCHASE or legacy null, positive amount/visits/items, no original/reversal linkage, and status POSTED/PENDING/EXPIRED. Expiring loyalty points does not undo a sale. Exclude reversed purchases, reversal rows, redemption/expiry/bonus/adjustment entries, imported balances and empty awards. Preserve each report's dates, branches, audiences and denominators; different windows need not have equal totals.

Use a shared reporting-only SQL predicate. Apply it to the merchant overview, campaign outcome report, redemption-return report and other read-only purchase aggregates found during the audit. Do not change awarding, eligibility, balances, point expiration or marketing selection as a side effect. Weekly activity separates confirmed purchases (POSTED or EXPIRED) from purchases with pending points. Keep response fields backward compatible. Record any intentionally different financial/ledger computations in the implementation notes.

## Owner findings

Extend existing decisions and weekly summaries with a common evidence builder and deterministic Spanish copy:

- Missing current reward costs: active, unexpired rewards without entered cost. Preserve the existing inbox economics warning instead of duplicating it. Historical unknown costs remain unknown. Action opens costs.
- Unused courtesies: entitlements whose expiry falls in the previous 30 elapsed days, with fulfilled versus expired-unused counts from the entire cohort. Show counts and reserved ceilings, explicitly distinct from realized fulfillment costs. No automatic reissue, refund or budget increase. Action opens hospitality results.
- Visits after redemption: reuse the tested 90-day cohort/30-day follow-up report. Show matured returned/total and ongoing separately; no lift/ROI or universal success threshold. Hide this suggested review when activity data is blocked. Action opens the actual report.

Only show findings with supporting observations. Owner actions are review links; existing review/snooze behavior remains. Fingerprints use substantive evidence, not request timestamps, so refreshing does not reopen unchanged items. Actual evidence changes reopen them. Date/window metadata is visible and raw evidence remains additive in API responses. Analytics plan gates apply to new analytical findings.

Weekly briefs stay at three findings. Prioritize blocked data and uncertain/failed messages, then missing costs, unused courtesies and completed return cohorts; retain existing activity/second-visit/budget fallbacks. Include a link to the decisions inbox when further findings exist. Preserve saved snapshots, recipient verification, opt-in, deduplication, retry semantics and authenticated action links. Preview never sends. Stored past emails are not rewritten.

## Delivery and verification

Use incumbent Mantine/Spanish UI and fonts. Explain evidence and coverage near actions. Implement direct navigation to the return report without altering existing hash routes. Check mobile/desktop light/dark, keyboard focus, loading/error states and fictional demo behavior. Verify with isolated PostgreSQL that expiry changes neither purchase totals nor campaign returns; corrections still remove purchases. Test stable review fingerprints, stale-data suppression, priority ordering and actual email rendering using a fake provider only.

Ship a baseline-scoped overlay over `puntos-api:member-value-20261111`, preserving 66 runtime migrations and seven unpublished order/contact exclusions. Backward-compatible read paths only; retain rollback and verify restricted-role reads, native-file hashes and live demo.
