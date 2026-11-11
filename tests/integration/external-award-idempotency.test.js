import crypto from "node:crypto";
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

import { awardFromExternalEventWithDeps } from "../../src/app/services/external-award-service.js";
import { BusinessRepo } from "../../src/app/repositories/business-repository.js";
import { CustomerRepo } from "../../src/app/repositories/customer-repository.js";
import { closeDatabase, dbQuery, runWithDbContext, setCurrentTenant, withDbClientContext, withTransaction } from "../../src/app/database.js";

const runIntegration = process.env.RUN_INTEGRATION === "true";
const integrationDescribe = runIntegration ? describe : describe.skip;
const createdBusinessIds = [];

async function createFixture() {
  const suffix = crypto.randomUUID().slice(0, 8);
  const businessId = crypto.randomUUID();
  const customerId = crypto.randomUUID();
  const slug = `ext-award-${suffix}`;
  const pointsAwarded = 50;

  await withDbClientContext({ platformAdmin: true, tenantId: null }, async () => {
    await BusinessRepo.create({
      id: businessId,
      name: `External Award ${suffix}`,
      slug,
      email: `owner-ext-${suffix}@example.com`,
      phone: "+50255550123",
      password_hash: "test-hash",
      category: "cafe",
      plan: "EMPRESA",
      program_type: "SPEND",
      program_json: {
        external_awards: {
          enabled: true,
          api_key: "test-secret"
        }
      }
    });
    await CustomerRepo.create({
      id: customerId,
      business_id: businessId,
      phone: `+50255${Math.floor(Math.random() * 1000000).toString().padStart(6, "0")}`,
      name: "External Award Customer"
    });
  });

  createdBusinessIds.push(businessId);
  return { businessId, customerId, slug, pointsAwarded };
}

after(async () => {
  if (!createdBusinessIds.length) return;
  // Fixture deletion requires the test administrator; the application role
  // deliberately cannot delete businesses. Keep the award itself restricted.
  const client = new pg.Client({
    host: process.env.TEST_DB_HOST || process.env.DB_HOST || "localhost",
    port: Number(process.env.TEST_DB_PORT || process.env.DB_PORT || 5432),
    database: process.env.TEST_DB_NAME || process.env.DB_NAME || "puntos",
    user: process.env.TEST_DB_USER || process.env.DB_MIGRATIONS_USER || process.env.DB_USER || "postgres",
    password: process.env.TEST_DB_PASSWORD || process.env.DB_MIGRATIONS_PASSWORD || process.env.DB_PASSWORD || ""
  });
  try {
    await client.connect();
    for (const businessId of createdBusinessIds.splice(0)) {
      await client.query("DELETE FROM businesses WHERE id = $1", [businessId]);
    }
  } finally {
    await client.end().catch(() => {});
    await closeDatabase().catch(() => {});
  }
});

integrationDescribe("External award idempotency integration", () => {
  it("deduplicates concurrent external award requests by externalEventId", async () => {
    const { businessId, customerId, slug, pointsAwarded } = await createFixture();
    const externalEventId = `evt-${crypto.randomUUID()}`;

    let holdDays = 0;
    const deps = {
      withTransaction,
      setCurrentTenant,
      BusinessRepo: {
        getPublicBySlug: async (candidateSlug) => (candidateSlug === slug ? { id: businessId, slug } : null),
        getById: async (id) => (id === businessId ? {
          id: businessId,
          program_json: {
            pending_points_hold_days: holdDays,
            external_awards: {
              enabled: true,
              api_key: "test-secret"
            }
          }
        } : null)
      },
      CustomerRepo: {
        getById: async (id) => (id === customerId ? { id: customerId, business_id: businessId } : null),
        getByBusinessAndPhone: async () => null
      },
      computePoints: () => pointsAwarded,
      timingSafeEqualString: (a, b) => a === b
    };

    const invoke = (meta) => runWithDbContext({ tenantId: null, platformAdmin: false, webhookIngest: false }, () => (
      awardFromExternalEventWithDeps(deps, {
        businessSlug: slug,
        apiKey: undefined,
        externalEventId,
        customerId,
        customerPhone: undefined,
        amount_q: 50,
        visits: 1,
        items: 2,
        meta,
        skipApiKeyCheck: true
      })
    ));

    const meta = { source: "integration", receipt: { amount: 50, currency: "GTQ" } };
    const [first, second] = await Promise.all([invoke(meta), invoke(meta)]);

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(first.transactionId, second.transactionId);
    assert.equal(Number(first.pointsAwarded), Number(second.pointsAwarded));
    assert.ok(first.replay === true || second.replay === true);
    holdDays = 3;
    const replay = await invoke({ receipt: { currency: "GTQ", amount: 50 }, source: "integration" });
    assert.equal(replay.transactionId, first.transactionId);
    assert.equal(replay.status, "POSTED");
    assert.equal(replay.replay, true);
    await assert.rejects(invoke({ ...meta, source: "changed-payload" }), { statusCode: 409, message: /different payload/ });

    const { rows: txRows } = await withDbClientContext({ platformAdmin: true, tenantId: null }, async () => (
      dbQuery(
        `SELECT id, points, source, meta->>'external_event_id' AS external_event_id
         FROM transactions
         WHERE business_id = $1
           AND customer_id = $2
           AND source = 'external'
           AND meta->>'external_event_id' = $3`,
        [businessId, customerId, externalEventId]
      )
    ));
    assert.equal(txRows.length, 1);
    assert.equal(String(txRows[0].external_event_id), externalEventId);

    const { rows: balanceRows } = await withDbClientContext({ platformAdmin: true, tenantId: null }, async () => (
      dbQuery("SELECT points, pending_points, lifetime_points FROM customer_balances WHERE customer_id = $1", [customerId])
    ));
    assert.equal(balanceRows.length, 1);
    assert.equal(Number(balanceRows[0].points), Number(txRows[0].points));
    assert.equal(Number(balanceRows[0].pending_points), 0);
    assert.equal(Number(balanceRows[0].lifetime_points), Number(txRows[0].points));
  });
});
