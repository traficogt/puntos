import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

const { awardFromExternalEventWithDeps } = await import("../../src/app/services/external-award-service.js");
const { AuditRepo } = await import("../../src/app/repositories/audit-repository.js");

beforeEach((t) => {
  assert.ok("mock" in t);
  t.mock.method(AuditRepo, "log", async () => {});
});

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
  it("rejects a prepared GTQ purchase when the locked business has changed currency", async () => {
    let inserted=false;
    const deps={...makeDeps({client:{query:async sql=>{if(sql.includes('INSERT INTO transactions'))inserted=true;return {rows:[],rowCount:1};}}}),
      protectedEarningBusiness:async()=>({id:'biz-1',program_json:{region:{country:'US',currency:'USD',timezone:'America/New_York'}}})};
    await assert.rejects(awardFromExternalEventWithDeps(deps,{businessSlug:'biz',apiKey:'secret',externalEventId:'gtq-before-change',customerId:'cust-1',amount_q:100,expectedCurrency:'GTQ',meta:{pos_sale:{saleId:'sale',amountQ:100}}}),{statusCode:400,code:'CURRENCY_MISMATCH'});
    assert.equal(inserted,false);
  });
  it("keeps GTQ fingerprints replayable when trusted currency validation is added", async () => {
    /** @type {Record<string,any>|null} */
    let transaction=null;let inserts=0;
    const deps=makeDeps({client:{query:async(sql,params)=>{
      if(sql.includes("meta->>'external_event_id'"))return {rows:transaction?[transaction]:[],rowCount:transaction?1:0};
      if(sql.includes('INSERT INTO transactions')){inserts++;transaction={id:params[0],customer_id:params[2],amount_q:params[3],visits:params[4],items:params[5],points:params[6],status:params[7],available_at:params[8],meta:params[9]};}
      return {rows:[],rowCount:1};
    }}});
    const request={businessSlug:'biz',apiKey:'secret',externalEventId:'legacy-gtq-pos',customerId:'cust-1',amount_q:22,meta:{pos_sale:{saleId:'legacy',amountQ:22}}};
    const first=await awardFromExternalEventWithDeps(deps,request);
    const replay=await awardFromExternalEventWithDeps(deps,{...request,expectedCurrency:'GTQ'});
    assert.equal(replay.transactionId,first.transactionId);assert.equal(replay.replay,true);assert.equal(inserts,1);assert.ok(transaction);assert.equal(transaction.meta.pos_sale.currency,undefined);
  });

  it("replays the original award after metadata reordering and program hold changes", async () => {
    let transaction = null;
    let inserts = 0;
    const deps = makeDeps({ client: { query: async (sql, params) => {
      if (sql.includes("meta->>'external_event_id'")) return { rows: transaction ? [transaction] : [], rowCount: transaction ? 1 : 0 };
      if (sql.includes("INSERT INTO transactions")) {
        inserts += 1;
        transaction = { id: params[0], customer_id: params[2], amount_q: params[3], visits: params[4], items: params[5], points: params[6], status: params[7], available_at: params[8], meta: params[9] };
      }
      return { rows: [], rowCount: 1 };
    } } });
    const request = { businessSlug: "biz", apiKey: "secret", externalEventId: "stable-retry", customerId: "cust-1", amount_q: 22, visits: 1, items: 2, meta: { receipt: { total: 22, currency: "GTQ" }, source: "pos" } };
    const first = await awardFromExternalEventWithDeps(deps, request);
    const getBusiness = deps.BusinessRepo.getById;
    deps.BusinessRepo.getById = async () => {
      const business = await getBusiness();
      return { ...business, program_json: { ...business.program_json, pending_points_hold_days: 7 } };
    };
    deps.computePoints = () => 99;
    const replay = await awardFromExternalEventWithDeps(deps, { ...request, meta: { source: "pos", receipt: { currency: "GTQ", total: 22 } } });
    assert.equal(replay.transactionId, first.transactionId);
    assert.equal(replay.pointsAwarded, 22);
    assert.equal(replay.status, "POSTED");
    assert.equal(replay.replay, true);
    assert.equal(inserts, 1);
    await assert.rejects(awardFromExternalEventWithDeps(deps, { ...request, amount_q: 23 }), { statusCode: 409 });
    await assert.rejects(awardFromExternalEventWithDeps(deps, { ...request, meta: { source: "other" } }), { statusCode: 409 });
  });

  it("accepts reordered legacy fingerprints using the stored request while rejecting changed sale values", async () => {
    const originalMeta = { source: "pos", receipt: { total: 22, currency: "GTQ" } };
    const fingerprint = crypto.createHash("sha256").update(`external-award:${JSON.stringify({ customerId: "cust-1", amountQ: 22, visits: 1, items: 2, status: "PENDING", meta: originalMeta })}`).digest("hex");
    const deps = makeDeps({ client: { query: async (sql) => {
      if (sql.includes("meta->>'external_event_id'")) return { rows: [{ id: "legacy-transaction", customer_id: "cust-1", amount_q: "22.00", visits: 1, items: 2, points: 22, status: "POSTED", available_at: null, meta: { ...originalMeta, external_event_id: "legacy-retry", external_request_fingerprint: fingerprint } }], rowCount: 1 };
      assert.ok(!sql.includes("INSERT"));
      return { rows: [], rowCount: 1 };
    } } });
    const request = { businessSlug: "biz", apiKey: "secret", externalEventId: "legacy-retry", customerId: "cust-1", amount_q: 22, visits: 1, items: 2, meta: { receipt: { currency: "GTQ", total: 22 }, source: "pos" } };
    const replay = await awardFromExternalEventWithDeps(deps, request);
    assert.equal(replay.transactionId, "legacy-transaction");
    assert.equal(replay.replay, true);
    await assert.rejects(awardFromExternalEventWithDeps(deps, { ...request, items: 3 }), { statusCode: 409 });
    await assert.rejects(awardFromExternalEventWithDeps(deps, { ...request, meta: { receipt: { currency: "USD", total: 22 }, source: "pos" } }), { statusCode: 409 });
  });

  it("rejects an award when its balance row is missing so the transaction rolls back", async () => {
    let committed = false;
    const deps = makeDeps({ client: { query: async (sql) => {
      if (sql.includes("meta->>'external_event_id'")) return { rows: [], rowCount: 0 };
      if (sql.includes("UPDATE customer_balances")) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    } } });
    const transaction = deps.withTransaction;
    deps.withTransaction = async (fn) => {
      const result = await transaction(fn);
      committed = true;
      return result;
    };
    await assert.rejects(awardFromExternalEventWithDeps(deps, {
      businessSlug: "biz", apiKey: "secret", externalEventId: "missing-balance", customerId: "cust-1", amount_q: 22
    }), { statusCode: 409, message: /balance/i });
    assert.equal(committed, false);
  });

  it("rejects invalid or out-of-range computed awards before inserting ledger rows", async () => {
    for (const points of [-1, 0.5, NaN, Infinity, 2147483648]) {
      let inserted = false;
      const deps = makeDeps({ client: { query: async (sql) => {
        if (sql.includes("INSERT INTO transactions")) inserted = true;
        return { rows: [], rowCount: 1 };
      } } });
      deps.computePoints = () => points;
      await assert.rejects(awardFromExternalEventWithDeps(deps, {
        businessSlug: "biz", apiKey: "secret", externalEventId: "invalid-points", customerId: "cust-1"
      }), { statusCode: 400 });
      assert.equal(inserted, false);
    }
  });

  it("rejects money and quantities that cannot be stored in ledger columns", async () => {
    for (const values of [{ amount_q: 100000000 }, { amount_q: 1.001 }, { visits: 2147483648 }, { items: 2147483648 }]) {
      let accessedLedger = false;
      const deps = makeDeps({ client: { query: async () => {
        accessedLedger = true;
        return { rows: [], rowCount: 1 };
      } } });
      await assert.rejects(awardFromExternalEventWithDeps(deps, {
        businessSlug: "biz", apiKey: "secret", externalEventId: "invalid-values", customerId: "cust-1", ...values
      }), { statusCode: 400 });
      assert.equal(accessedLedger, false);
    }
  });

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
