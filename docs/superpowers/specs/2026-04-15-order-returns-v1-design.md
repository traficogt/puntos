# Order Returns v1 Design

## Goal

Add a first-class `order-returns` integration flow so refunded orders can reverse or cancel their loyalty effects in a controlled, auditable way.

## Decision

Build `order-returns` as a first-class object, not as an ad hoc order mutation or direct reversal shortcut.

v1 scope:

- full refunds only
- one return fully reverses one original order
- idempotent by return id
- pending order points are canceled
- posted order points are reversed
- if the reversal would push the customer below zero and business policy forbids it, reject the return for manual handling

Not in v1:

- partial refunds
- item-level return logic
- catalog-aware reversal logic
- automatic exception workflows for rejected returns

## API Contract

Add:

`POST /api/v1/public/order-returns`

Request body:

- `businessSlug`
- `externalReturnId`
- `externalOrderId`
- optional `reason`
- optional `occurred_at`
- optional `meta`

Rules:

- `externalReturnId` is required and merchant-scoped
- `externalOrderId` is required and must resolve to an existing order in the same business
- HMAC auth stays the same as Orders and other public integration routes
- idempotency key is `(business, externalReturnId)`

## Response Contract

Success response should include:

- `ok`
- `orderReturnId`
- `orderId`
- `customerId`
- `outcome`
  - `PENDING_CANCELLED` or `POSTED_REVERSED`
- `pointsEffect`
- `replay` when applicable

Errors:

- `400` for validation errors
- `401` for invalid signature
- `404` for missing business or missing original order
- `409` for idempotency conflicts, already-returned orders, or policy-driven manual handling cases

## Data Model

Add a new `order_returns` table.

Core fields:

- `id`
- `business_id`
- `customer_id`
- `order_id`
- `external_return_id`
- `external_order_id`
- `reason`
- `occurred_at`
- `meta`
- `fingerprint`
- `reversal_transaction_id`
- `points_effect`
- `outcome`
- timestamps

Constraints:

- unique `(business_id, external_return_id)`
- one full return per original order in v1

The original `orders` row remains the commerce record for the sale.
The new `order_returns` row becomes the commerce record for the refund.
The actual balance change still flows through the loyalty ledger and customer balance tables.

## Processing Rules

Processing flow:

1. authenticate request with HMAC
2. resolve business
3. lock on `(business, externalReturnId)` for idempotency
4. load the original order by `(business, externalOrderId)`
5. reject if missing
6. reject if already fully returned
7. inspect the original order’s linked loyalty transaction

Outcome rules:

- if original transaction status is `PENDING`
  - subtract the original points from `pending_points`
  - do not create a posted negative reversal transaction
  - outcome is `PENDING_CANCELLED`

- if original transaction status is `POSTED`
  - apply a reversal against the original transaction
  - if business policy allows negative refund balance, proceed
  - if business policy forbids negative refund balance and reversal would push the balance below zero, reject for manual handling
  - outcome is `POSTED_REVERSED`

## Accounting Behavior

v1 should reuse the existing ledger/refund model as much as possible.

That means:

- do not invent a second reversal style just for orders
- prefer using the current reversal transaction pattern where posted points are reversed through the ledger
- preserve `source = 'reversal'` style reporting compatibility where appropriate

The important distinction is:

- posted points become a real reversal event
- pending points are simply canceled before they ever become spendable

## Security

Security requirements:

- same public HMAC model as Orders
- tenant-scoped DB context before tenant reads and writes
- RLS coverage and app-role grants for the new table
- deterministic conflicts instead of silent double-processing
- no trust path weaker than existing public orders ingestion

## Open Questions Resolved

Resolved for v1:

- full refunds only
- businesses that forbid negative refund balances get a rejection for manual handling
- pending points are canceled, not reversed as posted negatives
- return idempotency uses both `externalReturnId` and `externalOrderId`, with `externalReturnId` as the unique replay key

## Implementation Notes

Likely change areas:

- `src/app/migrations/*order-returns*.sql`
- `src/app/repositories/order-return-repository.js`
- `src/app/services/order-return-service.js`
- `src/app/routes/order-return-routes.js`
- `src/app/routes/index.js`
- `src/scripts/create-app-role.mjs`
- `src/scripts/generate-openapi.mjs`
- targeted unit and integration tests

The service should keep the same boundary pattern as the rest of this integration work:

- route = auth, validation, HTTP mapping
- service = return business rules, idempotency, policy enforcement, ledger effect
- repository = `order_returns` persistence only

## Verification

Minimum verification for v1:

- create and replay the same return id cleanly
- reject the same return id with a different payload
- reject missing original order
- reject already-returned order
- cancel pending points correctly
- reverse posted points correctly
- reject when negative balance would be required and policy forbids it
- OpenAPI documents the new route and response shape

## Risks

Main v1 risk is policy friction when a business forbids negative refund balances and a customer has already spent the awarded points.

That is acceptable for v1 because:

- it avoids silent balance corruption
- it keeps the automated flow honest
- it leaves room for explicit manual handling or later exception tooling
