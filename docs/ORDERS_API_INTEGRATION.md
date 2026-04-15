# Orders API Integration Guide

This guide is for merchants or middleware providers who want to move from cashier-entered loyalty awards to API-driven order ingestion.

The current manual flow is:

1. Customer shows QR
2. Cashier scans QR
3. Cashier enters amount, visits, or item count
4. Puntos posts points

The Orders API changes that to:

1. Customer is identified during checkout
2. Sale is completed in the POS or backend
3. The merchant system sends the finalized order to Puntos
4. Puntos stores the order and posts points automatically

## Endpoint

- `POST /api/v1/public/orders`

This is a server-to-server endpoint. It is not meant to be called directly from the browser or cashier UI.

## What The Merchant System Must Send

Required fields:

- `businessSlug`
- `externalOrderId`
- `status`
- `amount_q`
- one of:
  - `customerId`
  - `customerPhone`

Supported statuses in v1:

- `paid`
- `completed`

Optional fields:

- `subtotal_q`
- `discount_q`
- `tax_q`
- `currency`
- `occurred_at`
- `items`
- `meta`

## Minimal Request Example

```json
{
  "businessSlug": "cafe-demo",
  "externalOrderId": "pos-12345",
  "customerPhone": "+50255554444",
  "status": "paid",
  "amount_q": 48.5
}
```

## Full Request Example

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
  "occurred_at": "2026-04-15T18:35:00Z",
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
    "location_code": "zona-10",
    "cashier_id": "cashier-7"
  }
}
```

## Authentication

The route uses HMAC-SHA256 over the raw request body.

Header:

- `x-signature: <hex digest>`

`sha256=<hex digest>` is also accepted.

Important:

- Compute the HMAC over the exact raw JSON string being sent.
- Do not sign a prettified version and send a minified version.
- Do not reserialize after signing.

The server selects the secret by `businessSlug` from:

```env
PAYMENT_WEBHOOK_HMAC_SECRETS={"cafe-demo":"replace-with-long-random-secret"}
```

## Node Example For Signing

```js
import crypto from "node:crypto";

const secret = process.env.PUNTOS_ORDER_SECRET;
const body = JSON.stringify({
  businessSlug: "cafe-demo",
  externalOrderId: "pos-12345",
  customerPhone: "+50255554444",
  status: "paid",
  amount_q: 48.5
});

const signature = crypto
  .createHmac("sha256", secret)
  .update(body)
  .digest("hex");
```

Then send:

```http
POST /api/v1/public/orders
Content-Type: application/json
x-signature: <signature>
```

with `body` as the request payload.

## cURL Example

```bash
BODY='{"businessSlug":"cafe-demo","externalOrderId":"pos-12345","customerPhone":"+50255554444","status":"paid","amount_q":48.5}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$PUNTOS_ORDER_SECRET" -hex | sed 's/^.* //')

curl -X POST "https://app.example.com/api/v1/public/orders" \
  -H "Content-Type: application/json" \
  -H "x-signature: $SIG" \
  --data "$BODY"
```

## Response Shape

First successful processing:

```json
{
  "ok": true,
  "orderId": "uuid",
  "transactionId": "uuid",
  "customerId": "uuid",
  "pointsAwarded": 5,
  "status": "POSTED"
}
```

Replay of the same order:

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

If the business uses pending points hold days, `status` can be `PENDING` instead of `POSTED`.

## Error Handling

- `400`: invalid payload or unsupported status
- `401`: invalid or missing HMAC signature
- `404`: business not found
- `404`: customer not found for that business
- `409`: same `externalOrderId` was reused with a different payload

## Idempotency Rule

Orders are deduplicated by:

- `business`
- `externalOrderId`

That means:

- retries are safe if the payload is logically the same
- changed payloads for the same `externalOrderId` are rejected

Use one stable order id from the source system.

Good examples:

- POS ticket id
- ecommerce order id
- payment provider merchant reference

Bad examples:

- a random id generated on each retry
- a timestamp generated on each request

## Customer Identification

You have two integration choices.

### Option A: `customerId`

Best if your system already stores the Puntos customer id.

Use this when:

- you have already linked the customer record earlier
- you want exact lookup with no phone matching ambiguity

### Option B: `customerPhone`

Best for the first pilot if the POS already captures phone numbers.

Use this when:

- the cashier or customer enters phone at checkout
- you do not yet store Puntos customer ids

Recommendation:

- start with `customerPhone` if that is what the merchant already has
- move to `customerId` later if you add explicit account linking

## Minimal Backend Flow

Typical merchant backend flow:

1. Finalize the sale in the POS or ecommerce system.
2. Determine the loyalty customer:
   - stored `customerId`, or
   - checkout phone number
3. Build one normalized order payload.
4. Sign the raw JSON with HMAC.
5. `POST` to `/api/v1/public/orders`.
6. If the call times out or gets a transient error, retry with the same `externalOrderId`.

Do not let the cashier manually award points for the same sale after the backend starts posting orders successfully.

## Recommended Pilot Rollout

Start with one merchant, one sales channel, and one identifier method.

Recommended sequence:

1. Pick one channel only.
   Example: in-store POS, not ecommerce and POS at the same time.
2. Pick one customer lookup method.
   Recommendation: `customerPhone` first, if the merchant already captures it.
3. Configure one merchant HMAC secret.
4. Send test orders with a dedicated prefix like `pilot-`.
5. Verify:
   - order accepted
   - points posted
   - duplicate retries return replay, not duplicate points
6. Turn off manual cashier awards for that same integrated channel.
7. Keep manual award as fallback only for:
   - outages
   - non-integrated branches
   - sales channels not yet migrated

## How To Switch From Manual To API Without Double Awards

This is the practical rule:

- manual and API can coexist at the business level
- they must not both be used for the same sale stream

Safe rollout:

- Branch A still manual
- Branch B sends orders by API

Unsafe rollout:

- cashier manually awards
- backend also sends the order
- customer gets credited twice

Recommended cutover for a pilot merchant:

1. Keep manual flow enabled globally.
2. Choose one integrated branch or channel.
3. Train staff in that branch:
   - if the sale is in the integrated POS flow, do not manually award points
   - only use manual award if the integration is down
4. Monitor accepted orders and replay responses for a few days.
5. Expand branch by branch or channel by channel.

## Suggested Merchant Middleware Responsibilities

If the merchant does not have a flexible POS, a small middleware service can do the integration.

That middleware should:

- receive sales from the POS, export job, or webhook
- map the merchant payload into the Puntos order schema
- attach the correct `businessSlug`
- sign requests with HMAC
- retry safely with the same `externalOrderId`
- log `200`, `401`, `404`, and `409` responses

## Current v1 Limits

This first version does not yet do:

- POS-specific adapters
- refund or return ingestion
- automatic customer creation
- item/category-based scoring

In v1, line items are stored for future use, but points are still computed from `amount_q`.

## Operational Checklist For A Pilot Merchant

- HMAC secret configured for the merchant slug
- one stable `externalOrderId` source chosen
- one customer lookup method chosen
- test payload signed from the exact raw JSON
- replay retry tested
- manual awards disabled for the integrated sales stream
- fallback procedure documented for outages

## Next Recommended Step

For the first real merchant, implement a tiny backend adapter that does only this:

1. receive finalized sale
2. map to Puntos order payload
3. sign raw JSON
4. POST to Puntos
5. retry on timeout with the same `externalOrderId`

That is enough to move from cashier-entered awards to automatic loyalty posting without waiting for a full native POS adapter.
