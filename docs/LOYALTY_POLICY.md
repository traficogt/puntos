# Loyalty Policy

This document records the current production behavior. It is not a roadmap.

## Purchases and awards

- Staff awards are idempotent when the same `txId` is replayed for the same business and customer.
- A replayed `txId` for a different business or customer is rejected.
- QR tokens are single-use. A reused QR token is rejected as replay.
- Pending points do not increase the spendable balance until settlement.

## Refunds and reversals

- A refund creates a reversal transaction linked to the original transaction.
- A transaction can only be reversed once.
- Refunding a posted transaction removes posted points from the customer balance.
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

## Partial refunds

- Partial refunds are not a first-class flow today.
- The current system models refunds as reversal of a full award transaction.
- If partial-refund support is needed later, it should be introduced as an explicit policy and schema change, not inferred ad hoc.

## Tiers

- Tier progression is checked after successful awards.
- Tier history is retained even if the customer later drops below a threshold.
- Downgrade timing remains program-driven and should not be changed silently without updating tests and this document.

## Challenges and achievements

- Item-, spend-, visit-, and points-based challenges are supported.
- Non-recurring challenges award when the threshold is crossed, not on every later event.
- Recurring challenges can complete once per active recurrence window, then reset on rollover.
- Achievement and challenge reward transactions persist source-transaction provenance for later reconciliation.

## Deleted customers and history

- Customer-facing auth is cleared when a customer record is deleted or no longer accessible.
- Historical financial and audit records remain part of system history unless an explicit data-retention process removes them.
- Analytics and exports must stay tenant-scoped even when the customer record is soft-deleted.
