import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { before, beforeEach, after, describe, it } from "node:test";
import pg from "pg";
import { getReferralGrowth } from "../../src/app/services/referral-growth-service.js";

const databaseUrl = process.env.REFERRAL_GROWTH_TEST_DB_URL;
const integrationDescribe = databaseUrl ? describe : describe.skip;
const businessId = randomUUID(),
  otherBusiness = randomUUID();
const referrer = randomUUID(),
  customerA = randomUUID(),
  customerB = randomUUID(),
  deleted = randomUUID(),
  otherCustomer = randomUUID();
const now = new Date("2026-11-10T18:00:00.000Z");
let client;

integrationDescribe("referral growth against disposable PostgreSQL", () => {
  before(async () => {
    const url = new URL(databaseUrl);
    assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
    assert.equal(url.pathname, "/referral_growth_test");
    client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    await client.query(
      // Constant fixture path relative to this test module.
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      await readFile(
        new URL("../fixtures/referral-growth.sql", import.meta.url),
        "utf8",
      ),
    );
  });
  after(async () => {
    await client?.end();
  });
  beforeEach(async () => {
    await client.query("TRUNCATE transactions, referrals, customers");
    await client.query(
      "INSERT INTO customers VALUES ($1,$2,'Invita',NULL),($3,$2,'Ana',NULL),($4,$2,'Bea',NULL),($5,$2,'Private deleted name',now()),($6,$7,'Other tenant name',NULL)",
      [
        referrer,
        businessId,
        customerA,
        customerB,
        deleted,
        otherCustomer,
        otherBusiness,
      ],
    );
  });
  function growth(options = {}) {
    return getReferralGrowth(
      {
        businessId,
        days: 30,
        phase: "all",
        limit: 25,
        offset: 0,
        now,
        timezone: "America/Guatemala",
        ...options,
      },
      client.query.bind(client),
    );
  }
  async function referral(values = {}) {
    const r = {
      id: randomUUID(),
      businessId,
      referrer,
      customerId: customerA,
      status: "pending",
      at: "2026-11-01T12:00:00Z",
      pointsA: null,
      pointsB: null,
      rewardedA: null,
      rewardedB: null,
      ...values,
    };
    await client.query(
      "INSERT INTO referrals VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        r.id,
        r.businessId,
        r.referrer,
        r.customerId,
        r.status,
        r.at,
        r.pointsA,
        r.pointsB,
        r.rewardedA,
        r.rewardedB,
      ],
    );
    return r.id;
  }
  async function purchase(values = {}) {
    const t = {
      businessId,
      customerId: customerA,
      amount: 10,
      visits: 0,
      items: 0,
      type: "PURCHASE",
      source: "online",
      status: "POSTED",
      original: null,
      reversed: null,
      at: "2026-11-02T12:00:00Z",
      ...values,
    };
    await client.query(
      "INSERT INTO transactions VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
      [
        randomUUID(),
        t.businessId,
        t.customerId,
        t.amount,
        t.visits,
        t.items,
        t.type,
        t.source,
        t.status,
        t.original,
        t.reversed,
        t.at,
      ],
    );
  }
  it("separates purchases from rewards, including signup rewards without any purchase", async () => {
    await referral({
      status: "rewarded",
      pointsA: 100,
      pointsB: 50,
      rewardedA: now,
      rewardedB: now,
    });
    await referral({
      customerId: customerB,
      status: "rewarded",
      pointsA: 20,
      pointsB: 10,
      rewardedA: now,
      rewardedB: now,
    });
    await referral({ customerId: deleted, status: "completed" });
    await purchase();
    const result = await growth();
    assert.deepEqual(result.summary, {
      registered: 3,
      purchased: 1,
      purchased_and_rewarded: 1,
      awaiting_purchase: 2,
      purchase_rate_pct: 33.33,
      reward_status: { pending: 0, completed: 1, rewarded: 2, other: 0 },
      recorded_reward_points: 180,
    });
    assert.equal(
      result.referrals.find((row) => row.referred_name === "Bea")
        .first_purchase_at,
      null,
    );
    assert.equal(
      result.referrals.find((row) => row.referred_name === "Bea").status,
      "rewarded",
    );
  });
  it("uses genuine post-referral activity and excludes rewards, refunds, empty awards and future purchases", async () => {
    await referral();
    for (const source of [
      "lifecycle",
      "expire",
      "reversal",
      "redeem",
      "correction",
      "unknown",
    ])
      await purchase({ source });
    for (const type of ["REFERRAL_REWARD", "ACHIEVEMENT", "MANUAL_ADJUSTMENT"])
      await purchase({ type });
    for (const status of ["REVERSED", "CANCELLED"]) await purchase({ status });
    await purchase({ original: randomUUID() });
    await purchase({ reversed: randomUUID() });
    await purchase({ amount: 0 });
    await purchase({ at: "2026-11-01T11:59:59Z" });
    await purchase({ at: now });
    assert.equal((await growth()).summary.purchased, 0);
    for (const source of ["online", "offline", "external", "order"]) {
      await client.query("DELETE FROM transactions");
      await purchase({
        source,
        status: "PENDING",
        type: null,
        amount: 0,
        visits: 1,
      });
      const result = await growth();
      assert.equal(result.summary.purchased, 1, source);
      assert.equal(
        result.referrals[0].first_purchase_at,
        "2026-11-02T12:00:00+00:00",
      );
    }
  });
  it("counts a customer once and shows the earliest qualifying purchase after referral", async () => {
    await referral();
    await purchase({ at: "2026-11-03T12:00:00Z" });
    await purchase({ at: "2026-11-01T12:00:00Z", amount: 0, items: 1 });
    const result = await growth();
    assert.equal(result.summary.purchased, 1);
    assert.equal(
      Date.parse(result.referrals[0].first_purchase_at),
      Date.parse("2026-11-01T12:00:00Z"),
    );
  });
  it("enforces tenant scope across referrals, both customers and transactions", async () => {
    await referral();
    await referral({
      businessId: otherBusiness,
      customerId: otherCustomer,
      referrer: otherCustomer,
    });
    await referral({ customerId: otherCustomer });
    await referral({ customerId: customerB, referrer: otherCustomer });
    await purchase({ businessId: otherBusiness });
    const result = await growth();
    assert.equal(result.summary.registered, 1);
    assert.equal(result.summary.purchased, 0);
    assert.equal(result.referrals.length, 1);
    assert.ok(!JSON.stringify(result).includes("Other tenant name"));
  });
  it("retains aggregate history but redacts deleted customer names on either side", async () => {
    await referral({ referrer: deleted });
    await referral({ customerId: deleted });
    await purchase({ customerId: deleted });
    const result = await growth();
    assert.equal(result.summary.registered, 2);
    assert.equal(result.summary.purchased, 1);
    assert.ok(!JSON.stringify(result).includes("Private deleted name"));
    assert.ok(result.referrals.some((row) => row.referrer_name === null));
    assert.ok(result.referrals.some((row) => row.referred_name === null));
  });
  it("selects local registration cohort boundaries and never infers conversion for absent records", async () => {
    await referral({ at: "2026-10-12T06:00:00Z" });
    await referral({ customerId: customerB, at: "2026-10-12T05:59:59Z" });
    await referral({ customerId: deleted, at: now });
    const result = await growth();
    assert.equal(result.summary.registered, 1);
    assert.deepEqual(result.period, {
      days: 30,
      start: "2026-10-12T06:00:00.000Z",
      end: now.toISOString(),
    });
    assert.equal(result.summary.purchase_rate_pct, 0);
    assert.equal((await growth({ days: 90 })).summary.registered, 2);
    await client.query("DELETE FROM referrals");
    const empty = await growth();
    assert.equal(empty.summary.purchase_rate_pct, null);
    assert.deepEqual(empty.referrals, []);
    assert.equal(empty.pagination.total, 0);
  });
  it("filters and paginates rows without changing cohort totals", async () => {
    await referral({ at: "2026-11-01T12:00:00Z" });
    await referral({ customerId: customerB, at: "2026-11-02T12:00:00Z" });
    await referral({ customerId: deleted, at: "2026-11-03T12:00:00Z" });
    await purchase();
    const first = await growth({ phase: "awaiting_purchase", limit: 1 });
    assert.equal(first.summary.registered, 3);
    assert.deepEqual(first.pagination, {
      total: 2,
      limit: 1,
      offset: 0,
      has_more: true,
    });
    assert.equal(first.referrals[0].referred_name, null);
    const second = await growth({
      phase: "awaiting_purchase",
      limit: 1,
      offset: 1,
    });
    assert.equal(second.referrals[0].referred_name, "Bea");
    assert.equal(second.pagination.has_more, false);
    const bought = await growth({ phase: "purchased" });
    assert.equal(bought.referrals[0].referred_name, "Ana");
    assert.equal(bought.pagination.total, 1);
  });
});
