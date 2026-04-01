import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { awardFromExternalEventWithDeps } = await import("../../src/app/services/external-award-service.js");

/**
 * @param {{ client?: { query: (...args: any[]) => Promise<any> }, customerId?: string }} [options]
 */
function makeDeps({ client, customerId = "cust-1" } = {}) {
  return {
    withTransaction: async (fn) => fn(client),
    setCurrentTenant: async () => {},
    BusinessRepo: {
      getPublicBySlug: async () => ({ id: "biz-1" }),
      getById: async () => ({
        id: "biz-1",
        program_json: {
          external_awards: {
            enabled: true,
            api_key: "secret"
          }
        }
      })
    },
    CustomerRepo: {
      getById: async () => ({ id: customerId, business_id: "biz-1" }),
      getByBusinessAndPhone: async () => null
    },
    computePoints: () => 22,
    timingSafeEqualString: (a, b) => a === b
  };
}

describe("awardFromExternalEvent", () => {
  it("returns the existing transaction when the same externalEventId is replayed", async () => {
    let locked = false;
    const deps = makeDeps({
      client: {
        query: async (sql) => {
          if (sql.includes("pg_advisory_xact_lock")) {
            locked = true;
            return { rows: [{ pg_advisory_xact_lock: null }], rowCount: 1 };
          }
          if (sql.includes("meta->>'external_event_id'")) {
            return {
              rows: [{
                id: "tx-existing",
                customer_id: "cust-1",
                points: 22,
                status: "POSTED",
                available_at: null
              }],
              rowCount: 1
            };
          }
          throw new Error(`Unexpected query in external replay test: ${sql}`);
        }
      }
    });

    const out = await awardFromExternalEventWithDeps(deps, {
      businessSlug: "biz",
      apiKey: "secret",
      externalEventId: "evt-1",
      customerId: "cust-1",
      customerPhone: undefined
    });

    assert.deepEqual(out, {
      ok: true,
      transactionId: "tx-existing",
      customerId: "cust-1",
      pointsAwarded: 22,
      status: "POSTED",
      availableAt: null,
      replay: true
    });
    assert.equal(locked, true);
  });

  it("locks and inserts a new external award when no replay exists", async () => {
    let insertAttempted = false;
    let locked = false;
    const deps = makeDeps({
      client: {
        query: async (sql, params) => {
          if (sql.includes("pg_advisory_xact_lock")) {
            locked = true;
            return { rows: [{ pg_advisory_xact_lock: null }], rowCount: 1 };
          }
          if (sql.includes("meta->>'external_event_id'")) {
            return { rows: [], rowCount: 0 };
          }
          if (sql.includes("INSERT INTO transactions")) {
            insertAttempted = true;
            return { rows: [], rowCount: 1 };
          }
          if (sql.includes("UPDATE customer_balances")) {
            return { rows: [], rowCount: 1 };
          }
          throw new Error(`Unexpected query in external race test: ${sql} :: ${params}`);
        }
      }
    });

    const out = await awardFromExternalEventWithDeps(deps, {
      businessSlug: "biz",
      apiKey: "secret",
      externalEventId: "evt-2",
      customerId: "cust-1",
      customerPhone: undefined
    });

    assert.equal(locked, true);
    assert.equal(insertAttempted, true);
    assert.ok(typeof out.transactionId === "string");
    assert.equal(out.pointsAwarded, 22);
    assert.equal(out.replay, undefined);
  });

  it("rejects a replay when the same externalEventId is reused with a different payload", async () => {
    const deps = makeDeps({
      client: {
        query: async (sql) => {
          if (sql.includes("pg_advisory_xact_lock")) {
            return { rows: [{ pg_advisory_xact_lock: null }], rowCount: 1 };
          }
          if (sql.includes("meta->>'external_event_id'")) {
            return {
              rows: [{
                id: "tx-existing",
                customer_id: "cust-1",
                points: 22,
                status: "POSTED",
                available_at: null,
                meta: { external_request_fingerprint: "different-fingerprint" }
              }],
              rowCount: 1
            };
          }
          throw new Error(`Unexpected query in external mismatch test: ${sql}`);
        }
      }
    });

    await assert.rejects(
      () => awardFromExternalEventWithDeps(deps, {
        businessSlug: "biz",
        apiKey: "secret",
        externalEventId: "evt-3",
        customerId: "cust-1",
        customerPhone: undefined,
        amount_q: 99,
        visits: 3,
        items: 4
      }),
      /different payload/
    );
  });
});
