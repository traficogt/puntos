import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { OrderReturnRepo } from "../../src/app/repositories/order-return-repository.js";

test("order return lookup finds the latest replay row for the external return id", async () => {
  const calls = [];
  const row = {
    id: "return-1",
    business_id: "business-1",
    external_return_id: "ret-123"
  };
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [row], rowCount: 1 };
    }
  };

  const found = await OrderReturnRepo.findByBusinessAndExternalId(
    client,
    "business-1",
    "ret-123"
  );

  assert.equal(found, row);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /FROM order_returns/i);
  assert.match(calls[0].sql, /WHERE business_id = \$1/i);
  assert.match(calls[0].sql, /AND external_return_id = \$2/i);
  assert.match(calls[0].sql, /ORDER BY created_at DESC, id DESC/i);
  assert.deepEqual(calls[0].params, ["business-1", "ret-123"]);
});

test("order return lookup by order id stays business scoped and deterministic", async () => {
  const calls = [];
  const row = {
    id: "return-1",
    business_id: "business-1",
    order_id: "order-1"
  };
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [row], rowCount: 1 };
    }
  };

  const found = await OrderReturnRepo.findByOrderId(client, "business-1", "order-1");

  assert.equal(found, row);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /FROM order_returns/i);
  assert.match(calls[0].sql, /WHERE business_id = \$1/i);
  assert.match(calls[0].sql, /AND order_id = \$2/i);
  assert.match(calls[0].sql, /ORDER BY created_at DESC, id DESC/i);
  assert.deepEqual(calls[0].params, ["business-1", "order-1"]);
});

test("order return create stores meta as json and preserves persistence-only inputs", async () => {
  const calls = [];
  const row = {
    id: "return-1",
    business_id: "business-1",
    customer_id: "customer-1",
    order_id: "order-1",
    meta: { source: "refund-api" }
  };
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [row], rowCount: 1 };
    }
  };

  const created = await OrderReturnRepo.create(client, {
    id: "return-1",
    business_id: "business-1",
    customer_id: "customer-1",
    order_id: "order-1",
    external_return_id: "ret-123",
    external_order_id: "ord-123",
    reason: "customer_refund",
    occurred_at: "2026-04-15T00:00:00.000Z",
    meta: { source: "refund-api" },
    fingerprint: "fp-1",
    reversal_transaction_id: "txn-1",
    points_effect: -25,
    outcome: "reversed_posted"
  });

  assert.equal(created, row);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /INSERT INTO order_returns/i);
  assert.deepEqual(calls[0].params, [
    "return-1",
    "business-1",
    "customer-1",
    "order-1",
    "ret-123",
    "ord-123",
    "customer_refund",
    "2026-04-15T00:00:00.000Z",
    { source: "refund-api" },
    "fp-1",
    "txn-1",
    -25,
    "reversed_posted"
  ]);
});

test("order return migrations sort table before dedicated RLS", () => {
  const files = fs.readdirSync(new URL("../../src/app/migrations", import.meta.url))
    .filter((file) => file.includes("order-returns"))
    .sort();

  assert.deepEqual(files, [
    "2026-04-15-order-returns.sql",
    "2026-04-15-order-returns_rls.sql"
  ]);
});

test("order return RLS lives in the dedicated migration", () => {
  const tableSource = fs.readFileSync(
    new URL("../../src/app/migrations/2026-04-15-order-returns.sql", import.meta.url),
    "utf8"
  );
  const rlsSource = fs.readFileSync(
    new URL("../../src/app/migrations/2026-04-15-order-returns_rls.sql", import.meta.url),
    "utf8"
  );

  assert.doesNotMatch(tableSource, /ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(tableSource, /CREATE POLICY tenant_isolation ON order_returns/i);
  assert.match(rlsSource, /ENABLE ROW LEVEL SECURITY/);
  assert.match(rlsSource, /FORCE ROW LEVEL SECURITY/);
  assert.match(rlsSource, /CREATE POLICY tenant_isolation ON order_returns/i);
});

test("order return schema enforces order business and customer integrity", () => {
  const tableSource = fs.readFileSync(
    new URL("../../src/app/migrations/2026-04-15-order-returns.sql", import.meta.url),
    "utf8"
  );

  assert.match(
    tableSource,
    /ALTER TABLE orders\s+ADD CONSTRAINT orders_id_business_customer_unique\s+UNIQUE\s*\(id,\s*business_id,\s*customer_id\)/i
  );
  assert.match(
    tableSource,
    /ALTER TABLE orders\s+ADD CONSTRAINT orders_id_business_customer_external_unique\s+UNIQUE\s*\(id,\s*business_id,\s*customer_id,\s*external_order_id\)/i
  );
  assert.match(
    tableSource,
    /FOREIGN KEY\s*\(order_id,\s*business_id,\s*customer_id,\s*external_order_id\)\s*REFERENCES orders\s*\(id,\s*business_id,\s*customer_id,\s*external_order_id\)/i
  );
});
