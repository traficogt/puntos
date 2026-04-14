# Orders API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class server-to-server Orders API that stores normalized orders and automatically posts one linked loyalty transaction from each valid, idempotent order.

**Architecture:** Implement a new Orders domain with a dedicated table, a repository for persistence, a pure processing service for validation/idempotency/customer resolution/ledger side effects, and a public HMAC-protected ingestion route. Keep the existing cashier award flow unchanged and reuse the existing points and balance logic so v1 scoring stays based on `amount_q`.

**Tech Stack:** Node.js 20, Express, PostgreSQL 16, Zod, OpenAPI generator, `node:test`

---

## File Structure

### New files

- `src/app/migrations/2026-04-14-orders.sql`
  - Creates the `orders` table, unique `(business_id, external_order_id)` constraint, and foreign keys.
- `src/app/repositories/order-repository.js`
  - Encapsulates `orders` table queries.
- `src/app/services/order-service.js`
  - Validates processable status, resolves the customer, computes idempotency fingerprint, stores the order, inserts the linked transaction, and updates balances.
- `src/app/routes/order-routes.js`
  - Exposes `POST /public/orders` with HMAC verification and request validation.
- `tests/unit/order-service.test.js`
  - Unit tests for order processing behavior.
- `tests/integration/orders-idempotency.test.js`
  - Database-backed idempotency and balance update coverage.

### Modified files

- `src/app/routes/index.js`
  - Mount the new orders route under `/api` and `/api/v1`.
- `src/scripts/generate-openapi.mjs`
  - Import `OrderCreateSchema`, define response schemas, and emit the new OpenAPI path.
- `tests/unit/openapi-contract.test.js`
  - Assert the new route is documented with expected metadata and response typing.

## Task 1: Add Orders Persistence

**Files:**
- Create: `src/app/migrations/2026-04-14-orders.sql`
- Create: `src/app/repositories/order-repository.js`
- Test: `tests/unit/order-service.test.js`

- [ ] **Step 1: Write the failing repository-oriented test shape**

Create `tests/unit/order-service.test.js` with the first red test proving replay lookup uses `(business_id, external_order_id)`:

```js
import test from "node:test";
import assert from "node:assert/strict";

const { processOrderWithDeps } = await import("../../src/app/services/order-service.js");

test("returns replay success when the same externalOrderId is received with the same payload", async () => {
  let lookupCalled = false;
  const deps = {
    withTransaction: async (fn) => fn({
      query: async (sql) => {
        if (sql.includes("SELECT id, customer_id, transaction_id")) {
          lookupCalled = true;
          return {
            rows: [{
              id: "order-existing",
              customer_id: "cust-1",
              transaction_id: "tx-existing",
              points_awarded: 5,
              transaction_status: "POSTED",
              fingerprint: "fp-1"
            }],
            rowCount: 1
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }
    }),
    BusinessRepo: {
      getPublicBySlug: async () => ({ id: "biz-1", slug: "cafe" }),
      getById: async () => ({ id: "biz-1", plan: "NEGOCIO", program_type: "SPEND", program_json: { points_per_q: 0.1 } })
    },
    CustomerRepo: {
      getById: async () => ({ id: "cust-1", business_id: "biz-1" }),
      getByBusinessAndPhone: async () => null
    },
    computePoints: () => 5,
    hashPayload: () => "fp-1"
  };

  const out = await processOrderWithDeps(deps, {
    businessSlug: "cafe",
    externalOrderId: "ord-1",
    customerId: "cust-1",
    status: "paid",
    amount_q: 50
  });

  assert.equal(lookupCalled, true);
  assert.deepEqual(out, {
    ok: true,
    orderId: "order-existing",
    transactionId: "tx-existing",
    customerId: "cust-1",
    pointsAwarded: 5,
    status: "POSTED",
    replay: true
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --test tests/unit/order-service.test.js
```

Expected:

```text
FAIL ... Cannot find module '../../src/app/services/order-service.js'
```

- [ ] **Step 3: Add the migration**

Create `src/app/migrations/2026-04-14-orders.sql`:

```sql
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  external_order_id TEXT NOT NULL,
  status TEXT NOT NULL,
  amount_q NUMERIC(10,2) NOT NULL DEFAULT 0,
  subtotal_q NUMERIC(10,2),
  discount_q NUMERIC(10,2),
  tax_q NUMERIC(10,2),
  currency TEXT NOT NULL DEFAULT 'GTQ',
  occurred_at TIMESTAMPTZ,
  source TEXT NOT NULL DEFAULT 'api',
  line_items_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  fingerprint TEXT NOT NULL,
  transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
  points_awarded INT NOT NULL DEFAULT 0,
  transaction_status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, external_order_id)
);

CREATE INDEX IF NOT EXISTS idx_orders_business_customer_created
  ON orders (business_id, customer_id, created_at DESC);
```

- [ ] **Step 4: Add the minimal repository**

Create `src/app/repositories/order-repository.js`:

```js
import crypto from "node:crypto";

function makeId() {
  return crypto.randomUUID();
}

export const OrderRepo = {
  async findByBusinessAndExternalId(client, businessId, externalOrderId) {
    const { rows } = await client.query(
      `SELECT id, business_id, customer_id, external_order_id, fingerprint, transaction_id, points_awarded, transaction_status
       FROM orders
       WHERE business_id = $1 AND external_order_id = $2
       LIMIT 1`,
      [businessId, externalOrderId]
    );
    return rows[0] ?? null;
  },

  async create(client, input) {
    const id = input.id ?? makeId();
    const { rows } = await client.query(
      `INSERT INTO orders
       (id, business_id, customer_id, external_order_id, status, amount_q, subtotal_q, discount_q, tax_q, currency, occurred_at, source, line_items_json, meta, fingerprint, transaction_id, points_awarded, transaction_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING *`,
      [
        id,
        input.business_id,
        input.customer_id,
        input.external_order_id,
        input.status,
        input.amount_q,
        input.subtotal_q,
        input.discount_q,
        input.tax_q,
        input.currency,
        input.occurred_at,
        input.source ?? "api",
        input.line_items_json ?? [],
        input.meta ?? {},
        input.fingerprint,
        input.transaction_id ?? null,
        input.points_awarded ?? 0,
        input.transaction_status ?? null
      ]
    );
    return rows[0];
  }
};
```

- [ ] **Step 5: Commit the persistence scaffolding**

Run:

```bash
git add src/app/migrations/2026-04-14-orders.sql src/app/repositories/order-repository.js tests/unit/order-service.test.js
git commit -m "feat: add orders persistence scaffolding"
```

## Task 2: Implement Order Processing Service

**Files:**
- Create: `src/app/services/order-service.js`
- Modify: `tests/unit/order-service.test.js`
- Test: `tests/unit/order-service.test.js`

- [ ] **Step 1: Extend the unit test with customer resolution and status rules**

Append these failing tests to `tests/unit/order-service.test.js`:

```js
test("falls back to customerPhone when customerId is absent", async () => {
  const deps = {
    withTransaction: async (fn) => fn({ query: async () => ({ rows: [], rowCount: 0 }) }),
    BusinessRepo: {
      getPublicBySlug: async () => ({ id: "biz-1", slug: "cafe" }),
      getById: async () => ({ id: "biz-1", plan: "NEGOCIO", program_type: "SPEND", program_json: { points_per_q: 0.1 } })
    },
    CustomerRepo: {
      getById: async () => null,
      getByBusinessAndPhone: async (businessId, phone) => ({ id: "cust-phone", business_id: businessId, phone })
    },
    computePoints: () => 8,
    hashPayload: () => "fp-2"
  };

  const out = await processOrderWithDeps(deps, {
    businessSlug: "cafe",
    customerPhone: "+50255554444",
    externalOrderId: "ord-phone",
    status: "completed",
    amount_q: 80
  });

  assert.equal(out.customerId, "cust-phone");
  assert.equal(out.pointsAwarded, 8);
});

test("rejects unsupported order status", async () => {
  const deps = {
    withTransaction: async (fn) => fn({ query: async () => ({ rows: [], rowCount: 0 }) }),
    BusinessRepo: {
      getPublicBySlug: async () => ({ id: "biz-1", slug: "cafe" }),
      getById: async () => ({ id: "biz-1", plan: "NEGOCIO", program_type: "SPEND", program_json: { points_per_q: 0.1 } })
    },
    CustomerRepo: {
      getById: async () => ({ id: "cust-1", business_id: "biz-1" }),
      getByBusinessAndPhone: async () => null
    },
    computePoints: () => 0,
    hashPayload: () => "fp-3"
  };

  await assert.rejects(
    () => processOrderWithDeps(deps, {
      businessSlug: "cafe",
      customerId: "cust-1",
      externalOrderId: "ord-bad-status",
      status: "pending",
      amount_q: 10
    }),
    /Unsupported order status/
  );
});
```

- [ ] **Step 2: Run the service test to verify it fails for the missing implementation**

Run:

```bash
node --test tests/unit/order-service.test.js
```

Expected:

```text
FAIL ... Cannot find module '../../src/app/services/order-service.js'
```

- [ ] **Step 3: Implement the minimal service**

Create `src/app/services/order-service.js`:

```js
import crypto from "node:crypto";
import { withTransaction } from "../database.js";
import { BusinessRepo } from "../repositories/business-repository.js";
import { CustomerRepo } from "../repositories/customer-repository.js";
import { OrderRepo } from "../repositories/order-repository.js";
import { computePoints } from "./points-service.js";
import { conflict, notFound, badRequest } from "../../utils/http-error.js";

const PROCESSABLE_STATUSES = new Set(["paid", "completed"]);

function defaultHashPayload(payload) {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

async function resolveCustomer({ CustomerRepo, businessId, customerId, customerPhone }) {
  if (customerId) {
    const customer = await CustomerRepo.getById(customerId);
    if (customer && String(customer.business_id) === String(businessId)) return customer;
  }
  if (customerPhone) {
    const customer = await CustomerRepo.getByBusinessAndPhone(businessId, customerPhone);
    if (customer) return customer;
  }
  throw notFound("Customer not found for this business");
}

export async function processOrderWithDeps(deps, input) {
  const publicBiz = await deps.BusinessRepo.getPublicBySlug(String(input.businessSlug || ""));
  if (!publicBiz) throw notFound("Business not found");
  const business = await deps.BusinessRepo.getById(String(publicBiz.id));
  if (!business) throw notFound("Business not found");

  const status = String(input.status || "").trim().toLowerCase();
  if (!PROCESSABLE_STATUSES.has(status)) throw badRequest("Unsupported order status");

  const customer = await resolveCustomer({
    CustomerRepo: deps.CustomerRepo,
    businessId: business.id,
    customerId: input.customerId,
    customerPhone: input.customerPhone
  });

  const normalized = {
    customerId: customer.id,
    status,
    amount_q: Number(input.amount_q || 0),
    subtotal_q: input.subtotal_q == null ? null : Number(input.subtotal_q),
    discount_q: input.discount_q == null ? null : Number(input.discount_q),
    tax_q: input.tax_q == null ? null : Number(input.tax_q),
    currency: String(input.currency || "GTQ").toUpperCase(),
    occurred_at: input.occurred_at ?? null,
    items: Array.isArray(input.items) ? input.items : [],
    meta: input.meta && typeof input.meta === "object" ? input.meta : {}
  };
  const fingerprint = deps.hashPayload(normalized);
  const points = deps.computePoints(business, { amount_q: normalized.amount_q });

  return deps.withTransaction(async (client) => {
    const existing = await OrderRepo.findByBusinessAndExternalId(client, business.id, String(input.externalOrderId));
    if (existing) {
      if (String(existing.customer_id) !== String(customer.id) || String(existing.fingerprint) !== String(fingerprint)) {
        throw conflict("externalOrderId already used for a different payload");
      }
      return {
        ok: true,
        orderId: existing.id,
        transactionId: existing.transaction_id,
        customerId: existing.customer_id,
        pointsAwarded: Number(existing.points_awarded || 0),
        status: existing.transaction_status,
        replay: true
      };
    }

    const txId = crypto.randomUUID();
    await client.query(
      `INSERT INTO transactions
       (id, business_id, customer_id, amount_q, points, status, source, meta)
       VALUES ($1,$2,$3,$4,$5,'POSTED','order',$6)`,
      [txId, business.id, customer.id, normalized.amount_q, points, { external_order_id: String(input.externalOrderId) }]
    );
    await client.query(
      `UPDATE customer_balances
       SET points = points + $2,
           lifetime_points = lifetime_points + GREATEST($2, 0),
           updated_at = now()
       WHERE customer_id = $1`,
      [customer.id, points]
    );

    const order = await OrderRepo.create(client, {
      business_id: business.id,
      customer_id: customer.id,
      external_order_id: String(input.externalOrderId),
      status,
      amount_q: normalized.amount_q,
      subtotal_q: normalized.subtotal_q,
      discount_q: normalized.discount_q,
      tax_q: normalized.tax_q,
      currency: normalized.currency,
      occurred_at: normalized.occurred_at,
      line_items_json: normalized.items,
      meta: normalized.meta,
      fingerprint,
      transaction_id: txId,
      points_awarded: points,
      transaction_status: "POSTED"
    });

    return {
      ok: true,
      orderId: order.id,
      transactionId: txId,
      customerId: customer.id,
      pointsAwarded: points,
      status: "POSTED"
    };
  });
}

export async function processOrder(input) {
  return processOrderWithDeps({
    withTransaction,
    BusinessRepo,
    CustomerRepo,
    computePoints,
    hashPayload: defaultHashPayload
  }, input);
}
```

- [ ] **Step 4: Run the unit tests to verify green**

Run:

```bash
node --test tests/unit/order-service.test.js
```

Expected:

```text
ok ... order-service
```

- [ ] **Step 5: Commit the service**

Run:

```bash
git add src/app/services/order-service.js tests/unit/order-service.test.js
git commit -m "feat: add order processing service"
```

## Task 3: Expose the Public Orders API

**Files:**
- Create: `src/app/routes/order-routes.js`
- Modify: `src/app/routes/index.js`
- Test: `tests/unit/openapi-contract.test.js`

- [ ] **Step 1: Add the failing OpenAPI contract assertion**

Update `tests/unit/openapi-contract.test.js` with:

```js
    const publicOrder = doc.paths["/api/v1/public/orders"]?.post;
    assert.equal(
      publicOrder?.requestBody?.content?.["application/json"]?.schema?.$ref,
      "#/components/schemas/OrderCreateRequest"
    );
    assert.equal(
      publicOrder?.responses?.["200"]?.content?.["application/json"]?.schema?.$ref,
      "#/components/schemas/OrderCreateResponse"
    );
```

- [ ] **Step 2: Run the OpenAPI contract test and verify it fails**

Run:

```bash
node --test tests/unit/openapi-contract.test.js
```

Expected:

```text
FAIL ... expected undefined to equal '#/components/schemas/OrderCreateRequest'
```

- [ ] **Step 3: Implement the route and mount it**

Create `src/app/routes/order-routes.js`:

```js
import crypto from "node:crypto";
import { Router } from "express";
import { moderateRateLimit } from "../../middleware/rate-limit.js";
import { asyncRoute } from "../../middleware/common.js";
import { validate } from "../../utils/validation.js";
import { timingSafeEqualString } from "../../utils/timing-safe.js";
import { config } from "../../config/index.js";
import { processOrder } from "../services/order-service.js";
import { z } from "zod";

export const orderRoutes = Router();

const OrderLineItemSchema = z.object({
  code: z.string().max(120).optional(),
  name: z.string().min(1).max(160),
  category: z.string().max(120).optional(),
  quantity: z.number().positive(),
  unit_price_q: z.number().nonnegative().optional(),
  line_total_q: z.number().nonnegative().optional()
});

export const OrderCreateSchema = z.object({
  businessSlug: z.string().min(2).max(120),
  externalOrderId: z.string().min(1).max(160),
  customerId: z.string().uuid().optional(),
  customerPhone: z.string().min(6).optional(),
  status: z.enum(["paid", "completed", "pending", "open", "cancelled", "voided"]),
  amount_q: z.number().nonnegative(),
  subtotal_q: z.number().nonnegative().optional(),
  discount_q: z.number().nonnegative().optional(),
  tax_q: z.number().nonnegative().optional(),
  currency: z.string().min(3).max(3).optional(),
  occurred_at: z.string().datetime().optional(),
  items: z.array(OrderLineItemSchema).max(500).optional(),
  meta: z.record(z.any()).optional()
}).refine((value) => Boolean(value.customerId || value.customerPhone), {
  message: "customerId or customerPhone is required"
});

function verifySignature(rawBody, businessSlug, signature) {
  const secret = businessSlug ? config.PAYMENT_WEBHOOK_HMAC_SECRETS?.[businessSlug] : null;
  if (!secret || !rawBody) return false;
  const expected = crypto.createHmac("sha256", String(secret)).update(rawBody).digest("hex");
  return timingSafeEqualString(String(signature || "").trim().toLowerCase(), expected);
}

orderRoutes.post("/public/orders", moderateRateLimit, asyncRoute(async (req, res) => {
  const parsed = validate(OrderCreateSchema, req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });

  const businessSlug = parsed.data.businessSlug;
  const signature = String(req.headers["x-signature"] || "");
  if (!verifySignature(req.rawBody, businessSlug, signature)) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  const out = await processOrder(parsed.data);
  res.json(out);
}));
```

Modify `src/app/routes/index.js`:

```js
import { orderRoutes } from "./order-routes.js";
```

and add:

```js
  apiRoutes.use(basePath, orderRoutes);
```

inside `mountRoutes(basePath)`.

- [ ] **Step 4: Run the targeted tests**

Run:

```bash
node --test tests/unit/order-service.test.js tests/unit/openapi-contract.test.js
```

Expected:

```text
ok ... order-service
ok ... openapi contract
```

- [ ] **Step 5: Commit the route**

Run:

```bash
git add src/app/routes/order-routes.js src/app/routes/index.js tests/unit/openapi-contract.test.js
git commit -m "feat: add public orders ingestion route"
```

## Task 4: Document the API and Add Integration Coverage

**Files:**
- Modify: `src/scripts/generate-openapi.mjs`
- Create: `tests/integration/orders-idempotency.test.js`
- Test: `tests/integration/orders-idempotency.test.js`

- [ ] **Step 1: Add the failing integration test**

Create `tests/integration/orders-idempotency.test.js`:

```js
import crypto from "node:crypto";
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";

import { processOrder } from "../../src/app/services/order-service.js";
import { BusinessRepo } from "../../src/app/repositories/business-repository.js";
import { CustomerRepo } from "../../src/app/repositories/customer-repository.js";
import { closeDatabase, dbQuery, withDbClientContext } from "../../src/app/database.js";

const runIntegration = process.env.RUN_INTEGRATION === "true";
const integrationDescribe = runIntegration ? describe : describe.skip;
const createdBusinessIds = [];

async function createFixture() {
  const suffix = crypto.randomUUID().slice(0, 8);
  const businessId = crypto.randomUUID();
  const customerId = crypto.randomUUID();
  const slug = `orders-${suffix}`;

  await withDbClientContext({ platformAdmin: true, tenantId: null }, async () => {
    await BusinessRepo.create({
      id: businessId,
      name: `Orders ${suffix}`,
      slug,
      email: `orders-${suffix}@example.com`,
      phone: "+50255550123",
      password_hash: "test-hash",
      category: "cafe",
      plan: "NEGOCIO",
      program_type: "SPEND",
      program_json: { points_per_q: 0.1 }
    });
    await CustomerRepo.create({
      id: customerId,
      business_id: businessId,
      phone: `+50255${Math.floor(Math.random() * 1000000).toString().padStart(6, "0")}`,
      name: "Orders Customer"
    });
  });

  createdBusinessIds.push(businessId);
  return { businessId, customerId, slug };
}

after(async () => {
  if (!createdBusinessIds.length) return;
  await withDbClientContext({ platformAdmin: true, tenantId: null }, async () => {
    for (const businessId of createdBusinessIds.splice(0)) {
      await dbQuery("DELETE FROM businesses WHERE id = $1", [businessId]);
    }
  });
  await closeDatabase().catch(() => {});
});

integrationDescribe("Orders API idempotency integration", () => {
  it("deduplicates repeated order ingestion and updates the balance once", async () => {
    const { businessId, customerId, slug } = await createFixture();

    const first = await processOrder({
      businessSlug: slug,
      customerId,
      externalOrderId: "ord-1",
      status: "paid",
      amount_q: 50
    });

    const second = await processOrder({
      businessSlug: slug,
      customerId,
      externalOrderId: "ord-1",
      status: "paid",
      amount_q: 50
    });

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(first.transactionId, second.transactionId);
    assert.equal(second.replay, true);

    const { rows: orderRows } = await withDbClientContext({ platformAdmin: true, tenantId: null }, async () => (
      dbQuery("SELECT id, transaction_id FROM orders WHERE business_id = $1 AND external_order_id = $2", [businessId, "ord-1"])
    ));
    assert.equal(orderRows.length, 1);

    const { rows: balanceRows } = await withDbClientContext({ platformAdmin: true, tenantId: null }, async () => (
      dbQuery("SELECT points, lifetime_points FROM customer_balances WHERE customer_id = $1", [customerId])
    ));
    assert.equal(balanceRows.length, 1);
    assert.equal(Number(balanceRows[0].points), Number(first.pointsAwarded));
    assert.equal(Number(balanceRows[0].lifetime_points), Number(first.pointsAwarded));
  });
});
```

- [ ] **Step 2: Run the integration test to verify it fails**

Run:

```bash
RUN_INTEGRATION=true node --test tests/integration/orders-idempotency.test.js
```

Expected:

```text
FAIL ... relation "orders" does not exist
```

- [ ] **Step 3: Extend OpenAPI generation**

Modify `src/scripts/generate-openapi.mjs`:

```js
const { OrderCreateSchema } = await import("../app/routes/order-routes.js");
```

Add schemas:

```js
const OrderCreateResponseSchema = okEnvelope({
  orderId: z.string().uuid(),
  transactionId: z.string().uuid(),
  customerId: z.string().uuid(),
  pointsAwarded: z.number(),
  status: z.string(),
  replay: z.boolean().optional()
}).passthrough();
```

Register path metadata:

```js
  "/api/v1/public/orders": {
    post: {
      summary: "Create and process an external order",
      responses: {
        "200": { description: "Order processed or replayed" },
        "400": { description: "Validation error" },
        "401": { description: "Invalid signature" },
        "404": { description: "Business or customer not found" },
        "409": { description: "externalOrderId already used for different payload" }
      }
    }
  },
```

and bind:

```js
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/OrderCreateRequest" }
          }
        }
      }
```

plus:

```js
  OrderCreateRequest: toJsonSchema(OrderCreateSchema, "OrderCreateRequest"),
  OrderCreateResponse: toJsonSchema(OrderCreateResponseSchema, "OrderCreateResponse"),
```

- [ ] **Step 4: Run the full targeted verification**

Run:

```bash
node --test tests/unit/order-service.test.js tests/unit/openapi-contract.test.js
RUN_INTEGRATION=true node --test tests/integration/orders-idempotency.test.js
```

Expected:

```text
ok ... order-service
ok ... openapi contract
ok ... Orders API idempotency integration
```

- [ ] **Step 5: Commit the documentation and integration coverage**

Run:

```bash
git add src/scripts/generate-openapi.mjs tests/integration/orders-idempotency.test.js
git commit -m "feat: document and verify orders api"
```

## Self-Review

### Spec coverage

- Orders table and first-class record: Task 1
- Processing service and linked transaction: Task 2
- Public create-and-process endpoint: Task 3
- HMAC and OpenAPI documentation: Task 3 and Task 4
- Idempotency and replay semantics: Task 2 and Task 4
- Existing cashier flow unchanged: preserved by omission from tasks

### Placeholder scan

- No `TODO`, `TBD`, or deferred implementation steps appear in the task list.
- Future work is mentioned only in the architecture explanation, not in executable steps.

### Type consistency

- Request schema name: `OrderCreateSchema`
- Service function names: `processOrderWithDeps`, `processOrder`
- Request identity fields: `customerId`, `customerPhone`
- Idempotency field: `externalOrderId`

These names are used consistently across tasks.
