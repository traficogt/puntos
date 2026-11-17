# Loyalty Policy

This document records the current production behavior. It is not a roadmap.

## Purchases and awards

- Staff awards are idempotent when the same `txId` is replayed for the same business and customer.
- A replayed `txId` for a different business or customer is rejected.
- QR tokens are single-use. A reused QR token is rejected as replay.
- Pending points do not increase the spendable balance until settlement. Settlement adds them to the spendable balance and to lifetime (earned) points.

## Expiry

- Expiry is FIFO. Debits (redemptions, refunds, earlier expiries and negative adjustments) consume the oldest credits first, so only old credits that are still unspent can expire.
- When earned credits pass the expiry window, PF deducts at most the balance minus the earned credits newer than the window, and never more than the expiring credits. The deduction is a separate `expire` transaction; nothing is deducted when the old credits were already spent.
- Every credit past the window is marked `EXPIRED`, whether it was spent or not. Its original effect stays in the ledger.
- An expired award cannot be refunded or reversed; the request is rejected with 409.

## Refunds and reversals

- A refund creates a reversal transaction linked to the original transaction.
- A transaction can only be reversed once.
- Refunding a posted transaction removes posted points from the customer balance. An expired transaction cannot be refunded (see Expiry).
- Refunding a pending transaction removes pending points instead of posted points.
- Refunds recalculate derived customer state:
  - LTV
  - predicted LTV
  - churn risk
  - visit streaks
- Refunds also reconcile gamification state:
  - achievements can be revoked if the customer no longer qualifies
  - non-recurring challenges can be revoked if the refunded activity was qualifying
  - recurring challenges can be revoked within the active recurrence window
  - referral rewards earned by a purchase are reversed on both sides, and the referral returns to pending, when the referred customer's remaining settled, unrefunded purchases no longer meet the minimum that applied. Signup rewards are not reversed. If the referrer's balance cannot cover the reversal and the business does not allow negative balances on refund, both rewards are kept.

## Referrals

- Disabling the referral program, or a plan without referrals, stops new codes from being applied and pays nothing for pending referrals; they stay pending. Rewards already paid are not reversed.
- A purchase minimum counts only settled purchases that were not refunded; purchases whose points are still pending do not count.

## Partial refunds

- Partial refunds are not a first-class flow today.
- The current system models refunds as reversal of a full award transaction.
- If partial-refund support is needed later, it should be introduced as an explicit policy and schema change, not inferred ad hoc.

## Tiers

- Tiers are based on earned points, never on the spendable balance. In lifetime mode this is `lifetime_points`; in a rolling window it is the sum of positive, non-reversal `POSTED` or `EXPIRED` credits inside the window. Redemptions and expiry do not reduce it; refunded awards do.
- Tier upgrades are checked after successful awards, after pending points settle, and whenever the customer's tier is read. Downgrades happen only in the rolling-window retention sweep.
- Tiers do not multiply points. Each tier stores a `points_multiplier`, but the award engine does not apply it, and default tier perks do not advertise one. Applying multipliers requires an explicit product decision, implementation and tests.
- Tier history is retained even if the customer later drops below a threshold.
- Downgrade timing remains program-driven and should not be changed silently without updating tests and this document.

## Challenges and achievements

- Item-, spend-, visit-, and points-based challenges are supported.
- Non-recurring challenges award when the threshold is crossed, not on every later event.
- Recurring challenges can complete once per active recurrence window, then reset on rollover. Daily, weekly and monthly windows follow the business's local time zone (weeks start on Monday), and unfinished progress does not carry over to the next window.
- Achievement and challenge reward transactions persist source-transaction provenance for later reconciliation.

## Deleted customers and history

- Customer-facing auth is cleared when a customer record is deleted or no longer accessible.
- Historical financial and audit records remain part of system history unless an explicit data-retention process removes them.
- Analytics and exports must stay tenant-scoped even when the customer record is soft-deleted.
