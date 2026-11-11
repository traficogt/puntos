import crypto from "node:crypto";
import pg from "pg";
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";

import { processOrder } from "../../src/app/services/order-service.js";
import { processOrderReturn } from "../../src/app/services/order-return-service.js";
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

async function createFixture() {
  const suffix = crypto.randomUUID().slice(0, 8);
  const businessId = crypto.randomUUID();
  const customerId = crypto.randomUUID();
  const slug = `order-returns-${suffix}`;

  await withAdminClient(async (client) => {
    await client.query(
      `INSERT INTO businesses
       (id, name, slug, email, phone, password_hash, category, plan, program_type, program_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        businessId,
        `Order Returns ${suffix}`,
        slug,
        `order-returns-${suffix}@example.com`,
        "+50255550124",
        "test-hash",
        "cafe",
        "NEGOCIO",
        "SPEND",
        { points_per_q: 0.1, pending_points_hold_days: 0 }
      ]
    );
    const customerPhone = `+50256${Math.floor(Math.random() * 1000000).toString().padStart(6, "0")}`;
    await client.query(
      `INSERT INTO customers (id, business_id, phone, name)
       VALUES ($1,$2,$3,$4)`,
      [customerId, businessId, customerPhone, "Order Return Customer"]
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

integrationDescribe("Order Returns API idempotency integration", () => {
  it("deduplicates repeated returns and changes the posted balance once", async () => {
    const { businessId, customerId, slug } = await createFixture();

    const order = await processOrder({
      businessSlug: slug,
      customerId,
      externalOrderId: "ord-return-1",
      status: "paid",
      amount_q: 50,
      line_items_json: [
        {
          quantity: 1,
          name: "Latte",
          code: "LATTE",
          category: "coffee"
        }
      ],
      meta: {
        channel: "pos"
      }
    });

    assert.equal(order.ok, true);
    assert.equal(order.status, "POSTED");

    const firstReturn = await processOrderReturn({
      businessSlug: slug,
      externalReturnId: "ret-1",
      externalOrderId: "ord-return-1",
      reason: "customer_refund",
      meta: {
        operator: "manager"
      }
    });

    const secondReturn = await processOrderReturn({
      businessSlug: slug,
      externalReturnId: "ret-1",
      externalOrderId: "ord-return-1",
      reason: "customer_refund",
      meta: {
        operator: "manager"
      }
    });

    assert.equal(firstReturn.ok, true);
    assert.equal(firstReturn.outcome, "POSTED_REVERSED");
    assert.equal(secondReturn.ok, true);
    assert.equal(secondReturn.outcome, "POSTED_REVERSED");
    assert.equal(secondReturn.replay, true);
    assert.equal(firstReturn.orderReturnId, secondReturn.orderReturnId);

    const { rows: orderReturnRows } = await withAdminClient((client) => (
      client.query(
        `SELECT id, order_id, points_effect, outcome, reversal_transaction_id
         FROM order_returns
         WHERE business_id = $1 AND external_return_id = $2`,
        [businessId, "ret-1"]
      )
    ));
    assert.equal(orderReturnRows.length, 1);
    assert.equal(orderReturnRows[0].id, firstReturn.orderReturnId);
    assert.equal(orderReturnRows[0].outcome, "POSTED_REVERSED");
    assert.equal(Number(orderReturnRows[0].points_effect), -Number(order.pointsAwarded));
    assert.equal(orderReturnRows[0].reversal_transaction_id, firstReturn.reversalTransactionId);

    const { rows: balanceRows } = await withAdminClient((client) => (
      client.query(
        "SELECT points, pending_points, lifetime_points FROM customer_balances WHERE customer_id = $1",
        [customerId]
      )
    ));
    assert.equal(balanceRows.length, 1);
    assert.equal(Number(balanceRows[0].points), 0);
    assert.equal(Number(balanceRows[0].pending_points), 0);
    assert.equal(Number(balanceRows[0].lifetime_points), 0);
  });
});
