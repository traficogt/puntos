# Identity Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a merchant-agnostic identity layer for external integrations: contact sync, contact identifiers, and a shared customer resolution service that Orders and future Returns can reuse.

**Architecture:** Keep `customers` as the canonical contact record for v1 and add a new `contact_identifiers` table for merchant-scoped alternate lookup keys. Expose a small HMAC-protected public integration surface, keep identity resolution in one shared service, and preserve existing route/service/repository boundaries so Orders and later Returns can depend on the same resolver instead of duplicating lookup logic.

**Tech Stack:** Node.js 20, Express, PostgreSQL 16, Zod, OpenAPI generator, `node:test`

---

## File Structure

### New files

- `src/app/migrations/2026-04-15-contact-identifiers.sql`
  - Creates `contact_identifiers` and indexes.
- `src/app/migrations/2026-04-15-contact-identifiers_rls.sql`
  - Enables and enforces tenant RLS on `contact_identifiers`.
- `src/app/repositories/contact-identifier-repository.js`
  - Encapsulates all `contact_identifiers` queries.
- `src/app/services/customer-resolution-service.js`
  - Centralizes customer lookup priority: `customerId` -> identifier -> phone.
- `src/app/services/contact-sync-service.js`
  - Owns contact create/upsert/get behavior for public integrations.
- `src/app/services/contact-identifier-service.js`
  - Owns link/unlink/list/resolve behavior for identifiers.
- `src/app/routes/contact-sync-routes.js`
  - Public HMAC-protected routes for contacts and identifiers.
- `tests/unit/contact-sync-service.test.js`
  - Unit tests for contact sync behavior.
- `tests/unit/customer-resolution-service.test.js`
  - Unit tests for shared resolution behavior.
- `tests/unit/contact-identifier-service.test.js`
  - Unit tests for identifier behavior.

### Modified files

- `src/app/repositories/customer-repository.js`
  - Add the minimal contact-oriented reads/writes needed by the new services.
- `src/app/routes/index.js`
  - Mount the new route family.
- `src/app/services/order-service.js`
  - Replace embedded lookup priority with shared resolver usage.
- `src/scripts/generate-openapi.mjs`
  - Document the new public routes.
- `src/scripts/create-app-role.mjs`
  - Grant explicit runtime access to `contact_identifiers`.
- `tests/unit/openapi-contract.test.js`
  - Assert new route docs exist.
- `tests/unit/create-app-role.test.js`
  - Assert the new table grant exists.
- `src/app/migrations/checksums.json`
  - Add new migration checksums.

## Security Invariants

Every task below must preserve these invariants:

- Public integration routes use HMAC over the raw body, not cookies.
- Tenant context must be set before tenant-scoped reads/writes.
- New tables must have RLS coverage and explicit app-role grants.
- Identifier uniqueness must be merchant-scoped, not global.
- No silent contact duplication.
- No weaker trust path than the Orders API.
- Security-relevant actions should be auditable, at minimum via deterministic DB state and conflict semantics; add audit logs only if they follow existing patterns cleanly.

## Task 1: Add Contact Identifier Persistence And Security Baseline

**Files:**
- Create: `src/app/migrations/2026-04-15-contact-identifiers.sql`
- Create: `src/app/migrations/2026-04-15-contact-identifiers_rls.sql`
- Create: `src/app/repositories/contact-identifier-repository.js`
- Modify: `src/app/migrations/checksums.json`
- Modify: `src/scripts/create-app-role.mjs`
- Modify: `tests/unit/create-app-role.test.js`
- Test: `tests/unit/create-app-role.test.js`

- [ ] **Step 1: Write the failing grant test**

Add a new explicit assertion to `tests/unit/create-app-role.test.js`:

```js
assert.deepEqual(APP_TABLE_PRIVILEGES.contact_identifiers, ["SELECT", "INSERT", "UPDATE"]);
assert.ok(APP_PUBLIC_TABLES.includes("contact_identifiers"));
```

- [ ] **Step 2: Run the grant test to verify red**

Run:

```bash
node --test tests/unit/create-app-role.test.js
```

Expected:

```text
FAIL ... APP_TABLE_PRIVILEGES.contact_identifiers is undefined
```

- [ ] **Step 3: Add the table migration**

Create `src/app/migrations/2026-04-15-contact-identifiers.sql`:

```sql
CREATE TABLE IF NOT EXISTS contact_identifiers (
  id UUID PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  identifier_type TEXT NOT NULL,
  identifier_value TEXT NOT NULL,
  label TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, identifier_type, identifier_value)
);

CREATE INDEX IF NOT EXISTS idx_contact_identifiers_customer
  ON contact_identifiers (customer_id, created_at DESC);
```

- [ ] **Step 4: Add the RLS migration**

Create `src/app/migrations/2026-04-15-contact-identifiers_rls.sql`:

```sql
DO $$
BEGIN
  IF to_regclass('contact_identifiers') IS NOT NULL THEN
    ALTER TABLE contact_identifiers ENABLE ROW LEVEL SECURITY;
    ALTER TABLE contact_identifiers FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation ON contact_identifiers;
    CREATE POLICY tenant_isolation ON contact_identifiers
      USING (app.is_platform_admin() OR business_id = app.current_tenant())
      WITH CHECK (app.is_platform_admin() OR business_id = app.current_tenant());
  END IF;
END$$;
```

- [ ] **Step 5: Add the repository**

Create `src/app/repositories/contact-identifier-repository.js` with focused methods only:

```js
export const ContactIdentifierRepo = {
  create(client, input) { /* insert one identifier */ },
  getByBusinessTypeAndValue(client, businessId, identifierType, identifierValue) { /* select one */ },
  listByCustomer(client, customerId) { /* select by customer */ },
  deactivate(client, businessId, identifierType, identifierValue) { /* update active=false */ }
};
```

Implementation rules:

- `identifier_value` must be stored trimmed.
- `meta` must be stored as JSON, not stringly-typed blobs.
- No business logic in the repository.

- [ ] **Step 6: Add explicit runtime grants**

Update `src/scripts/create-app-role.mjs`:

```js
contact_identifiers: ["SELECT", "INSERT", "UPDATE"],
```

Reason:

- public integration flow resolves existing identifiers
- links new identifiers
- deactivates existing identifiers

- [ ] **Step 7: Refresh checksums and rerun grant verification**

Run:

```bash
node src/scripts/migrations-lock.mjs
node --test tests/unit/create-app-role.test.js
```

Expected:

```text
Migrations lock: OK
... pass 3
```

- [ ] **Step 8: Commit**

```bash
git add src/app/migrations/2026-04-15-contact-identifiers.sql src/app/migrations/2026-04-15-contact-identifiers_rls.sql src/app/repositories/contact-identifier-repository.js src/app/migrations/checksums.json src/scripts/create-app-role.mjs tests/unit/create-app-role.test.js
git commit -m "feat: add contact identifier persistence"
```

## Task 2: Add Shared Customer Resolution

**Files:**
- Create: `src/app/services/customer-resolution-service.js`
- Modify: `src/app/repositories/customer-repository.js`
- Create: `tests/unit/customer-resolution-service.test.js`
- Modify: `src/app/services/order-service.js`
- Test: `tests/unit/customer-resolution-service.test.js`
- Test: `tests/unit/order-service.test.js`

- [ ] **Step 1: Write the failing resolver test**

Create `tests/unit/customer-resolution-service.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";

const { resolveCustomerForIntegrationWithDeps } = await import("../../src/app/services/customer-resolution-service.js");

test("resolves by customerId before identifier and phone", async () => {
  const out = await resolveCustomerForIntegrationWithDeps({
    CustomerRepo: {
      getById: async () => ({ id: "cust-1", business_id: "biz-1" }),
      getByBusinessAndPhone: async () => null
    },
    ContactIdentifierRepo: {
      getByBusinessTypeAndValue: async () => {
        throw new Error("identifier lookup should not run");
      }
    }
  }, {
    businessId: "biz-1",
    customerId: "cust-1",
    identifierType: "loyalty_card",
    identifierValue: "ABC123",
    customerPhone: "+50255554444"
  });

  assert.equal(out.id, "cust-1");
});
```

- [ ] **Step 2: Run it to verify red**

```bash
node --test tests/unit/customer-resolution-service.test.js
```

- [ ] **Step 3: Implement the shared resolver**

Create `src/app/services/customer-resolution-service.js` with one exported integration resolver:

```js
export async function resolveCustomerForIntegrationWithDeps(deps, input) {
  // order: customerId -> identifier -> phone
}
```

Rules:

- `customerId` must belong to the current business.
- identifier lookup is by `(business_id, identifier_type, identifier_value)` and only active identifiers count.
- phone must be normalized with `normalizePhone`.
- missing customer must return the same not-found semantics as Orders.

- [ ] **Step 4: Add only the missing repository methods**

Extend `src/app/repositories/customer-repository.js` with minimal contact-oriented methods:

```js
async getByBusinessAndId(businessId, customerId) { ... }
async upsertBasicProfile({ id, business_id, phone, name }) { ... }
```

Do not turn the repository into a CRM blob. Keep it limited to the fields we actually use in Phase 1.

- [ ] **Step 5: Replace embedded Orders lookup logic**

Refactor `src/app/services/order-service.js` so it calls the shared resolver instead of directly resolving by `customerId`/phone itself.

Constraint:

- keep the existing Orders behavior unchanged
- only swap the lookup source

- [ ] **Step 6: Verify resolver and Orders tests**

```bash
node --test tests/unit/customer-resolution-service.test.js tests/unit/order-service.test.js
```

- [ ] **Step 7: Commit**

```bash
git add src/app/services/customer-resolution-service.js src/app/repositories/customer-repository.js src/app/services/order-service.js tests/unit/customer-resolution-service.test.js tests/unit/order-service.test.js
git commit -m "refactor: centralize integration customer resolution"
```

## Task 3: Add Contact Sync Service

**Files:**
- Create: `src/app/services/contact-sync-service.js`
- Create: `tests/unit/contact-sync-service.test.js`
- Modify: `src/app/repositories/customer-repository.js`
- Test: `tests/unit/contact-sync-service.test.js`

- [ ] **Step 1: Write the failing contact upsert test**

Create `tests/unit/contact-sync-service.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";

const { upsertContactWithDeps } = await import("../../src/app/services/contact-sync-service.js");

test("creates a customer when no phone match exists", async () => {
  let created = null;
  const out = await upsertContactWithDeps({
    CustomerRepo: {
      getByBusinessAndPhone: async () => null,
      create: async (input) => {
        created = input;
        return { id: input.id, business_id: input.business_id, phone: input.phone, name: input.name };
      },
      updateName: async () => {
        throw new Error("should not update");
      }
    }
  }, {
    businessId: "biz-1",
    phone: "5555-4444",
    name: "Ana"
  });

  assert.equal(created.phone, "50255554444");
  assert.equal(out.phone, "50255554444");
});
```

- [ ] **Step 2: Run it to verify red**

```bash
node --test tests/unit/contact-sync-service.test.js
```

- [ ] **Step 3: Implement the service**

Create `src/app/services/contact-sync-service.js`:

```js
export async function upsertContactWithDeps(deps, input) {
  // normalize phone, find existing, create or update allowed fields
}
```

Rules:

- v1 upsert key is normalized phone within business.
- allowed update field is `name` only.
- do not silently merge multiple customers.
- if input has no phone and no existing `customerId`, reject with `400`.

- [ ] **Step 4: Add read helpers only as needed**

If required, extend `CustomerRepo` with:

```js
async listByBusinessSearch(businessId, q, limit = 50) { ... }
```

Only add this if the route contract actually needs list/search in v1.

- [ ] **Step 5: Verify**

```bash
node --test tests/unit/contact-sync-service.test.js
```

- [ ] **Step 6: Commit**

```bash
git add src/app/services/contact-sync-service.js src/app/repositories/customer-repository.js tests/unit/contact-sync-service.test.js
git commit -m "feat: add contact sync service"
```

## Task 4: Add Contact Identifier Service

**Files:**
- Create: `src/app/services/contact-identifier-service.js`
- Create: `tests/unit/contact-identifier-service.test.js`
- Test: `tests/unit/contact-identifier-service.test.js`

- [ ] **Step 1: Write the failing identifier link test**

Create `tests/unit/contact-identifier-service.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";

const { linkContactIdentifierWithDeps } = await import("../../src/app/services/contact-identifier-service.js");

test("rejects linking an identifier already assigned to another customer", async () => {
  await assert.rejects(
    () => linkContactIdentifierWithDeps({
      CustomerRepo: {
        getById: async () => ({ id: "cust-2", business_id: "biz-1" })
      },
      ContactIdentifierRepo: {
        getByBusinessTypeAndValue: async () => ({ customer_id: "cust-1", active: true }),
        create: async () => {
          throw new Error("should not create");
        }
      }
    }, {
      businessId: "biz-1",
      customerId: "cust-2",
      identifierType: "pos_customer_id",
      identifierValue: "123"
    }),
    /already linked/
  );
});
```

- [ ] **Step 2: Run it to verify red**

```bash
node --test tests/unit/contact-identifier-service.test.js
```

- [ ] **Step 3: Implement link/list/unlink/resolve**

Create `src/app/services/contact-identifier-service.js` with these exports:

```js
export async function linkContactIdentifierWithDeps(deps, input) { ... }
export async function listContactIdentifiersWithDeps(deps, input) { ... }
export async function unlinkContactIdentifierWithDeps(deps, input) { ... }
export async function resolveContactIdentifierWithDeps(deps, input) { ... }
```

Rules:

- trim identifier values
- keep `identifier_type` explicit
- only active identifiers resolve
- unlink should deactivate, not hard-delete
- conflicts must be deterministic and merchant-scoped

- [ ] **Step 4: Verify**

```bash
node --test tests/unit/contact-identifier-service.test.js tests/unit/customer-resolution-service.test.js
```

- [ ] **Step 5: Commit**

```bash
git add src/app/services/contact-identifier-service.js tests/unit/contact-identifier-service.test.js tests/unit/customer-resolution-service.test.js
git commit -m "feat: add contact identifier service"
```

## Task 5: Add Public Integration Routes And Docs

**Files:**
- Create: `src/app/routes/contact-sync-routes.js`
- Modify: `src/app/routes/index.js`
- Modify: `src/scripts/generate-openapi.mjs`
- Modify: `tests/unit/openapi-contract.test.js`
- Test: `tests/unit/openapi-contract.test.js`

- [ ] **Step 1: Add route-level contract assertions first**

Extend `tests/unit/openapi-contract.test.js` to assert new docs exist for:

```js
"/api/v1/public/contacts"
"/api/v1/public/contact-identifiers"
"/api/v1/public/contact-identifiers/resolve"
"/api/v1/public/contact-identifiers/unlink"
```

- [ ] **Step 2: Run docs test to verify red**

```bash
node --test tests/unit/openapi-contract.test.js
```

- [ ] **Step 3: Implement the route surface**

Create `src/app/routes/contact-sync-routes.js` and mirror the Orders security pattern:

Public routes:

- `POST /public/contacts`
- `GET /public/contacts/:customerId`
- `POST /public/contact-identifiers`
- `POST /public/contact-identifiers/resolve`
- `POST /public/contact-identifiers/unlink`

Required route characteristics:

- `moderateRateLimit`
- HMAC over `req.rawBody`
- request validation with Zod
- no cookie auth
- clear `400` / `401` / `404` / `409` behavior

Snippet for the shared verifier pattern:

```js
function verifySignature(rawBody, businessSlug, signature) {
  const secret = businessSlug ? config.PAYMENT_WEBHOOK_HMAC_SECRETS?.[businessSlug] : null;
  if (!secret || !rawBody) return false;
  const expected = crypto.createHmac("sha256", String(secret)).update(String(rawBody)).digest("hex");
  return timingSafeEqualString(normalizeSignature(signature), expected);
}
```

- [ ] **Step 4: Mount and document the routes**

Modify `src/app/routes/index.js` to mount the new routes under both `/api/v1` and `/api`.

Modify `src/scripts/generate-openapi.mjs` to document the new request and response schemas.

- [ ] **Step 5: Verify**

```bash
node --test tests/unit/openapi-contract.test.js tests/unit/contact-sync-service.test.js tests/unit/contact-identifier-service.test.js tests/unit/customer-resolution-service.test.js
```

- [ ] **Step 6: Commit**

```bash
git add src/app/routes/contact-sync-routes.js src/app/routes/index.js src/scripts/generate-openapi.mjs tests/unit/openapi-contract.test.js
git commit -m "feat: add public contact sync routes"
```

## Task 6: Run Full Phase Verification

**Files:**
- Test only

- [ ] **Step 1: Run targeted unit coverage**

```bash
node --test tests/unit/contact-sync-service.test.js tests/unit/contact-identifier-service.test.js tests/unit/customer-resolution-service.test.js tests/unit/order-service.test.js tests/unit/openapi-contract.test.js tests/unit/create-app-role.test.js
```

Expected:

```text
... pass
```

- [ ] **Step 2: Run migration lock check**

```bash
node src/scripts/migrations-lock.mjs
```

- [ ] **Step 3: Run a live Orders regression**

This phase must not weaken existing Orders behavior.

Run with the same credential split already used for live verification:

```bash
NODE_ENV=test \
DB_USER=puntos_app \
DB_PASSWORD_FILE=/var/lib/puntos/secrets/db_password \
DB_MIGRATIONS_USER=loyalty \
DB_MIGRATIONS_PASSWORD_FILE=/var/lib/puntos/secrets/db_migrations_password \
TEST_DB_HOST=localhost \
TEST_DB_PORT=5432 \
TEST_DB_NAME=puntos \
TEST_DB_USER=loyalty \
TEST_DB_PASSWORD="$(cat /var/lib/puntos/secrets/db_migrations_password)" \
RUN_INTEGRATION=true \
node --test tests/integration/orders-idempotency.test.js
```

- [ ] **Step 4: Commit verification-only follow-ups if needed**

If verification exposes a real bug, fix it in a focused patch and commit with a narrow message. Do not mix unrelated cleanup into this phase.

## Self-Review Checklist

- Phase 1 stays merchant-agnostic: yes
- Security is embedded, not deferred: yes
- New persistence has both RLS and explicit grants: yes
- Customer resolution is centralized instead of duplicated: yes
- Orders reuses the shared resolver so Returns can later reuse it too: yes
- No product/category logic leaked into this phase: yes
