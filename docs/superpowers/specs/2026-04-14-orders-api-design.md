# Orders API Design

Date: 2026-04-14

## Goal

Add a first-class Orders API so external systems can send completed sales to PuntosFieles and have points posted automatically without cashier-side manual award entry.

This first increment is intentionally narrow:

- server-to-server ingestion only
- create-and-process in one call
- customer resolution by `customerId` or `customerPhone`
- idempotent order creation
- one linked loyalty transaction per processed order
- line items stored for future use, but not yet used for scoring

Out of scope for this increment:

- POS-specific adapters
- CSV imports
- refund or return flows
- partial refunds
- item/category-based scoring
- cashier UI changes
- async create-then-process pipeline

## Product Intent

Today the core loyalty flow is QR scan plus manual award inputs such as spend, visits, or item count. That is commercially usable, but it makes loyalty a cashier action rather than a sale-system side effect.

The Orders API shifts that model for integrated merchants:

1. The merchant system completes a sale.
2. The merchant system sends the normalized order to PuntosFieles.
3. PuntosFieles stores the order idempotently.
4. PuntosFieles resolves the customer.
5. PuntosFieles computes points from the order total.
6. PuntosFieles creates a linked loyalty transaction and updates balance state.

Manual cashier awards remain supported as a fallback for merchants without integrations.

## Approach Options

### Recommended: first-class orders model

Store orders separately and create one linked loyalty transaction from each processed order.

Pros:

- clear audit trail
- clean path to refunds and imports later
- supports richer item data now without changing scoring rules yet
- avoids overloading the loyalty ledger with commerce concerns

Cons:

- requires a new table, service, and endpoint
- more work than wrapping the existing transaction flow directly

### Faster alternative: direct-to-transaction wrapper

Accept an order-shaped payload but translate it immediately into the current transaction model without storing an order record.

Pros:

- faster to ship
- minimal schema change

Cons:

- weak foundation for refunds
- poor order-level auditability
- line-item storage becomes awkward
- harder to evolve safely

### Deferred pipeline: create then process

Store orders first, then process them in a second step.

Pros:

- more flexible for async integrations
- good for retry-heavy integrations and human review flows

Cons:

- more moving parts than needed for v1
- unnecessary operational complexity for the current goal

## Architecture

Add a new Orders domain with three pieces:

### 1. Orders storage

A new `orders` table stores normalized upstream commerce records.

Each row represents one external order for one business and one resolved customer.

### 2. Orders processing service

A dedicated service validates the payload, resolves the customer, enforces idempotency, stores the order, computes points, and creates one linked loyalty transaction.

The service should not depend on HTTP concerns directly so it can later be reused by CSV import jobs or adapter workers.

### 3. Orders ingestion route

A single external server-to-server endpoint accepts the order payload and invokes the processing service.

This route should follow the same general trust model as the current external award ingestion path:

- merchant-scoped secret
- signature verification
- rate limiting
- explicit error codes for replay, missing customer, and invalid payload

## API Shape

### Endpoint

Use one create-and-process endpoint in the public integration surface.

Recommended path:

- `POST /api/v1/public/orders`

This keeps the initial external surface explicit and consistent with other server-to-server ingestion endpoints.

### Request body

Required:

- `businessSlug`
- `externalOrderId`
- `status`
- `amount_q`
- either `customerId` or `customerPhone`

Optional:

- `subtotal_q`
- `discount_q`
- `tax_q`
- `currency`
- `occurred_at`
- `items`
- `meta`

### Suggested payload shape

```json
{
  "businessSlug": "cafe-demo",
  "externalOrderId": "pos-12345",
  "customerPhone": "+50255554444",
  "status": "paid",
  "amount_q": 48.5,
  "subtotal_q": 44,
  "discount_q": 0,
  "tax_q": 4.5,
  "currency": "GTQ",
  "occurred_at": "2026-04-14T18:35:00Z",
  "items": [
    {
      "code": "LATTE-12OZ",
      "name": "Latte 12oz",
      "category": "coffee",
      "quantity": 2,
      "unit_price_q": 18,
      "line_total_q": 36
    },
    {
      "code": "CROISSANT",
      "name": "Croissant",
      "category": "pastry",
      "quantity": 1,
      "unit_price_q": 8,
      "line_total_q": 8
    }
  ],
  "meta": {
    "source": "pos",
    "location_code": "zona-10"
  }
}
```

## Customer Resolution

Customer lookup supports both:

- `customerId`
- `customerPhone`

Resolution rules:

1. If `customerId` is present, use it first.
2. If `customerId` is absent or does not resolve, and `customerPhone` is present, look up by phone within the business.
3. If neither resolves a valid customer in that business, return `404`.

The API must not silently create customers in this first increment.

That keeps the scope predictable and avoids hidden account-creation side effects in server-to-server order ingestion.

## Processing Rules

### Supported statuses

For v1, process only final, awardable order states:

- `paid`
- `completed`

Reject non-final states such as:

- `pending`
- `open`
- `cancelled`
- `voided`

Canonical rule for v1:

- accept `paid` and `completed`
- reject everything else with `400`

### Scoring behavior

In v1, scoring uses the order total only.

That means the processing service maps the order into the existing spend-based award calculation:

- `amount_q` is the scoring input
- `items` are stored but do not influence scoring yet

This preserves current earning semantics while giving the system richer purchase context for future rules.

### Loyalty side effect

Each successfully processed order creates exactly one linked loyalty transaction in v1.

The transaction:

- uses the computed points
- respects the business pending-points hold policy if configured
- updates customer balances through the existing ledger logic

## Idempotency

Idempotency key:

- `(business_id, external_order_id)`

Behavior:

- If the same order id is received again with the same normalized payload, return success with `replay: true`.
- If the same order id is received again with a different normalized payload, return `409`.

The normalized payload fingerprint should include:

- resolved customer id
- status
- amount fields used for scoring and recordkeeping
- currency
- occurred timestamp if present
- normalized line items
- normalized metadata

This is stricter than comparing only awarded points and prevents accidental double-use of a merchant order id.

## Data Model

Add an `orders` table with fields conceptually like:

- `id`
- `business_id`
- `customer_id`
- `external_order_id`
- `status`
- `amount_q`
- `subtotal_q`
- `discount_q`
- `tax_q`
- `currency`
- `occurred_at`
- `source`
- `line_items_json`
- `meta`
- `transaction_id`
- `created_at`
- `updated_at`

Constraints:

- unique `(business_id, external_order_id)`
- foreign keys to business, customer, and transaction

In v1, one order maps to one transaction, so `transaction_id` on the order is sufficient.

If the product later supports multiple loyalty side effects per order, that relationship can evolve into a join table or order-events table.

## Auth And Security

Use server-to-server authentication aligned with the current external ingestion model.

Recommended v1:

- HMAC signature over raw request body
- merchant-scoped secret selected by `businessSlug`

This is preferable to cookie auth because this endpoint is for external systems rather than first-party browser clients.

Baseline protections:

- rate limiting
- raw-body signature verification
- constant-time signature comparison
- explicit audit logging for replay and signature failures

## Response Shape

Successful first processing:

```json
{
  "ok": true,
  "orderId": "uuid",
  "transactionId": "uuid",
  "customerId": "uuid",
  "pointsAwarded": 5,
  "status": "POSTED",
  "replay": false
}
```

Replay success:

```json
{
  "ok": true,
  "orderId": "uuid",
  "transactionId": "uuid",
  "customerId": "uuid",
  "pointsAwarded": 5,
  "status": "POSTED",
  "replay": true
}
```

## Error Handling

Use clear API semantics:

- `401` invalid or missing signature
- `404` unknown business
- `404` customer not found in business
- `409` same `externalOrderId` but different payload
- `400` invalid payload or unsupported status

No silent drops.
No implicit customer creation.
No best-effort partial processing.

## Testing Strategy

### Unit tests

Add tests for the processing service covering:

- customer resolution by `customerId`
- fallback customer resolution by `customerPhone`
- `404` when customer is not found
- first-time order success
- replay success for identical payload
- `409` conflict for changed payload
- unsupported order status rejection
- line items persisted but ignored in scoring

### Integration tests

Add route-level tests covering:

- HMAC validation
- order ingestion success
- order row persisted
- linked transaction created
- customer balance updated

### OpenAPI contract tests

Update OpenAPI generation and contract coverage so the endpoint is documented with:

- request schema
- security behavior description
- success and error response shapes

## Rollout Notes

This increment should not change the existing cashier award flow.

Merchants without integrations continue using:

- QR scan
- manual award entry

Merchants with integrations can instead use:

- customer identification
- sale completion in their system
- automatic order push to PuntosFieles
- automatic loyalty posting

That makes the Orders API an additive capability rather than a breaking workflow change.

## Success Criteria

This increment is successful if:

- an external system can send one completed order in one request
- PuntosFieles stores the order idempotently
- PuntosFieles resolves the customer by `customerId` or phone
- PuntosFieles posts points automatically from the order total
- duplicate sends do not create duplicate transactions
- changed duplicate payloads are rejected clearly
- existing cashier award flows remain intact
