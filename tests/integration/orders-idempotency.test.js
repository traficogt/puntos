import crypto from "node:crypto";
import pg from "pg";
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";

import { processOrder } from "../../src/app/services/order-service.js";
import { closeDatabase } from "../../src/app/database.js";

const runIntegration = process.env.RUN_INTEGRATION === "true";
const integrationDescribe = runIntegration ? describe : describe.skip;
const createdBusinessIds = [];

function createAdminClient() {
  return new pg.Client({
    host: process.env.TEST_DB_HOST || process.env.DB_HOST || "localhost",
    port: Number(process.env.TEST_DB_PORT || process.env.DB_PORT || 5432),
    database: process.env.TEST_DB_NAME || process.env.DB_NAME || "puntos",
    user: process.env.TEST_DB_USER || process.env.DB_MIGRATIONS_USER || process.env.DB_USER || "postgres",
    password: process.env.TEST_DB_PASSWORD || process.env.DB_MIGRATIONS_PASSWORD || process.env.DB_PASSWORD || ""
  });
}

async function withAdminClient(fn) {
  const client = createAdminClient();
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => {});
  }
}

async function createFixture({ holdDays = 0 } = {}) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const businessId = crypto.randomUUID();
  const customerId = crypto.randomUUID();
  const slug = `orders-${suffix}`;

  await withAdminClient(async (client) => {
    await client.query(
      `INSERT INTO businesses
       (id, name, slug, email, phone, password_hash, category, plan, program_type, program_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        businessId,
        `Orders ${suffix}`,
        slug,
        `orders-${suffix}@example.com`,
        "+50255550123",
        "test-hash",
        "cafe",
        "NEGOCIO",
        "SPEND",
        { points_per_q: 0.1, pending_points_hold_days: holdDays }
      ]
    );
    const customerPhone = `+50255${Math.floor(Math.random() * 1000000).toString().padStart(6, "0")}`;
    await client.query(
      `INSERT INTO customers (id, business_id, phone, name)
       VALUES ($1,$2,$3,$4)`,
      [customerId, businessId, customerPhone, "Orders Customer"]
    );
    await client.query(
      `INSERT INTO customer_balances (customer_id, points, pending_points, lifetime_points)
       VALUES ($1,0,0,0)`,
      [customerId]
    );
  });

  createdBusinessIds.push(businessId);
  return { businessId, customerId, slug };
}

after(async () => {
  if (!createdBusinessIds.length) return;
  await withAdminClient(async (client) => {
    for (const businessId of createdBusinessIds.splice(0)) {
      await client.query("DELETE FROM businesses WHERE id = $1", [businessId]);
    }
  });
  await closeDatabase().catch(() => {});
});

integrationDescribe("Orders API idempotency integration", () => {
  it("deduplicates concurrent order ingestion and updates the balance once", async () => {
    const { businessId, customerId, slug } = await createFixture();

    const firstRequest = {
      businessSlug: slug,
      customerId,
      externalOrderId: "ord-1",
      status: "paid",
      amount_q: 50,
      line_items_json: [
        {
          quantity: 1,
          name: "Banana",
          code: "B",
          category: "fruit"
        },
        {
          category: "fruit",
          code: "A",
          name: "Apple",
          quantity: 2
        }
      ],
      meta: {
        z: 2,
        details: {
          b: 2,
          a: 1
        },
        a: 1
      }
    };
    const secondRequest = {
      businessSlug: slug,
      customerId,
      externalOrderId: "ord-1",
      status: "paid",
      amount_q: 50,
      line_items_json: [
        {
          name: "Apple",
          quantity: 2,
          category: "fruit",
          code: "A"
        },
        {
          category: "fruit",
          quantity: 1,
          code: "B",
          name: "Banana"
        }
      ],
      meta: {
        details: {
          a: 1,
          b: 2
        },
        a: 1,
        z: 2
      }
    };

    const [first, second] = await Promise.all([
      processOrder(firstRequest),
      processOrder(secondRequest)
    ]);

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(first.transactionId, second.transactionId);
    assert.ok(first.replay === true || second.replay === true);

    const { rows: orderRows } = await withAdminClient((client) => (
      client.query(
        "SELECT id, transaction_id FROM orders WHERE business_id = $1 AND external_order_id = $2",
        [businessId, "ord-1"]
      )
    ));
    assert.equal(orderRows.length, 1);

    const { rows: balanceRows } = await withAdminClient((client) => (
      client.query("SELECT points, lifetime_points FROM customer_balances WHERE customer_id = $1", [customerId])
    ));
    assert.equal(balanceRows.length, 1);
    assert.equal(Number(balanceRows[0].points), Number(first.pointsAwarded));
    assert.equal(Number(balanceRows[0].lifetime_points), Number(first.pointsAwarded));
  });

  it("stores order points as pending when hold days are configured", async () => {
    const { customerId, slug } = await createFixture({ holdDays: 2 });
    const [first, second] = await Promise.all([
      processOrder({
        businessSlug: slug,
        customerId,
        externalOrderId: "ord-pending",
        status: "completed",
        amount_q: 50
      }),
      processOrder({
        businessSlug: slug,
        customerId,
        externalOrderId: "ord-pending",
        status: "completed",
        amount_q: 50
      })
    ]);

    assert.equal(first.status, "PENDING");
    assert.equal(second.status, "PENDING");
    assert.ok(first.replay === true || second.replay === true);

    const { rows: balanceRows } = await withAdminClient((client) => (
      client.query("SELECT points, pending_points, lifetime_points FROM customer_balances WHERE customer_id = $1", [customerId])
    ));
    assert.equal(balanceRows.length, 1);
    assert.equal(Number(balanceRows[0].points), 0);
    assert.equal(Number(balanceRows[0].pending_points), Number(first.pointsAwarded));
    assert.equal(Number(balanceRows[0].lifetime_points), 0);
  });
});
