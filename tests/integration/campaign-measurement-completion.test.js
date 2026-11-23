import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, beforeEach, describe, it } from "node:test";
import pg from "pg";
import { buildGrantPlan } from "../../src/scripts/create-app-role.mjs";
import {
  readCampaignReport,
  saveMeasurementCosts,
  saveMeasurementReport,
  listMeasurementReports,
} from "../../src/app/services/campaign-report-service.js";
import {
  createGrowthCampaign,
  activateGrowthCampaign,
} from "../../src/app/services/growth-campaign-service.js";
import { createCampaignPreflight } from "../../src/app/services/campaign-preflight-service.js";
const url = process.env.MEASUREMENT_TEST_DB_URL,
  suite = url ? describe : describe.skip;
let db, deps, b, other, owner, campaign, people;
const day = 86400000,
  now = Date.now(),
  start = new Date(now - 60 * day),
  expiry = new Date(now - 46 * day),
  end = new Date(now - 30 * day);
const plan = {
  version: 1,
  baseline_return_rate_pct: 30,
  minimum_detectable_lift_pp: 10,
  observation_days: 30,
  reconciliation_days: 7,
};
suite("measurement completion on full migrated disposable PostgreSQL", () => {
  before(async () => {
    const parsed = new URL(url);
    assert.ok(["localhost", "127.0.0.1"].includes(parsed.hostname));
    assert.equal(parsed.pathname, "/measurement_completion_test");
    assert.notEqual(parsed.port, "5432");
    db = new pg.Pool({ connectionString: url, max: 8 });
    assert.ok(
      (await db.query("SELECT to_regclass('growth_measurement_reports') AS t")).rows[0].t,
      "Apply the full managed schema before this test",
    );
    deps = {
      query: db.query.bind(db),
      audit: async () => {},
      getPlanFeatureOverrides: async () => ({}),
      transaction: async (fn) => {
        const c = await db.connect();
        try {
          await c.query("BEGIN");
          const r = await fn(c);
          await c.query("COMMIT");
          return r;
        } catch (e) {
          await c.query("ROLLBACK");
          throw e;
        } finally {
          c.release();
        }
      },
    };
  });
  after(async () => db?.end());
  beforeEach(async () => {
    b = randomUUID();
    other = randomUUID();
    owner = randomUUID();
    campaign = randomUUID();
    people = Array.from({ length: 20 }, () => randomUUID());
    await db.query(
      "INSERT INTO businesses(id,name,slug,email,password_hash,plan,program_json) VALUES($1,'Fixture',$3,$4,'unused','NEGOCIO','{\"points_per_q\":1}'),($2,'Other',$5,$6,'unused','NEGOCIO','{}')",
      [b, other, `m-${b}`, `${b}@example.invalid`, `m-${other}`, `${other}@example.invalid`],
    );
    await db.query(
      "INSERT INTO staff_users(id,business_id,name,email,password_hash,role) VALUES($1,$2,'Owner',$3,'unused','OWNER')",
      [owner, b, `${owner}@example.invalid`],
    );
    for (let i = 0; i < people.length; i++)
      await db.query(
        "INSERT INTO customers(id,business_id,name,phone) VALUES($1,$2,'Fixture',$3)",
        [people[i], b, `5025555${String(i).padStart(4, "0")}`],
      );
    await db.query(
      `INSERT INTO growth_campaigns(id,business_id,request_id,name,status,bonus_points,minimum_purchase_q,duration_days,holdout_percent,member_count,treatment_count,control_count,starts_at,expires_at,measurement_plan,observation_ends_at,reconciliation_ends_at,created_by_staff_id)
    VALUES($1,$2,$3,'Measurement','active',50,0,14,50,20,10,10,$4,$5,$6,$7,$8,$9)`,
      [campaign, b, randomUUID(), start, expiry, plan, end, new Date(+end + 7 * day), owner],
    );
    for (let i = 0; i < people.length; i++)
      await db.query(
        "INSERT INTO growth_campaign_members(id,business_id,campaign_id,customer_id,allocation,measurement_baseline) VALUES($1,$2,$3,$4,$5,$6)",
        [
          randomUUID(),
          b,
          campaign,
          people[i],
          i < 10 ? "treatment" : "control",
          { as_of: start.toISOString(), window_days: 30, purchases: 1, sales_q: 20 },
        ],
      );
  });
  const read = () => readCampaignReport({ businessId: b, campaignId: campaign }, deps);
  const options = () => ({
    businessId: b,
    campaignId: campaign,
    staffId: owner,
    requestId: randomUUID(),
  });
  async function purchase(customer = people[0], overrides = {}) {
    const id = randomUUID(),
      event = overrides.event ?? new Date(+start + day),
      created = overrides.created ?? new Date();
    await db.query(
      "INSERT INTO transactions(id,business_id,customer_id,type,source,status,amount_q,points,created_at,purchase_occurred_at,purchase_time_source) VALUES($1,$2,$3,'PURCHASE','external',$4,$5,0,$6,$7,$8)",
      [
        id,
        b,
        customer,
        overrides.status ?? "POSTED",
        overrides.amount ?? 100,
        created,
        event,
        overrides.timeSource ?? "pos_receipt",
      ],
    );
    return id;
  }
  it("uses trusted occurrence time, nets matched partial refunds, retains original denominator and identifies late loads", async () => {
    const id = await purchase();
    await purchase(people[1], { event: new Date(+expiry + day), amount: 80 });
    await purchase(people[2], { event: end, amount: 999 });
    await db.query(
      "INSERT INTO pos_refund_receipts(id,business_id,source,refund_id,original_sale_id,amount_q,currency,origin,scope,fingerprint,reason,original_transaction_id) VALUES($1,$2,'api','r1','s1',30,'GTQ','api','partial',$3,'partial_refund',$4)",
      [randomUUID(), b, "a".repeat(64), id],
    );
    const { results: r } = await read();
    assert.equal(r.treatment.members, 10);
    assert.equal(r.treatment.returned_customers, 2);
    assert.equal(r.treatment.recorded_sales_q, 150);
    assert.equal(r.treatment.refunds_q, 30);
    assert.equal(r.followup.treatment.recorded_sales_q, 80);
    assert.equal(r.offer_period.treatment.recorded_sales_q, 70);
    assert.equal(r.diagnostics.late_purchases, 2);
    assert.equal(r.diagnostics.pending_refunds, 1);
    assert.equal(r.measurement.state, "incomplete_data");
  });
  it("full reversal is not subtracted twice and unresolved refunds are disclosed without assigning them", async () => {
    const id = await purchase(people[0], { status: "REVERSED" });
    await db.query(
      "INSERT INTO pos_refund_receipts(id,business_id,source,refund_id,original_sale_id,amount_q,currency,origin,scope,fingerprint,reason,original_transaction_id) VALUES($1,$2,'api','r2','s2',100,'GTQ','api','full',$3,'original_unavailable',$4),($5,$2,'api','r3','missing',10,'GTQ','api','unknown',$3,'original_not_found',NULL)",
      [randomUUID(), b, "b".repeat(64), id, randomUUID()],
    );
    const r = (await read()).results;
    assert.equal(r.treatment.recorded_sales_q, 0);
    assert.equal(r.treatment.refunds_q, 100);
    assert.equal(r.treatment.returned_customers, 0);
    assert.equal(r.diagnostics.pending_refunds, 2);
    assert.equal(r.diagnostics.unallocated_refunds, 1);
  });
  it("stores idempotent cost/report revisions, detects late changes and keeps older evidence inspectable", async () => {
    await purchase();
    const op = options(),
      costs = {
        gross_margin_pct: 50,
        fulfillment_cost_q: 5,
        messaging_cost_q: 0,
        other_cost_q: 0,
        outstanding_reward_cost_q: 20,
        notes: "Costos directos confirmados",
      };
    const a = await saveMeasurementCosts({ ...op, costs }, deps);
    assert.equal(a.revision, 1);
    assert.equal((await saveMeasurementCosts({ ...op, costs }, deps)).revision, 1);
    await assert.rejects(
      saveMeasurementCosts({ ...op, costs: { ...costs, other_cost_q: 1 } }, deps),
      { statusCode: 409 },
    );
    const cut = options(),
      first = await saveMeasurementReport(cut, deps);
    assert.equal(first.revision, 1);
    assert.equal((await saveMeasurementReport(cut, deps)).id, first.id);
    assert.equal((await read()).results.report_revision.changed, false);
    await purchase(people[1], { amount: 40 });
    assert.equal((await read()).results.report_revision.changed, true);
    const second = await saveMeasurementReport(options(), deps);
    assert.equal(second.revision, 2);
    const history = await listMeasurementReports({ businessId: b, campaignId: campaign }, deps);
    assert.equal(history.reports.length, 2);
    assert.equal(history.reports[1].treatment.recorded_sales_q, 100);
    assert.equal(history.reports[0].treatment.recorded_sales_q, 140);
    assert.equal((await read()).results.contribution.estimated_incremental_contribution_q, 65);
    await assert.rejects(
      db.query("UPDATE growth_measurement_reports SET payload='{}' WHERE id=$1", [first.id]),
      /append only/,
    );
  });
  it("counts known unlinked receipts, overlapping offers and unavailable assigned customers without dropping them", async () => {
    await purchase();
    await db.query(
      "INSERT INTO pos_measurement_receipts(business_id,source,sale_id,occurred_at,status) VALUES($1,'api','unmatched',$2,'unmatched')",
      [b, new Date(+start + day)],
    );
    const otherCampaign = randomUUID();
    await db.query(
      "INSERT INTO growth_campaigns(id,business_id,request_id,name,status,bonus_points,minimum_purchase_q,duration_days,holdout_percent,member_count,treatment_count,control_count,starts_at,expires_at) VALUES($1,$2,$3,'Other','active',1,0,14,50,10,5,5,$4,$5)",
      [otherCampaign, b, randomUUID(), start, expiry],
    );
    await db.query(
      "INSERT INTO growth_campaign_members(id,business_id,campaign_id,customer_id,allocation) VALUES($1,$2,$3,$4,'treatment')",
      [randomUUID(), b, otherCampaign, people[0]],
    );
    await db.query("UPDATE customers SET deleted_at=now() WHERE id=$1", [people[1]]);
    const r = (await read()).results;
    assert.equal(r.treatment.members, 10);
    assert.equal(r.treatment.unavailable_members, 1);
    assert.equal(r.diagnostics.receipt_coverage.unmatched, 1);
    assert.equal(r.diagnostics.overlap_members, 1);
    assert.equal(r.diagnostics.capture_state, "incomplete");
    assert.equal(r.measurement.state, "incomplete_data");
  });
  it("legacy fallback remains explicit, untrusted client clocks block interpretation and absent followup has no interval", async () => {
    await db.query(
      "INSERT INTO transactions(id,business_id,customer_id,type,source,status,amount_q,points,created_at) VALUES($1,$2,$3,'PURCHASE','online','POSTED',45,0,$4)",
      [randomUUID(), b, people[0], new Date(+start + day)],
    );
    await purchase(people[2], { timeSource: "client_reported" });
    const r = (await read()).results;
    assert.equal(r.diagnostics.legacy_time_purchases, 1);
    assert.equal(r.diagnostics.untrusted_time_purchases, 1);
    assert.equal(r.measurement.state, "incomplete_data");
  });
  it("tenant predicates hide foreign campaigns and immutable designs cannot be rewritten", async () => {
    await assert.rejects(readCampaignReport({ businessId: other, campaignId: campaign }, deps), {
      statusCode: 404,
    });
    await assert.rejects(
      saveMeasurementCosts({ ...options(), businessId: other, costs: {} }, deps),
      { statusCode: 404 },
    );
    await assert.rejects(
      db.query(
        "UPDATE growth_campaigns SET observation_ends_at=observation_ends_at+interval '1 day' WHERE id=$1",
        [campaign],
      ),
      /immutable/,
    );
    await assert.rejects(
      db.query(
        "UPDATE growth_campaign_members SET measurement_baseline='{}' WHERE campaign_id=$1",
        [campaign],
      ),
      /immutable/,
    );
  });
  it("captures baseline at activation, supports 50/50, and preserves plan idempotency with jsonb key ordering", async () => {
    const run = randomUUID();
    await db.query(
      "INSERT INTO recovery_runs(id,business_id,request_id,name,inactive_days,requested_limit,member_count,created_by_staff_id) VALUES($1,$2,$1,'List',30,20,20,$3)",
      [run, b, owner],
    );
    for (const id of people)
      await db.query(
        "INSERT INTO recovery_members(business_id,run_id,customer_id,last_purchase_at,recorded_sales_q,purchases) VALUES($1,$2,$3,now(),0,1)",
        [b, run, id],
      );
    const input = {
      businessId: b,
      staffId: owner,
      requestId: randomUUID(),
      recoveryRunId: run,
      name: "Planned",
      bonusPoints: 5,
      minimumPurchaseQ: 0,
      durationDays: 14,
      holdoutPercent: 50,
      measurementPlan: plan,
    };
    const draft = await createGrowthCampaign(input, deps);
    assert.equal((await createGrowthCampaign(input, deps)).campaign.id, draft.campaign.id);
    await assert.rejects(
      createGrowthCampaign({ ...input, measurementPlan: { ...plan, observation_days: 60 } }, deps),
      { statusCode: 409 },
    );
    const preflight = await createCampaignPreflight(
      { businessId: b, campaignId: draft.campaign.id },
      deps,
    );
    const active = await activateGrowthCampaign(
      {
        businessId: b,
        staffId: owner,
        campaignId: draft.campaign.id,
        preflightId: preflight.preflight.id,
      },
      deps,
    );
    assert.equal(active.campaign.control_count, 10);
    assert.equal(active.campaign.treatment_count, 10);
    assert.equal(
      Date.parse(active.campaign.observation_ends_at) - Date.parse(active.campaign.starts_at),
      30 * day,
    );
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int AS n FROM growth_campaign_members WHERE campaign_id=$1 AND measurement_baseline IS NOT NULL",
          [draft.campaign.id],
        )
      ).rows[0].n,
      20,
    );
  });

  it("does not count previously paused offers as simultaneous and has no artificial zero-length followup", async () => {
    const old = randomUUID(),
      legacy = randomUUID();
    await db.query(
      "INSERT INTO growth_campaigns(id,business_id,request_id,name,status,bonus_points,minimum_purchase_q,duration_days,holdout_percent,member_count,treatment_count,control_count,starts_at,expires_at,paused_at) VALUES($1,$2,$3,'Paused','paused',1,0,14,50,10,5,5,$4,$5,$6)",
      [old, b, randomUUID(), new Date(+start - day), expiry, new Date(+start - 1000)],
    );
    await db.query(
      "INSERT INTO growth_campaign_members(id,business_id,campaign_id,customer_id,allocation) VALUES($1,$2,$3,$4,'treatment')",
      [randomUUID(), b, old, people[0]],
    );
    assert.equal((await read()).results.diagnostics.overlap_members, 0);
    await db.query(
      "INSERT INTO growth_campaigns(id,business_id,request_id,name,status,bonus_points,minimum_purchase_q,duration_days,holdout_percent,member_count,treatment_count,control_count,starts_at,expires_at) VALUES($1,$2,$3,'Legacy','active',1,0,14,50,10,5,5,$4,$5)",
      [legacy, b, randomUUID(), start, expiry],
    );
    const r = (await readCampaignReport({ businessId: b, campaignId: legacy }, deps)).results;
    assert.equal(r.followup.available, false);
    assert.equal(r.followup.return_difference, null);
    assert.equal(r.treatment.baseline_purchase_rate_pct, null);
    assert.equal(r.diagnostics.baseline_difference, null);
  });
  it("enforces forced tenant RLS under a non-owner database role and serializes concurrent cuts", async () => {
    await purchase();
    await saveMeasurementCosts({ ...options(), costs: { gross_margin_pct: 30 } }, deps);
    const op = options(),
      cuts = await Promise.all(Array.from({ length: 4 }, () => saveMeasurementReport(op, deps)));
    assert.equal(new Set(cuts.map((x) => x.id)).size, 1);
    await db.query(
      "DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='measurement_runtime_fixture') THEN CREATE ROLE measurement_runtime_fixture NOLOGIN;END IF;END $$; ",
    );
    const grantPlan = buildGrantPlan({
      appDbUser: "measurement_runtime_fixture",
      dbName: "measurement_completion_test",
    });
    for (const statement of grantPlan.statements) await db.query(statement);
    await db.query(grantPlan.grantFunctionsSql);
    await deps.transaction(async (c) => {
      await c.query("SET LOCAL ROLE measurement_runtime_fixture");
      await c.query("SELECT set_config('app.current_tenant',$1,true)", [other]);
      assert.equal(
        (await c.query("SELECT * FROM growth_measurement_costs WHERE business_id=$1", [b]))
          .rowCount,
        0,
      );
      assert.equal(
        (await c.query("SELECT * FROM growth_measurement_reports WHERE business_id=$1", [b]))
          .rowCount,
        0,
      );
      await assert.rejects(
        readCampaignReport({ businessId: b, campaignId: campaign }, { query: c.query.bind(c) }),
        { statusCode: 404 },
      );
      await c.query("SELECT set_config('app.current_tenant',$1,true)", [b]);
      assert.equal(
        (
          await readCampaignReport(
            { businessId: b, campaignId: campaign },
            { query: c.query.bind(c) },
          )
        ).results.treatment.recorded_sales_q,
        100,
      );
      const runtime = { transaction: async (fn) => fn(c), audit: async () => {} };
      assert.equal(
        (await saveMeasurementCosts({ ...options(), costs: { gross_margin_pct: 45 } }, runtime))
          .revision,
        2,
      );
      assert.equal((await saveMeasurementReport(options(), runtime)).revision, 2);
      const permissions = (
        await c.query(
          "SELECT has_table_privilege(current_user,'growth_measurement_reports','UPDATE') AS can_update,has_table_privilege(current_user,'pos_measurement_receipts','DELETE') AS can_delete",
        )
      ).rows[0];
      assert.equal(permissions.can_update, false);
      assert.equal(permissions.can_delete, false);
    });
  });

  it("discloses imported receipts without original date instead of silently treating ingestion as purchase time", async () => {
    await db.query(
      "INSERT INTO transactions(id,business_id,customer_id,type,source,status,amount_q,points,created_at,purchase_time_source) VALUES($1,$2,$3,'PURCHASE','external','POSTED',45,0,$4,'server_recorded')",
      [randomUUID(), b, people[0], new Date(+start + day)],
    );
    const r = (await read()).results;
    assert.equal(r.diagnostics.missing_purchase_dates, 1);
    assert.equal(r.measurement.state, "incomplete_data");
    assert.equal(r.decision.code, "untrusted_time");
  });
});
