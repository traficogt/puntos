import { test, expect } from "@playwright/test";
import { startPwaStaticServer } from "../integration/helpers/pwa-static-server.js";

let server;
test.beforeAll(async () => { server = await startPwaStaticServer(); });
test.afterAll(async () => { await server.stop(); });
test.beforeEach(async ({ page }) => { await page.goto(`${server.baseUrl}/pwa-test/index.html`); });

test("award storage is scoped to business and staff and requires identity for reads", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const db = await import("/idb.js");
    await db.addAward({ txId: "a", businessId: "business-a", staffId: "staff-a" });
    await db.addAward({ txId: "b", businessId: "business-a", staffId: "staff-b" });
    await db.addAward({ txId: "c", businessId: "business-c", staffId: "staff-a" });
    return { scoped: (await db.listAwards({ businessId: "business-a", staffId: "staff-a" })).map((row) => row.txId), unscoped: await db.listAwards() };
  });
  expect(result).toEqual({ scoped: ["a"], unscoped: [] });
});

test("legacy awards remain quarantined and cannot be synchronized by a new account", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const db = await import("/idb.js");
    await db.addAward({ txId: "legacy", customerQrToken: "old-account-token" });
    const scope = { businessId: "business-a", staffId: "staff-a" };
    await db.requeueSyncingAwards(scope);
    return { rows: await db.listAwards(scope), stats: await db.getAwardQueueStats(scope) };
  });
  expect(result.rows).toEqual([]);
  expect(result.stats.quarantined).toBe(1);
});

test("updates and acknowledgments cannot mutate a different staff account's queue", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const db = await import("/idb.js");
    const original = { businessId: "business-a", staffId: "staff-a" };
    const other = { businessId: "business-a", staffId: "staff-b" };
    await db.addAward({ txId: "sale", ...original });
    await db.updateAward("sale", { status: "failed" }, other);
    await db.deleteAward("sale", other);
    return await db.listAwards(original);
  });
  expect(result).toHaveLength(1);
  expect(result[0].status).toBe("queued");
});

test("reusing a transaction UUID cannot overwrite its original queued sale", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const db = await import("/idb.js");
    const scope = { businessId: "business-a", staffId: "staff-a" };
    await db.addAward({ txId: "sale", ...scope, amount_q: 10 });
    let rejected = false;
    try { await db.addAward({ txId: "sale", ...scope, amount_q: 99 }); } catch { rejected = true; }
    return { rejected, rows: await db.listAwards(scope) };
  });
  expect(result.rejected).toBe(true);
  expect(result.rows[0].amount_q).toBe(10);
});

test("customer wallet cache switches identity atomically and rejects stale section writes", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const db = await import("/idb.js");
    const first = { businessId: "business-a", customerId: "customer-a" };
    const second = { businessId: "business-b", customerId: "customer-b" };
    const me = (scope) => ({ business: { id: scope.businessId }, customer: { id: scope.customerId } });
    await db.putCustomerCache("me", me(first), first);
    await db.putCustomerCache("history", { private: "first-customer-history" }, first);
    await db.putCustomerCache("me", me(second), second);
    let rejected = false;
    try { await db.putCustomerCache("rewards", { private: "late-first-response" }, first); } catch { rejected = true; }
    return { rejected, previous: await db.getCustomerCacheSnapshot(first), current: await db.getCustomerCacheSnapshot(second), unscoped: await db.getCustomerCacheSnapshot() };
  });
  expect(result.rejected).toBe(true);
  expect(result.previous.sections).toEqual({});
  expect(result.unscoped.sections).toEqual({});
  expect(Object.keys(result.current.sections)).toEqual(["me"]);
});

test("clearing the wallet cache prevents stale non-me responses from restoring private data", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const db = await import("/idb.js");
    const scope = { businessId: "business-a", customerId: "customer-a" };
    await db.putCustomerCache("me", { business: { id: scope.businessId }, customer: { id: scope.customerId } }, scope);
    await db.clearCustomerCache();
    let rejected = false;
    try { await db.putCustomerCache("history", { private: true }, scope); } catch { rejected = true; }
    return { rejected, snapshot: await db.getCustomerCacheSnapshot(scope) };
  });
  expect(result.rejected).toBe(true);
  expect(result.snapshot.sections).toEqual({});
});
