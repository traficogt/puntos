import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { before, beforeEach, after, describe, it } from "node:test";
import pg from "pg";

const databaseUrl = process.env.MERCHANT_OVERVIEW_TEST_DB_URL;
const integrationDescribe = databaseUrl ? describe : describe.skip;
const businessId = randomUUID();
const otherBusiness = randomUUID();
const branchA = randomUUID();
const branchB = randomUUID();
const otherBranch = randomUUID();
const customerA = randomUUID();
const customerB = randomUUID();
const deletedCustomer = randomUUID();
const otherCustomer = randomUUID();
const now = new Date("2026-11-10T18:00:00.000Z");
let client;
let getMerchantOverview;

integrationDescribe("merchant overview against disposable PostgreSQL", () => {
  before(async () => {
    const url = new URL(databaseUrl);
    assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "Use a disposable local PostgreSQL instance");
    assert.equal(url.pathname, "/merchant_overview_test", "Dedicated test database required");
    client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    // The fixture path is a constant relative to this test, never user input.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await client.query(await readFile(new URL("../fixtures/merchant-overview.sql", import.meta.url), "utf8"));
    ({ getMerchantOverview } = await import("../../src/app/services/merchant-overview-service.js"));
  });
  after(async () => { await client?.end(); });
  beforeEach(async () => {
    await client.query("TRUNCATE transactions, redemptions, rewards, customers, branches, businesses");
    await client.query("INSERT INTO businesses(id) VALUES($1),($2)", [businessId,otherBusiness]);
    await client.query("INSERT INTO branches VALUES ($1,$2),($3,$2),($4,$5)", [branchA, businessId, branchB, otherBranch, otherBusiness]);
    await client.query("INSERT INTO customers VALUES ($1,$2,NULL),($3,$2,NULL),($4,$2,now()),($5,$6,NULL)", [customerA, businessId, customerB, deletedCustomer, otherCustomer, otherBusiness]);
  });

  function overview(options = {}) {
    return getMerchantOverview({ businessId, days: 7, now, timezone: "America/Guatemala", ...options }, client.query.bind(client));
  }
  async function purchase(values = {}) {
    const tx = { id: randomUUID(), businessId, customerId: customerA, branchId: branchA, amount: 10, points: 0, visits: 0, items: 0, type: "PURCHASE", source: "online", status: "POSTED", at: now.toISOString().replace("18:00", "17:00"), original: null, reversed: null, ...values };
    await client.query(`INSERT INTO transactions (id,business_id,customer_id,branch_id,amount_q,points,type,source,status,created_at,original_transaction_id,reversed_transaction_id,visits,items)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, [tx.id, tx.businessId, tx.customerId, tx.branchId, tx.amount, tx.points, tx.type, tx.source, tx.status, tx.at, tx.original, tx.reversed, tx.visits, tx.items]);
  }
  async function redemption(values = {}) {
    const rewardId = values.rewardId ?? randomUUID();
    const r = { businessId, customerId: customerA, branchId: branchA, rewardBusiness: businessId, name: "Café", points: 50, status: "REDEEMED", at: "2026-11-10T17:00:00Z", redeemed: "2026-11-10T17:00:00Z", ...values };
    await client.query("INSERT INTO rewards VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [rewardId, r.rewardBusiness, r.name]);
    await client.query("INSERT INTO redemptions VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [randomUUID(), r.businessId, r.branchId, r.customerId, rewardId, r.points, r.status, r.at, r.redeemed]);
  }

  it("uses the saved USD timezone across both DST changes and midnight boundaries", async () => {
    await client.query("UPDATE businesses SET program_json=$2 WHERE id=$1",[businessId,{region:{country:"US",currency:"USD",timezone:"America/New_York"}}]);
    for(const [end,start,before,after,date] of [
      ["2026-03-09T16:00:00Z","2026-03-03T05:00:00.000Z","2026-03-09T03:59:59Z","2026-03-09T04:00:00Z","2026-03-09"],
      ["2026-11-02T17:00:00Z","2026-10-27T04:00:00.000Z","2026-11-02T04:59:59Z","2026-11-02T05:00:00Z","2026-11-02"]]){
      await client.query('TRUNCATE transactions');await purchase({amount:5,at:before});await purchase({amount:7,at:after});
      const result=await overview({timezone:undefined,now:new Date(end)});
      assert.equal(result.currency,"USD");assert.equal(result.timezone,"America/New_York");assert.equal(result.period.start,start);
      assert.equal(result.daily.at(-1).date,date);assert.equal(result.daily.at(-1).recorded_sales_q,7);assert.equal(result.daily.at(-2).recorded_sales_q,5);
    }
  });

  it("counts genuine sales including pending, zero-point/zero-amount visits and deleted-customer history", async () => {
    await purchase({ amount: 100 });
    await purchase({ amount: 50, source: "offline", status: "PENDING" });
    await purchase({ amount: 25, source: "external", customerId: customerB, branchId: null });
    await purchase({ amount: 10, source: "order", customerId: customerB, branchId: null });
    await purchase({ amount: 5, type: null, customerId: deletedCustomer });
    await purchase({ amount: 0, visits: 1, customerId: deletedCustomer });
    for (const source of ["lifecycle", "expire", "reversal", "redeem", "correction", "unknown"]) await purchase({ source, amount: 999 });
    for (const type of ["REFERRAL_REWARD", "ACHIEVEMENT", "CHALLENGE", "MANUAL_ADJUSTMENT", "REWARD"]) await purchase({ type, amount: 999 });
    await purchase({ status: "REVERSED", amount: 999 });
    await purchase({ status: "CANCELLED", amount: 999 });
    await purchase({ original: randomUUID(), amount: 999 });
    await purchase({ reversed: randomUUID(), amount: 999 });
    const result = await overview();
    assert.deepEqual(result.current, { recorded_sales_q: 190, purchases: 6, active_customers: 3, repeat_customers: 3, repeat_rate_pct: 100, average_ticket_q: 31.67, redemptions: 0 });
    assert.equal(result.daily.reduce((sum, row) => sum + row.purchases, 0), 6);
    assert.ok(result.notes.some(note => note.includes("eliminados")));
  });

  it("excludes empty awards from purchases, active customers, repeat rates and daily activity", async () => {
    await purchase({ amount: 0 });
    await purchase({ amount: 0 });
    await purchase({ amount: 0, at: "2026-11-01T12:00:00Z" });
    await purchase({ amount: 0, at: "2026-11-01T13:00:00Z" });
    const result = await overview();
    const empty = { recorded_sales_q: 0, purchases: 0, active_customers: 0, repeat_customers: 0, repeat_rate_pct: null, average_ticket_q: null, redemptions: 0 };
    assert.deepEqual(result.current, empty);
    assert.deepEqual(result.previous, empty);
    assert.ok(result.daily.every(row => row.purchases === 0 && row.recorded_sales_q === 0));
  });

  it("requires sale, visit or item activity even when an award has positive points", async () => {
    await purchase({ customerId: customerA, amount: 0, visits: 1 });
    await purchase({ customerId: customerB, amount: 0, items: 1 });
    await purchase({ customerId: customerB, amount: 0, points: 100 });
    const result = await overview();
    assert.equal(result.current.purchases, 2);
    assert.equal(result.current.active_customers, 2);
    assert.equal(result.current.repeat_customers, 0);
    assert.equal(result.current.repeat_rate_pct, 0);
  });

  it("defines repeat as two qualifying records per customer within the selected window", async () => {
    await purchase({ customerId: customerA, amount: 10 });
    await purchase({ customerId: customerA, amount: 11 });
    await purchase({ customerId: customerB, amount: 20 });
    await purchase({ customerId: deletedCustomer, amount: 30 });
    await purchase({ customerId: customerB, type: "ACHIEVEMENT", amount: 0 });
    await purchase({ customerId: customerB, source: "redeem", amount: 0 });
    await purchase({ customerId: customerB, at: "2026-11-01T12:00:00Z" });
    const result = await overview();
    assert.equal(result.current.active_customers, 3);
    assert.equal(result.current.repeat_customers, 1);
    assert.equal(result.current.repeat_rate_pct, 33.33);
    assert.equal(result.current.average_ticket_q, 17.75);
    assert.equal(result.previous.repeat_rate_pct, 0);
  });

  it("uses half-open current and comparable previous windows, excluding the intervening unfinished-day gap", async () => {
    await purchase({ amount: 1, at: "2026-11-04T06:00:00Z" });
    await purchase({ amount: 2, at: "2026-11-10T17:59:59.999Z" });
    await purchase({ amount: 3, at: "2026-10-28T06:00:00Z" });
    await purchase({ amount: 4, at: "2026-11-03T17:59:59.999Z" });
    for (const at of ["2026-10-28T05:59:59.999Z", "2026-11-03T18:00:00Z", "2026-11-04T05:59:59.999Z", "2026-11-10T18:00:00Z", "2026-11-11T01:00:00Z"]) await purchase({ amount: 999, at });
    const result = await overview();
    assert.deepEqual(result.period, { days: 7, start: "2026-11-04T06:00:00.000Z", end: now.toISOString(), previous_start: "2026-10-28T06:00:00.000Z", previous_end: "2026-11-03T18:00:00.000Z" });
    assert.equal(result.current.recorded_sales_q, 3);
    assert.equal(result.previous.recorded_sales_q, 7);
    assert.equal(result.generated_at, now.toISOString());
    assert.equal(result.currency, "GTQ");
  });

  it("zero-fills local calendar dates and groups near-midnight events in the configured timezone", async () => {
    await purchase({ amount: 5, at: "2026-11-05T05:59:59Z" });
    await purchase({ amount: 6, at: "2026-11-05T06:00:00Z" });
    const result = await overview();
    assert.equal(result.daily.length, 7);
    assert.deepEqual(result.daily.slice(0, 3), [
      { date: "2026-11-04", recorded_sales_q: 5, purchases: 1 },
      { date: "2026-11-05", recorded_sales_q: 6, purchases: 1 },
      { date: "2026-11-06", recorded_sales_q: 0, purchases: 0 }
    ]);
    assert.equal(result.daily[6].date, "2026-11-10");
    const utc = await overview({ timezone: "UTC" });
    assert.equal(utc.daily[0].recorded_sales_q, 0);
    assert.equal(utc.daily[1].recorded_sales_q, 11);
    assert.equal(utc.period.start, "2026-11-04T00:00:00.000Z");
  });

  it("has null unavailable rates, zero counts and 7/30/90 date series across year boundaries", async () => {
    for (const days of [7, 30, 90]) {
      const result = await overview({ days, now: new Date("2026-01-02T12:00:00Z") });
      assert.equal(result.daily.length, days);
      assert.deepEqual(result.current, { recorded_sales_q: 0, purchases: 0, active_customers: 0, repeat_customers: 0, repeat_rate_pct: null, average_ticket_q: null, redemptions: 0 });
      assert.deepEqual(result.previous, result.current);
      assert.deepEqual(result.rewards, []);
      assert.equal(Date.parse(result.period.end) - Date.parse(result.period.start), Date.parse(result.period.previous_end) - Date.parse(result.period.previous_start));
    }
  });

  it("scopes every aggregate by tenant and branch even without database RLS", async () => {
    await purchase({ amount: 100 });
    await purchase({ amount: 50, branchId: branchB });
    await purchase({ amount: 25, branchId: null });
    await purchase({ amount: 999, businessId: otherBusiness, customerId: otherCustomer, branchId: otherBranch });
    await purchase({ amount: 999, customerId: otherCustomer });
    await redemption();
    await redemption({ branchId: branchB });
    await redemption({ branchId: null });
    await redemption({ businessId: otherBusiness, customerId: otherCustomer, branchId: otherBranch, rewardBusiness: otherBusiness });
    await redemption({ customerId: otherCustomer });
    await redemption({ rewardBusiness: otherBusiness });
    const all = await overview();
    assert.equal(all.current.recorded_sales_q, 175);
    assert.equal(all.current.redemptions, 3);
    const branch = await overview({ branchId: branchA });
    assert.equal(branch.current.recorded_sales_q, 100);
    assert.equal(branch.current.redemptions, 1);
    assert.deepEqual(branch.scope, { branch_id: branchA });
    await assert.rejects(overview({ branchId: otherBranch }), { statusCode: 400 });
    await assert.rejects(overview({ branchId: randomUUID() }), { statusCode: 400 });
  });

  it("counts redeemed rewards by use date and stored point cost, including legacy timestamps only for REDEEMED", async () => {
    const rewardId = randomUUID();
    await redemption({ rewardId, points: 20, at: "2026-10-01T12:00:00Z" });
    await redemption({ rewardId, points: 30, redeemed: null });
    await redemption({ name: "Anterior", at: "2026-11-01T12:00:00Z", redeemed: "2026-11-01T12:00:00Z" });
    for (const status of ["PENDING", "CANCELLED", "EXPIRED"]) await redemption({ status });
    await redemption({ redeemed: "2026-11-10T18:00:00Z" });
    const result = await overview();
    assert.equal(result.current.redemptions, 2);
    assert.equal(result.previous.redemptions, 1);
    assert.deepEqual(result.rewards, [{ name: "Café", redemptions: 2, points_redeemed: 50 }]);
  });

  it("returns at most ten rewards ranked by redemption count without limiting total redemptions", async () => {
    for (let index = 0; index < 12; index += 1) await redemption({ name: `Reward ${String(index).padStart(2, "0")}` });
    const result = await overview();
    assert.equal(result.current.redemptions, 12);
    assert.equal(result.rewards.length, 10);
    assert.equal(result.rewards[0].name, "Reward 00");
  });
});
