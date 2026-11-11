# Order Returns v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class public `order-returns` API that fully refunds an existing order by canceling pending points or reversing posted points, while rejecting cases that require manual handling under business policy.

**Architecture:** Add a dedicated `order_returns` table, repository, service, and public HMAC route. Reuse the existing order linkage and reversal ledger pattern for posted transactions, while handling pending-point cancellation as a separate outcome. Keep the same route/service/repository boundaries and tenant/RLS model used by Orders and Identity.

**Tech Stack:** Node.js 20, Express, PostgreSQL 16, Zod, OpenAPI generator, `node:test`

---

## File Structure

### New files

- `src/app/migrations/2026-04-15-order-returns.sql`
  - Creates `order_returns` with idempotency and one-full-return-per-order constraints.
- `src/app/migrations/2026-04-15-order-returns_rls.sql`
  - Enables tenant RLS on `order_returns`.
- `src/app/repositories/order-return-repository.js`
  - Encapsulates `order_returns` replay lookup, order lookup, and create behavior.
- `src/app/services/order-return-service.js`
  - Owns business rules, idempotency, pending cancellation, posted reversal, and policy enforcement.
- `src/app/routes/order-return-routes.js`
  - Public HMAC route for `POST /public/order-returns`.
- `tests/unit/order-return-repository.test.js`
  - Repository SQL-shape and determinism tests.
- `tests/unit/order-return-service.test.js`
  - Pending-cancel, posted-reverse, replay, and policy tests.
- `tests/unit/order-return-routes.test.js`
  - Route-level signature and validation tests.
- `tests/integration/order-returns-idempotency.test.js`
  - DB-backed replay and ledger-effect coverage.

### Modified files

- `src/app/repositories/order-repository.js`
  - Add the minimal detailed order read used by returns.
- `src/app/routes/index.js`
  - Mount the new route family.
- `src/scripts/create-app-role.mjs`
  - Grant explicit access to `order_returns`.
- `src/scripts/generate-openapi.mjs`
  - Document `POST /api/v1/public/order-returns`.
- `src/app/migrations/checksums.json`
  - Add migration checksums.
- `tests/unit/create-app-role.test.js`
  - Assert `order_returns` grants.
- `tests/unit/openapi-contract.test.js`
  - Assert route and schema wiring.

## Security Invariants

- Public return ingestion uses HMAC over the raw body, not cookies.
- Tenant context must be set before tenant-scoped reads and writes.
- `order_returns` must have RLS coverage and explicit app-role grants.
- Replay and conflict behavior must be deterministic.
- No weaker trust path than `POST /api/v1/public/orders`.
- Manual-handling cases must fail closed.

## Task 1: Add Order Return Persistence And Grants

**Files:**
- Create: `src/app/migrations/2026-04-15-order-returns.sql`
- Create: `src/app/migrations/2026-04-15-order-returns_rls.sql`
- Create: `src/app/repositories/order-return-repository.js`
- Modify: `src/app/migrations/checksums.json`
- Modify: `src/scripts/create-app-role.mjs`
- Modify: `tests/unit/create-app-role.test.js`
- Create: `tests/unit/order-return-repository.test.js`

- [ ] **Step 1: Write failing tests**

Add to `tests/unit/create-app-role.test.js`:

```js
assert.deepEqual(APP_TABLE_PRIVILEGES.order_returns, ["SELECT", "INSERT", "UPDATE"]);
assert.ok(APP_PUBLIC_TABLES.includes("order_returns"));
```

Create `tests/unit/order-return-repository.test.js` with tests for:
- `findByBusinessAndExternalId()`
- `findByOrderId()`
- `create()`

- [ ] **Step 2: Run tests to verify red**

Run:

```bash
node --test tests/unit/create-app-role.test.js tests/unit/order-return-repository.test.js
```

- [ ] **Step 3: Add the table migration**

Create `src/app/migrations/2026-04-15-order-returns.sql` with:

```sql
CREATE TABLE IF NOT EXISTS order_returns (
  id UUID PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  external_return_id TEXT NOT NULL,
  external_order_id TEXT NOT NULL,
  reason TEXT,
  occurred_at TIMESTAMPTZ,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  fingerprint TEXT NOT NULL,
  reversal_transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
  points_effect INT NOT NULL,
  outcome TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, external_return_id),
  UNIQUE (order_id)
);

CREATE INDEX IF NOT EXISTS idx_order_returns_order_id
  ON order_returns (order_id);
```

- [ ] **Step 4: Add the RLS migration**

Create `src/app/migrations/2026-04-15-order-returns_rls.sql`:

```sql
DO $$
BEGIN
  IF to_regclass('order_returns') IS NOT NULL THEN
    ALTER TABLE order_returns ENABLE ROW LEVEL SECURITY;
    ALTER TABLE order_returns FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation ON order_returns;
    CREATE POLICY tenant_isolation ON order_returns
      USING (app.is_platform_admin() OR business_id = app.current_tenant())
      WITH CHECK (app.is_platform_admin() OR business_id = app.current_tenant());
  END IF;
END$$;
```

- [ ] **Step 5: Add the repository**

Create `src/app/repositories/order-return-repository.js` with:
- `findByBusinessAndExternalId(client, businessId, externalReturnId)`
- `findByOrderId(client, orderId)`
- `create(client, input)`

Implementation rules:
- deterministic lookup order if needed
- repository owns persistence only
- `meta` stored as JSON, not string blobs

- [ ] **Step 6: Add grants and checksums**

Update `src/scripts/create-app-role.mjs`:

```js
order_returns: ["SELECT", "INSERT", "UPDATE"],
```

Run:

```bash
node src/scripts/migrations-lock.mjs
node --test tests/unit/create-app-role.test.js tests/unit/order-return-repository.test.js
```

- [ ] **Step 7: Commit**

```bash
git add src/app/migrations/2026-04-15-order-returns.sql src/app/migrations/2026-04-15-order-returns_rls.sql src/app/repositories/order-return-repository.js src/app/migrations/checksums.json src/scripts/create-app-role.mjs tests/unit/create-app-role.test.js tests/unit/order-return-repository.test.js
git commit -m "feat: add order return persistence"
```

## Task 2: Add Order Return Service

**Files:**
- Create: `src/app/services/order-return-service.js`
- Modify: `src/app/repositories/order-repository.js`
- Create: `tests/unit/order-return-service.test.js`

- [ ] **Step 1: Write failing service tests**

Create tests for:
- pending order points are canceled
- posted order points are reversed
- replay success on identical `externalReturnId`
- conflict on changed replay payload
- reject missing original order
- reject already-returned order
- reject when negative balance would be required and policy forbids it

- [ ] **Step 2: Run tests to verify red**

Run:

```bash
node --test tests/unit/order-return-service.test.js
```

- [ ] **Step 3: Add minimal order read helper**

Extend `src/app/repositories/order-repository.js` with:

```js
async findDetailedByBusinessAndExternalId(client, businessId, externalOrderId) {
  const { rows } = await client.query(
    `SELECT id, business_id, customer_id, external_order_id, transaction_id, points_awarded, transaction_status
     FROM orders
     WHERE business_id = $1 AND external_order_id = $2
     LIMIT 1`,
    [businessId, externalOrderId]
  );
  return rows[0] ?? null;
}
```

- [ ] **Step 4: Implement the service**

Create `src/app/services/order-return-service.js` with:
- `processOrderReturnWithDeps(deps, input)`
- advisory lock on `(businessId, externalReturnId)`
- replay lookup by `externalReturnId`
- full-return rejection if `order_returns` already exists for the order
- `PENDING_CANCELLED` outcome:
  - subtract from `pending_points`
  - no reversal transaction
- `POSTED_REVERSED` outcome:
  - check balance policy
  - create reversal transaction
  - subtract from `points`
- create `order_returns` record in both outcomes

- [ ] **Step 5: Run tests to verify green**

Run:

```bash
node --test tests/unit/order-return-service.test.js
```

- [ ] **Step 6: Commit**

```bash
git add src/app/services/order-return-service.js src/app/repositories/order-repository.js tests/unit/order-return-service.test.js
git commit -m "feat: add order return service"
```

## Task 3: Add Public Route And OpenAPI Wiring

**Files:**
- Create: `src/app/routes/order-return-routes.js`
- Modify: `src/app/routes/index.js`
- Modify: `src/scripts/generate-openapi.mjs`
- Modify: `tests/unit/openapi-contract.test.js`
- Create: `tests/unit/order-return-routes.test.js`

- [ ] **Step 1: Write failing route and contract tests**

Add to `tests/unit/openapi-contract.test.js`:

```js
const publicOrderReturn = doc.paths["/api/v1/public/order-returns"]?.post;
assert.equal(
  publicOrderReturn?.requestBody?.content?.["application/json"]?.schema?.$ref,
  "#/components/schemas/OrderReturnCreateRequest"
);
assert.equal(publicOrderReturn?.["x-hmac-required"], true);
```

Create `tests/unit/order-return-routes.test.js` with tests for:
- invalid signature rejects
- valid request reaches the service
- invalid payload rejects

- [ ] **Step 2: Run tests to verify red**

Run:

```bash
node --test tests/unit/openapi-contract.test.js tests/unit/order-return-routes.test.js
```

- [ ] **Step 3: Implement the route**

Create `src/app/routes/order-return-routes.js` with:
- `OrderReturnCreateSchema`
- `createOrderReturnRoutes(deps = {})`
- `POST /public/order-returns`
- same raw-body HMAC pattern as Orders

- [ ] **Step 4: Wire the route and docs**

Update `src/app/routes/index.js` to mount the route.

Update `src/scripts/generate-openapi.mjs`:
- import `OrderReturnCreateSchema`
- add `OrderReturnCreateRequest`
- add `OrderReturnCreateResponse`
- add route binding for `/api/v1/public/order-returns`
- add curated path entry with `x-hmac-required: true`

- [ ] **Step 5: Run tests to verify green**

Run:

```bash
node --test tests/unit/openapi-contract.test.js tests/unit/order-return-routes.test.js
```

- [ ] **Step 6: Commit**

```bash
git add src/app/routes/order-return-routes.js src/app/routes/index.js src/scripts/generate-openapi.mjs tests/unit/openapi-contract.test.js tests/unit/order-return-routes.test.js
git commit -m "feat: add order return routes"
```

## Task 4: Add DB-Backed Idempotency Integration Test

**Files:**
- Create: `tests/integration/order-returns-idempotency.test.js`

- [ ] **Step 1: Write the failing integration test**

Follow the pattern used by `tests/integration/orders-idempotency.test.js`.

Cover:
- create a posted order
- process a return once
- process the same return again
- assert one `order_returns` row exists
- assert customer balance changed only once

- [ ] **Step 2: Run it to verify red**

Run:

```bash
RUN_INTEGRATION=true node --test tests/integration/order-returns-idempotency.test.js
```

- [ ] **Step 3: Implement the minimal fixture and assertions**

Use the same DB context, fixture setup, and cleanup style as the orders integration test.

- [ ] **Step 4: Run it to verify green**

Run:

```bash
RUN_INTEGRATION=true node --test tests/integration/order-returns-idempotency.test.js
```

- [ ] **Step 5: Commit**

```bash
git add tests/integration/order-returns-idempotency.test.js
git commit -m "test: add order return idempotency coverage"
```

## Task 5: Final Verification

- [ ] **Step 1: Run the full targeted unit set**

```bash
node --test tests/unit/create-app-role.test.js tests/unit/order-return-repository.test.js tests/unit/order-return-service.test.js tests/unit/order-return-routes.test.js tests/unit/openapi-contract.test.js tests/unit/order-service.test.js
```

- [ ] **Step 2: Run migrations lock**

```bash
node src/scripts/migrations-lock.mjs
```

- [ ] **Step 3: Run DB-backed integration verification**

```bash
RUN_INTEGRATION=true node --test tests/integration/order-returns-idempotency.test.js
```

- [ ] **Step 4: Confirm clean diff and recent commits**

```bash
git status --short
git log --oneline --decorate -5
```

- [ ] **Step 5: Merge or hand off for merge**

If using a worktree branch:

```bash
git switch main
git merge --ff-only <feature-branch>
```
