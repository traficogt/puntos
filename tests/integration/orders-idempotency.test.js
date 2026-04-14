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
      dbQuery(
        "SELECT id, transaction_id FROM orders WHERE business_id = $1 AND external_order_id = $2",
        [businessId, "ord-1"]
      )
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
