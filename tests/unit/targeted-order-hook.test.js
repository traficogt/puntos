import test from "node:test";
import assert from "node:assert/strict";
import { processOrderWithDeps } from "../../src/app/services/order-service.js";

test("order integration includes the targeted bonus in ledger, balance, receipt and replay without invoking it twice", async () => {
  /** @type {any} */
  let stored = null;
  let hookCalls = 0;
  const writes = [];
  const client = {
    query: async (sql, values) => {
      writes.push({ sql, values });
      return { rows: [], rowCount: 1 };
    },
  };
  const business = {
    id: "business",
    plan: "NEGOCIO",
    program_json: {
      targeted_offers_enabled: true,
      pending_points_hold_days: 7,
    },
  };
  const deps = {
    withTransaction: async (fn) => fn(client),
    setCurrentTenant: async () => {},
    BusinessRepo: {
      getPublicBySlug: async () => business,
      getById: async () => business,
    },
    CustomerRepo: {
      getById: async () => ({ id: "customer", business_id: "business" }),
    },
    OrderRepo: {
      findByBusinessAndExternalId: async () => stored,
      create: async (_client, data) => {
        stored = { id: "order", ...data };
        return stored;
      },
    },
    computePoints: () => 10,
    hashPayload: () => "stable-fingerprint",
    claimTargetedOffer: async (input) => {
      assert.equal(input.client, client);
      assert.equal(input.source, "order");
      assert.equal(input.amountQ, 25);
      assert.equal(input.basePoints, 10);
      hookCalls++;
      return { bonusPoints: 50, campaignId: "campaign" };
    },
  };
  const input = {
    businessSlug: "test",
    externalOrderId: "receipt",
    customerId: "customer",
    amount_q: 25,
    status: "paid",
  };
  const first = await processOrderWithDeps(deps, input);
  assert.equal(first.pointsAwarded, 60);
  assert.equal(first.status, "PENDING");
  assert.equal(stored.points_awarded, 60);
  assert.equal(
    writes.find((w) => w.sql.includes("INSERT INTO transactions")).values[4],
    60,
  );
  assert.equal(
    writes.find((w) => w.sql.includes("UPDATE customer_balances")).values[1],
    60,
  );
  const replay = await processOrderWithDeps(deps, input);
  assert.equal(replay.pointsAwarded, 60);
  assert.equal(replay.replay, true);
  assert.equal(hookCalls, 1);
});
