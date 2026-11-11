import test from "node:test";
import assert from "node:assert/strict";
import { createPosIntegrationService } from "../../src/app/services/pos-integration-service.js";

function fixture(patch = {}) {
  const business = { id: "business-1", slug: "cafe", plan: "EMPRESA", program_type: "SPEND", program_json: { points_per_q: 1, external_awards: { enabled: true, api_key: "key" }, pos_integration: { enabled: true, mode: "api", revision: "r1", connected_at: "2026-11-09T10:00:00.000Z", loyverse: { access_token: "test-token", merchant_id: "m1" } } } };
  const awards = [], saves = [];
  const deps = { getBusiness: async () => business, getCustomer: async () => ({ id: "customer-1", business_id: business.id }), findTransaction: async () => null, award: async (args) => { awards.push(args); return { replay: false }; }, saveSettings: async (_id, value) => { saves.push(value); Object.assign(business.program_json, value); }, saveSync: async (_id, _revision, value) => { saves.push(value); Object.assign(business.program_json.pos_integration, value); }, lock: async (_id, fn) => fn(), hasFeature: async () => true, retryRefunds: async () => [], reconcileSaleRefunds: async () => [], now: () => new Date("2026-11-09T11:00:00.000Z"), ...patch };
  return { service: createPosIntegrationService(deps), business, awards, saves };
}
const sale = { saleId: "000123", customerPhone: "55554444", amountQ: 40, currency: "GTQ", status: "paid" };

test("local refund retries support API connections and recheck enabled state and entitlement", async () => {
  const calls = [];
  const f = fixture({ retryRefunds: async id => { calls.push(id); return []; } });
  assert.equal(typeof f.service.retryPosRefunds, "function");
  await f.service.retryPosRefunds(f.business.id);
  assert.deepEqual(calls, [f.business.id]);
  f.business.program_json.pos_integration.enabled = false;
  await assert.rejects(f.service.retryPosRefunds(f.business.id), { statusCode: 403 });
  const locked = fixture({ hasFeature: async () => false });
  await assert.rejects(locked.service.retryPosRefunds(locked.business.id), { statusCode: 403 });
});

test("Loyverse saves refunds before advancing, while partial cases stay out of the sale retry queue", async () => {
  const recorded = [];
  const refund = { refundId: "r1", originalSaleId: "s1", source: "loyverse:m1:s1", amountQ: 20, currency: "GTQ" };
  const f = fixture({ fetchSales: async () => ({ sales: [], issues: [], refunds: [refund], nextCursor: null }),
    enqueueRefund: async (id, value, options) => { assert.equal(id, "business-1"); assert.equal(f.saves.length, 0); assert.deepEqual(value, refund); assert.equal(options.origin, "loyverse"); recorded.push(value); return { refund: { id: "queued-refund" } }; },
    reconcileRefund: async (_id, id) => { assert.equal(id, "queued-refund"); return { refund: { status: "pending", reason: "partial_refund" } }; }
  });
  f.business.program_json.pos_integration.mode = "loyverse";
  const preview = await f.service.previewLoyverse(f.business.id);
  assert.equal(preview.refund_count, 1);
  assert.equal(recorded.length, 0);
  const result = await f.service.syncLoyverseBusiness(f.business.id);
  assert.equal(recorded.length, 1);
  assert.equal(result.result.refunds_pending, 1);
  assert.deepEqual(f.saves[0].pending_receipts, []);
  assert.equal(f.saves[0].last_completed_at, "2026-11-09T11:00:00.000Z");
});

test("Loyverse cannot advance when refund acceptance fails", async () => {
  const f = fixture({ fetchSales: async () => ({ sales: [], issues: [], refunds: [{ refundId: "r1" }], nextCursor: "next" }), enqueueRefund: async () => { throw new Error("storage unavailable"); } });
  f.business.program_json.pos_integration.mode = "loyverse";
  await assert.rejects(f.service.syncLoyverseBusiness(f.business.id), /storage unavailable/);
  assert.equal(f.saves.length, 1);
  assert.equal(Object.hasOwn(f.saves[0], "sync_window"), false);
});

test("API dry run checks customer and points without awarding", async () => {
  const { service, business, awards } = fixture();
  const result = await service.ingestPosSale(business, { ...sale, dryRun: true });
  assert.equal(result.summary.ready, 1);
  assert.equal(result.rows[0].points, 40);
  assert.equal(awards.length, 0);
});
test("POS previews reject awards beyond the ledger integer limit", async () => {
  const { service, business, awards } = fixture();
  business.program_json.points_per_q = 100000000;
  const result = await service.ingestPosSale(business, { ...sale, dryRun: true });
  assert.equal(result.summary.ready, 0);
  assert.equal(result.summary.errors, 1);
  assert.equal(awards.length, 0);
});
test("unknown customer is actionable and never automatically enrolled", async () => {
  const { service, business, awards } = fixture({ getCustomer: async () => null });
  const result = await service.ingestPosSale(business, sale);
  assert.equal(result.result.errors, 1);
  assert.match(result.result.issues[0].message, /registrado/i);
  assert.equal(awards.length, 0);
});
test("API requires a paid state and ITEM programs require whole positive quantities", async () => {
  const { service, business, awards } = fixture();
  for (const status of [undefined, "unpaid", "refunded", "paid_pending"]) await assert.rejects(service.ingestPosSale(business, { ...sale, status }), { statusCode: 400 });
  business.program_type = "ITEM";
  const result = await service.ingestPosSale(business, sale);
  assert.equal(result.result.errors, 1);
  assert.equal(awards.length, 0);
});
test("repeating a sale returns duplicate, while changed amounts produce an issue", async () => {
  const f = fixture();
  await f.service.ingestPosSale(f.business, sale);
  const recorded = f.awards[0];
  // PostgreSQL JSONB does not preserve property insertion order.
  recorded.meta.pos_sale = Object.fromEntries(Object.entries(recorded.meta.pos_sale).reverse());
  const { service, business, awards } = fixture({ findTransaction: async () => ({ customer_id: "customer-1", points: 40, meta: recorded.meta }) });
  assert.equal((await service.ingestPosSale(business, sale)).result.duplicates, 1);
  assert.equal((await service.ingestPosSale(business, { ...sale, amountQ: 50 })).result.errors, 1);
  assert.equal(awards.length, 0);
});
test("Loyverse skips historic receipts and stores a stable pagination window", async () => {
  const normalized = { ...sale, source: "loyverse:m1:s1", customerPhone: "50255554444", items: 1, visits: 1 };
  const f = fixture({ fetchSales: async () => ({ sales: [{ ...normalized, occurredAt: "2026-11-08T09:00:00Z" }, { ...normalized, saleId: "new", occurredAt: "2026-11-09T10:30:00Z" }], issues: [], nextCursor: "next-page" }) });
  f.business.program_json.pos_integration.mode = "loyverse";
  const result = await f.service.syncLoyverseBusiness(f.business.id);
  assert.equal(result.result.awarded, 1);
  assert.equal(result.result.ignored, 1);
  assert.equal(result.result.has_more, true);
  assert.equal(f.saves[0].sync_window.cursor, "next-page");
  assert.equal(f.saves[0].sync_window.until, "2026-11-09T11:00:00.000Z");
});
test("network failure leaves sync position unchanged and reports a safe error", async () => {
  const f = fixture({ fetchSales: async () => { throw new Error("No se pudo consultar Loyverse."); } });
  f.business.program_json.pos_integration.mode = "loyverse";
  await assert.rejects(f.service.syncLoyverseBusiness(f.business.id));
  assert.equal(f.saves.length, 1);
  assert.equal(f.saves[0].last_sync.status, "error");
  assert.equal(Object.hasOwn(f.saves[0], "sync_window"), false);
});
test("a sale with an unmatched customer is retried after the scan window passes", async () => {
  const receipt = { ...sale, source: "loyverse:m1:s1", occurredAt: "2026-11-09T10:30:00Z" };
  let registered = false, pages = 0;
  const f = fixture({
    getCustomer: async () => registered ? { id: "customer-1", business_id: "business-1" } : null,
    fetchSales: async () => ({ sales: pages++ === 0 ? [receipt] : [], issues: [], nextCursor: null }),
    fetchRetrySales: async ({ receiptIds }) => { assert.deepEqual(receiptIds, ["000123"]); return { sales: [receipt], issues: [] }; }
  });
  f.business.program_json.pos_integration.mode = "loyverse";
  assert.equal((await f.service.syncLoyverseBusiness(f.business.id)).result.errors, 1);
  assert.deepEqual(f.business.program_json.pos_integration.pending_receipts, ["000123"]);
  registered = true;
  assert.equal((await f.service.syncLoyverseBusiness(f.business.id)).result.awarded, 1);
  assert.deepEqual(f.business.program_json.pos_integration.pending_receipts, []);
});
test("connection validation occurs before settings are saved", async () => {
  const f = fixture({ verifyConnection: async () => { throw new Error("Moneda incompatible"); } });
  await assert.rejects(f.service.configurePosIntegration(f.business.id, { enabled: true, mode: "loyverse", loyverse: { access_token: "a-new-token" } }), /Moneda/);
  assert.equal(f.saves.length, 0);
});
test("saving a connection preserves a key rotated during remote verification", async () => {
  const f = fixture();
  const service = createPosIntegrationService({
    getBusiness: async () => structuredClone(f.business),
    hasFeature: async () => true,
    lock: async (_id, fn) => fn(),
    verifyConnection: async () => {
      f.business.program_json.external_awards.api_key = "concurrently-rotated-key";
      return { merchantId: "m1", merchantName: "Merchant", storeId: null };
    },
    saveSettings: async (_id, patch) => {
      const external = { ...f.business.program_json.external_awards, ...patch.external_awards };
      Object.assign(f.business.program_json, patch, { external_awards: external });
    }
  });
  await service.configurePosIntegration(f.business.id, { enabled: true, mode: "loyverse" });
  assert.equal(f.business.program_json.external_awards.api_key, "concurrently-rotated-key");
});
test("rotating a key does not re-enable a concurrently disabled legacy connection", async () => {
  const f = fixture();
  const service = createPosIntegrationService({
    getBusiness: async () => structuredClone(f.business),
    hasFeature: async () => {
      f.business.program_json.external_awards.enabled = false;
      return true;
    },
    lock: async (_id, fn) => fn(),
    saveSettings: async (_id, patch) => {
      Object.assign(f.business.program_json.external_awards, patch.external_awards);
    }
  });
  const rotated = await service.rotatePosKey(f.business.id);
  assert.equal(f.business.program_json.external_awards.enabled, false);
  assert.equal(f.business.program_json.external_awards.api_key, rotated.api_key);
});
test("full recovery queue retains every older failed receipt and holds the new page", async () => {
  const pending = Array.from({ length: 500 }, (_, i) => `old-${i}`);
  const receipt = { ...sale, source: "loyverse:m1:s1", occurredAt: "2026-11-09T10:30:00Z" };
  const f = fixture({ getCustomer: async () => null,
    fetchSales: async () => ({ sales: Array.from({ length: 100 }, (_, i) => ({ ...receipt, saleId: `new-${i}` })), issues: [], nextCursor: "page2" }),
    fetchRetrySales: async ({ receiptIds }) => ({ sales: receiptIds.map(saleId => ({ ...receipt, saleId })), issues: [] })
  });
  Object.assign(f.business.program_json.pos_integration, { mode: "loyverse", pending_receipts: pending });
  const out = await f.service.syncLoyverseBusiness(f.business.id);
  assert.equal(out.result.issues[0].code, "RETRY_QUEUE_FULL");
  assert.deepEqual(new Set(f.business.program_json.pos_integration.pending_receipts), new Set(pending));
  assert.equal(f.business.program_json.pos_integration.sync_window.cursor, null);
  assert.equal(f.business.program_json.pos_integration.last_completed_at, null);
});
test("disabled connections and lost plan entitlement cannot award", async () => {
  const f = fixture({ hasFeature: async () => false });
  await assert.rejects(f.service.ingestPosSale(f.business, sale), { statusCode: 403 });
  const g = fixture();
  g.business.program_json.pos_integration.enabled = false;
  await assert.rejects(g.service.ingestPosSale(g.business, sale), { statusCode: 403 });
});

test("trusted POS awards carry expected GTQ without changing legacy receipt metadata",async()=>{
  const {service,business,awards}=fixture();await service.ingestPosSale(business,sale);
  assert.equal(awards[0].expectedCurrency,'GTQ');assert.equal(awards[0].meta.pos_sale.currency,undefined);
});
