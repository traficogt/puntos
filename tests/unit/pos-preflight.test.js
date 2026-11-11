import test from "node:test";
import assert from "node:assert/strict";
import { createPosIntegrationService } from "../../src/app/services/pos-integration-service.js";

const sale = { saleId: "caja-123", source: "caja-principal", customerPhone: "55554444", amountQ: 40, currency: "GTQ", status: "paid", items: 2 };
function fixture(overrides = {}) {
  const lookups = [];
  const business = { id: "business-1", slug: "cafe", plan: "EMPRESA", program_type: "SPEND", program_json: { points_per_q: 1 } };
  const forbiddenOperation = async () => { assert.fail("A preflight must never write, award, lock or contact a POS"); };
  const service = createPosIntegrationService({
    getBusiness: async id => { assert.equal(id, business.id); return business; },
    getCustomer: async (id, phone) => { lookups.push([id, phone]); return { id: "customer-1", business_id: id }; },
    findTransaction: async id => { assert.equal(id, business.id); return null; },
    hasFeature: async () => true,
    award: forbiddenOperation, saveSettings: forbiddenOperation, saveSync: forbiddenOperation,
    lock: forbiddenOperation, verifyConnection: forbiddenOperation, fetchSales: forbiddenOperation, fetchRetrySales: forbiddenOperation,
    ...overrides
  });
  return { service, business, lookups };
}
test("owner preflight checks an unconfigured connection without enabling it or awarding points", async () => {
  const { service, business, lookups } = fixture();
  assert.equal(typeof service.previewPosSale, "function", "an owner preview must be available before activation");
  const result = await service.previewPosSale(business.id, sale);
  assert.equal(result.dryRun, true);
  assert.equal(result.summary.ready, 1);
  assert.equal(result.rows[0].points, 40);
  assert.deepEqual(lookups, [[business.id, "50255554444"]]);
  assert.deepEqual(business.program_json, { points_per_q: 1 });
});
test("preflight rejects lost plan access before looking up customers", async () => {
  const { service, business, lookups } = fixture({ hasFeature: async () => false });
  await assert.rejects(() => service.previewPosSale(business.id, sale), { statusCode: 403 });
  assert.deepEqual(lookups, []);
});
test("preflight cannot match a customer from another business", async () => {
  const { service, business } = fixture({ getCustomer: async () => ({ id: "other-customer", business_id: "other-business" }) });
  const result = await service.previewPosSale(business.id, sale);
  assert.equal(result.summary.ready, 0);
  assert.equal(result.rows[0].code, "SALE_404");
  assert.equal(JSON.stringify(result).includes("other-customer"), false);
});
test("preflight requires the normalized paid receipt contract and bounded input", async () => {
  const { service, business, lookups } = fixture();
  for (const input of [
    { ...sale, status: "refunded" }, { ...sale, dryRun: false },
    { ...sale, businessId: "other-business" }, { ...sale, url: "https://example.invalid" },
    { ...sale, customerPhone: "5".repeat(41) }, { ...sale, saleId: "s".repeat(201) },
    { ...sale, source: "s".repeat(181) }, { ...sale, amountQ: "40" },
    { ...sale, amountQ: 40.001 }, { ...sale, amountQ: -1 },
    { ...sale, currency: "USD" }, { ...sale, items: 1.5 }
  ]) await assert.rejects(() => service.previewPosSale(business.id, input), { statusCode: 400 });
  assert.deepEqual(lookups, []);
});
test("preflight reports duplicate and changed receipts using the same production identity", async () => {
  const existing = { customer_id: "customer-1", points: 40, meta: { pos_sale: { saleId: sale.saleId, source: sale.source, customerPhone: "50255554444", amountQ: 40, items: 2 } } };
  const { service, business } = fixture({ findTransaction: async () => existing });
  assert.equal((await service.previewPosSale(business.id, sale)).summary.duplicates, 1);
  const changed = await service.previewPosSale(business.id, { ...sale, amountQ: 41 });
  assert.equal(changed.rows[0].code, "SALE_409");
  assert.equal(changed.summary.ready, 0);
});
