import { applyCampaignExpansionFixture } from "../helpers/campaign-expansion-schema.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { before, beforeEach, after, describe, it } from "node:test";
import pg from "pg";

const databaseUrl = process.env.GROWTH_CAMPAIGNS_TEST_DB_URL;
const integrationDescribe = databaseUrl ? describe : describe.skip;
const businessId = randomUUID(),
  otherBusiness = randomUUID(),
  staffId = randomUUID();
let db, service, offer, deps, recoveryRunId, customers, audits;
integrationDescribe(
  "targeted offers and randomized measurement against disposable PostgreSQL",
  () => {
    before(async () => {
      const url = new URL(databaseUrl);
      assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
      assert.equal(url.pathname, "/growth_campaigns_test");
      db = new pg.Pool({ connectionString: databaseUrl });
      await db.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
      await db.query(
        // Fixed repository paths, never user-controlled.
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        await readFile(
          new URL("../fixtures/customer-recovery.sql", import.meta.url),
          "utf8",
        ),
      );
      await db.query(
        "ALTER TABLE businesses ADD COLUMN plan text DEFAULT 'NEGOCIO', ADD COLUMN program_json jsonb DEFAULT '{}'; ALTER TABLE transactions ADD COLUMN meta jsonb DEFAULT '{}', ADD COLUMN available_at timestamptz, ADD COLUMN staff_user_id uuid, ADD COLUMN branch_id uuid; ALTER TABLE transactions ALTER COLUMN created_at SET DEFAULT now(); ALTER TABLE customers ADD COLUMN last_visit_at timestamptz; CREATE TABLE customer_balances(customer_id uuid PRIMARY KEY,points int DEFAULT 0,pending_points int DEFAULT 0,lifetime_points int DEFAULT 0,updated_at timestamptz); CREATE TABLE qr_tokens(jti text PRIMARY KEY,business_id uuid,customer_id uuid,expires_at timestamptz)",
      );
      await db.query(
        "CREATE TABLE customer_ltv(customer_id uuid PRIMARY KEY,total_spend numeric,total_visits int,total_transactions int,avg_transaction_value numeric,first_purchase_at timestamptz,last_purchase_at timestamptz,days_since_last_purchase int,purchase_frequency numeric,predicted_ltv numeric,churn_risk_score numeric,updated_at timestamptz); CREATE TABLE visit_streaks(customer_id uuid PRIMARY KEY,current_streak int,longest_streak int,last_visit_date date,streak_started_at date,updated_at timestamptz)",
      );
      await db.query(
        // Fixed repository paths, never user-controlled.
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        await readFile(
          new URL(
            "../../src/app/migrations/2026-11-10-customer-recovery.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      );
      // Missing migration is an explicit failed feature assertion on the initial red run.
      let migration = "";
      try {
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        migration = await readFile(
          new URL(
            "../../src/app/migrations/2026-11-10-growth-campaigns.sql",
            import.meta.url,
          ),
          "utf8",
        );
      } catch {
        /* asserted below */
      }
      assert.ok(migration, "Growth campaign schema must exist");
      await db.query(migration);
      await db.query(
        // Fixed additive migration path.
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        await readFile(new URL("../../src/app/migrations/2026-11-10-growth-limits.sql", import.meta.url), "utf8"),
      );
      // Fixed additive migration path.
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      await db.query(await readFile(new URL("../../src/app/migrations/2026-11-10-reusable-audiences.sql", import.meta.url), "utf8"));
      await applyCampaignExpansionFixture(db, { allowClockFixture: true });
      service = await import(
        "../../src/app/services/growth-campaign-service.js"
      );
      offer = await import("../../src/app/services/targeted-offer-service.js");
      deps = {
        query: db.query.bind(db),
        getPlanFeatureOverrides: async () => ({}),
        audit: async (event) => audits.push(event),
        transaction: async (fn) => {
          const client = await db.connect();
          try {
            await client.query("BEGIN");
            const result = await fn(client);
            await client.query("COMMIT");
            return result;
          } catch (error) {
            await client.query("ROLLBACK");
            throw error;
          } finally {
            client.release();
          }
        },
      };
    });
    after(async () => {
      await db?.end();
    });
    beforeEach(async () => {
      audits = [];
      recoveryRunId = randomUUID();
      customers = Array.from({ length: 20 }, () => randomUUID());
      await db.query(
        "TRUNCATE businesses,staff_users,customers,transactions,customer_balances,qr_tokens CASCADE",
      );
      await db.query(
        "INSERT INTO businesses(id,program_json) VALUES($1,'{\"existing\":true}'),($2,'{}')",
        [businessId, otherBusiness],
      );
      await db.query("INSERT INTO staff_users VALUES($1,$2)", [
        staffId,
        businessId,
      ]);
      await db.query(
        "INSERT INTO recovery_runs(id,business_id,request_id,name,inactive_days,requested_limit,member_count) VALUES($1,$2,$3,'Recovery',30,20,20)",
        [recoveryRunId, businessId, randomUUID()],
      );
      for (const customerId of customers) {
        await db.query(
          "INSERT INTO customers(id,business_id,name,phone) VALUES($1,$2,'Member','50255550000');",
          [customerId, businessId],
        );
        await db.query(
          "INSERT INTO customer_balances(customer_id) VALUES($1)",
          [customerId],
        );
        await db.query(
          "INSERT INTO recovery_members(business_id,run_id,customer_id,last_purchase_at,recorded_sales_q,purchases) VALUES($1,$2,$3,now()-interval '40 days',100,1)",
          [businessId, recoveryRunId, customerId],
        );
      }
    });
    function create(options = {}) {
      return service.createGrowthCampaign(
        {
          businessId,
          staffId,
          requestId: randomUUID(),
          recoveryRunId,
          name: "Volver",
          bonusPoints: 50,
          minimumPurchaseQ: 10,
          durationDays: 14,
          holdoutPercent: 20,
          estimatedCostPerPointQ: 0.1,
          ...options,
        },
        deps,
      );
    }
    function activate(campaignId, options = {}) {
      return service.activateGrowthCampaign(
        { businessId, staffId, campaignId, ...options },
        deps,
      );
    }
    function details(campaignId, options = {}) {
      return service.getGrowthCampaign(
        { businessId, campaignId, ...options },
        deps,
      );
    }
    async function active(options = {}) {
      const { campaign } = await create(options);
      return (await activate(campaign.id)).campaign;
    }
    async function members(campaignId, allocation = "treatment") {
      return (
        await db.query(
          "SELECT * FROM growth_campaign_members WHERE campaign_id=$1 AND allocation=$2 ORDER BY customer_id",
          [campaignId, allocation],
        )
      ).rows;
    }
    async function award(customerId, options = {}) {
      return deps.transaction(async (client) => {
        const transactionId = options.transactionId ?? randomUUID();
        const business = (
          await client.query("SELECT * FROM businesses WHERE id=$1", [
            businessId,
          ])
        ).rows[0];
        const input = {
          client,
          business,
          customerId,
          transactionId,
          source: "online",
          amountQ: 10,
          visits: 0,
          items: 0,
          basePoints: 10,
          ...options,
        };
        const bonus = await offer.claimTargetedOffer(input, {
          getPlanFeatureOverrides: deps.getPlanFeatureOverrides,
        });
        const status = options.status ?? "POSTED";
        await client.query(
          "INSERT INTO transactions(id,business_id,customer_id,amount_q,points,status,source) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            transactionId,
            businessId,
            customerId,
            input.amountQ,
            input.basePoints + bonus.bonusPoints,
            status,
            input.source,
          ],
        );
        await client.query(
          "UPDATE customer_balances SET points=points+CASE WHEN $3='POSTED' THEN $2 ELSE 0 END,pending_points=pending_points+CASE WHEN $3='PENDING' THEN $2 ELSE 0 END WHERE customer_id=$1",
          [customerId, input.basePoints + bonus.bonusPoints, status],
        );
        return { ...bonus, transactionId };
      });
    }
    it("paginates older active campaigns with tenant-scoped totals even beyond the last page", async () => {
      const oldest = await active();
      for (let index = 0; index < 21; index += 1) await create({ name: `Later ${index}` });
      await db.query(`INSERT INTO growth_campaigns(id,business_id,request_id,name,bonus_points,minimum_purchase_q,duration_days,holdout_percent)
        VALUES($1,$2,$3,'Other tenant',50,10,14,20)`, [randomUUID(),otherBusiness,randomUUID()]);
      const first = await service.listGrowthCampaigns({ businessId }, deps);
      assert.equal(first.total, 22);
      assert.equal(first.limit, 20);
      assert.equal(first.offset, 0);
      assert.equal(first.campaigns.length, 20);
      assert.ok(first.campaigns.every(campaign => campaign.id !== oldest.id));
      const second = await service.listGrowthCampaigns({ businessId, offset: 20 }, deps);
      assert.equal(second.total, 22);
      assert.equal(second.limit, 20);
      assert.equal(second.offset, 20);
      assert.equal(second.campaigns.length, 2);
      assert.equal(second.campaigns[1].id, oldest.id);
      assert.equal(second.campaigns[1].status, "active");
      assert.equal(new Set([...first.campaigns,...second.campaigns].map(campaign => campaign.id)).size, 22);
      assert.deepEqual(await service.listGrowthCampaigns({ businessId, limit: 50, offset: 100000 }, deps), { campaigns: [], total: 22, limit: 50, offset: 100000 });
      const other = await service.listGrowthCampaigns({ businessId: otherBusiness, limit: 1, offset: 0 }, deps);
      assert.equal(other.total, 1);
      assert.equal(other.campaigns[0].name, "Other tenant");
      for (const invalid of [{ limit: 0 }, { limit: 51 }, { limit: 1.5 }, { offset: -1 }, { offset: 100001 }, { offset: 0.5 }]) {
        await assert.rejects(service.listGrowthCampaigns({ businessId, ...invalid }, deps), { statusCode: 400 });
      }
    });
    it("creates a draft without grants, assigns a fixed randomized holdout once, and preserves program settings", async () => {
      const requestId = randomUUID();
      const first = await create({ requestId });
      assert.equal(first.campaign.status, "draft");
      assert.equal(first.campaign.member_count, 20);
      assert.equal(
        (await db.query("SELECT COUNT(*) FROM transactions")).rows[0].count,
        "0",
      );
      assert.deepEqual(await create({ requestId }), first);
      await assert.rejects(create({ requestId, bonusPoints: 51 }), {
        statusCode: 409,
      });
      const activated = await Promise.all(
        Array.from({ length: 5 }, () => activate(first.campaign.id)),
      );
      assert.ok(
        activated.every(
          (value) => JSON.stringify(value) === JSON.stringify(activated[0]),
        ),
      );
      assert.equal(activated[0].campaign.treatment_count, 16);
      assert.equal(activated[0].campaign.control_count, 4);
      assert.ok(Date.parse(activated[0].campaign.starts_at) <= Date.now());
      assert.equal(
        Date.parse(activated[0].campaign.expires_at) -
          Date.parse(activated[0].campaign.starts_at),
        14 * 86400000,
      );
      assert.deepEqual(
        (
          await db.query("SELECT program_json FROM businesses WHERE id=$1", [
            businessId,
          ])
        ).rows[0].program_json,
        { existing: true, targeted_offers_enabled: true },
      );
      const assignments = await members(first.campaign.id);
      await activate(first.campaign.id);
      assert.deepEqual(await members(first.campaign.id), assignments);
      assert.equal(audits.length, 2);
    });
    it("rolls back empty drafts and refuses fewer than ten currently active members at activation", async () => {
      await db.query("UPDATE customers SET deleted_at=now()");
      await assert.rejects(create(), { statusCode: 400 });
      assert.equal(
        (await db.query("SELECT COUNT(*) FROM growth_campaigns")).rows[0].count,
        "0",
      );
      await db.query("UPDATE customers SET deleted_at=NULL");
      const { campaign } = await create();
      await db.query(
        "UPDATE customers SET deleted_at=now() WHERE id=ANY($1::uuid[])",
        [customers.slice(9)],
      );
      await assert.rejects(activate(campaign.id), { statusCode: 400 });
      assert.equal((await details(campaign.id)).campaign.status, "draft");
    });
    it("serializes concurrent purchases so only one consumes a bonus and cannot stack campaigns", async () => {
      const first = await active();
      const treatment = (await members(first.id))[0].customer_id;
      const awarded = await Promise.all(
        Array.from({ length: 6 }, () => award(treatment)),
      );
      assert.deepEqual(
        awarded.map((r) => r.bonusPoints).sort((a, b) => a - b),
        [0, 0, 0, 0, 0, 50],
      );
      assert.equal(
        Number(
          (await db.query("SELECT SUM(points) AS points FROM transactions"))
            .rows[0].points,
        ),
        110,
      );
      const second = await active({ durationDays: 7 });
      const candidate = (await members(first.id)).find(
        (m) => m.customer_id !== treatment && customers.includes(m.customer_id),
      );
      await db.query(
        "UPDATE growth_campaign_members SET allocation='treatment' WHERE campaign_id=$1 AND customer_id=$2",
        [second.id, candidate.customer_id],
      );
      const result = await award(candidate.customer_id);
      assert.equal(result.campaignId, second.id);
      assert.equal(result.bonusPoints, 50);
      assert.equal(
        (
          await db.query(
            "SELECT COUNT(*) FROM growth_campaign_members WHERE customer_id=$1 AND claimed_at IS NOT NULL",
            [candidate.customer_id],
          )
        ).rows[0].count,
        "1",
      );
    });
    it("uses server dates, minimum purchase, genuine sources, entitlement, control and pause gates", async () => {
      const campaign = await active();
      const treatment = (await members(campaign.id))[0].customer_id;
      const control = (await members(campaign.id, "control"))[0].customer_id;
      assert.equal((await award(control)).bonusPoints, 0);
      assert.equal((await award(treatment, { amountQ: 9.99 })).bonusPoints, 0);
      assert.equal(
        (await award(treatment, { source: "lifecycle" })).bonusPoints,
        0,
      );
      await db.query("UPDATE businesses SET plan='EMPRENDEDOR' WHERE id=$1", [
        businessId,
      ]);
      assert.equal((await award(treatment)).bonusPoints, 0);
      await db.query("UPDATE businesses SET plan='NEGOCIO' WHERE id=$1", [
        businessId,
      ]);
      await db.query(
        "UPDATE growth_campaigns SET starts_at=now()-interval '15 days',expires_at=now()-interval '1 day' WHERE id=$1",
        [campaign.id],
      );
      assert.equal(
        (
          await award(treatment, {
            source: "offline",
            clientTimestamp: campaign.starts_at,
          })
        ).bonusPoints,
        0,
      );
      await db.query(
        "UPDATE growth_campaigns SET starts_at=now()-interval '1 day',expires_at=now()+interval '1 day' WHERE id=$1",
        [campaign.id],
      );
      await service.pauseGrowthCampaign(
        { businessId, staffId, campaignId: campaign.id },
        deps,
      );
      assert.equal((await award(treatment)).bonusPoints, 0);
      await assert.rejects(activate(campaign.id), { statusCode: 409 });
    });
    it("keeps zero outcomes in denominators, includes pending sales, excludes refunds and retains assignment after deletion", async () => {
      const campaign = await active();
      const treatment = (await members(campaign.id))[0].customer_id;
      const control = (await members(campaign.id, "control"))[0].customer_id;
      const pending = await award(treatment, {
        amountQ: 100,
        status: "PENDING",
      });
      await award(control, { amountQ: 40 });
      let result = (await details(campaign.id)).results;
      assert.equal(result.treatment.members, 16);
      assert.equal(result.control.members, 4);
      assert.equal(result.treatment.returned_customers, 1);
      assert.equal(result.treatment.recorded_sales_q, 100);
      assert.equal(result.treatment.average_sales_per_member_q, 6.25);
      assert.equal(result.estimated_incremental_sales_q, -60);
      assert.equal(result.bonus_points_issued, 50);
      assert.equal(result.estimated_incentive_cost_q, 5);
      assert.equal(result.small_sample, true);
      await db.query("UPDATE transactions SET status='REVERSED' WHERE id=$1", [
        pending.transactionId,
      ]);
      result = (await details(campaign.id)).results;
      assert.equal(result.treatment.recorded_sales_q, 0);
      assert.equal(result.bonus_points_issued, 0);
      assert.equal((await award(treatment)).bonusPoints, 0);
      await db.query("UPDATE customers SET deleted_at=now() WHERE id=$1", [
        control,
      ]);
      const detail = await details(campaign.id);
      assert.equal(detail.results.control.members, 4);
      assert.equal(detail.results.control.recorded_sales_q, 40);
      assert.equal(JSON.stringify(detail).includes("5025555"), false);
      await db.query("DELETE FROM customers WHERE id=$1", [control]);
      assert.equal((await details(campaign.id)).results.control.members, 4);
    });
    it("reports a fixed observation window and scoped channel evidence without claiming delivery", async () => {
      const campaign = await active(), member = (await members(campaign.id))[0].customer_id;
      await award(member, { amountQ: 100 });
      await db.query("INSERT INTO growth_message_outbox(id,business_id,campaign_id,customer_id,status) VALUES($1,$2,$3,$4,'accepted')", [randomUUID(),businessId,campaign.id,member]);
      const report = (await details(campaign.id)).results.measurement;
      assert.ok(report, 'Measurement evidence must accompany raw campaign results');
      assert.equal(report.state, 'in_progress');
      assert.equal(report.denominator, 'all_assigned');
      assert.equal(report.messages.accepted, 1);
      assert.equal(report.messages.delivered, null);
      assert.equal(report.messages.read, null);
      assert.equal(report.window.time_basis, 'transaction_created_at');
      assert.ok(Date.parse(report.window.observed_until) <= Date.parse(report.as_of));
      assert.ok(report.return_difference.lower_pp < 0);
      await assert.rejects(details(campaign.id, {businessId:otherBusiness}), {statusCode:404});
      await db.query("UPDATE businesses SET program_json=jsonb_build_object('pos_integration',jsonb_build_object('mode','loyverse','automatic',true,'enabled',true,'last_completed_at',now()-interval '3 days')) WHERE id=$1", [businessId]);
      const stale = (await details(campaign.id)).results.measurement;
      assert.equal(stale.state, 'incomplete_data');
      assert.equal(stale.data_readiness.reason, 'sync_stale');
    });
    it("keeps lost and deleted members in assigned denominators and marks incomplete evidence", async () => {
      const campaign = await active(), member = (await members(campaign.id,'control'))[0].customer_id;
      await db.query("UPDATE customers SET deleted_at=now() WHERE id=$1", [member]);
      let report = (await details(campaign.id)).results;
      assert.equal(report.control.members, 4);
      assert.equal(report.measurement.state, 'incomplete_data');
      assert.equal(report.measurement.unavailable_members, 1);
      await db.query("DELETE FROM customers WHERE id=$1", [member]);
      report = (await details(campaign.id)).results;
      assert.equal(report.control.members, 4);
      assert.equal(report.measurement.state, 'incomplete_data');
      assert.equal(report.measurement.unavailable_members, 1);
      assert.equal(report.measurement.assignment_counts_match, true);
    });
    it("excludes transactions outside the fixed window and records interrupted observation", async () => {
      const campaign = await active(), member = (await members(campaign.id))[0].customer_id;
      await db.query("UPDATE growth_campaigns SET starts_at=now()-interval '14 days', expires_at=now()-interval '1 day' WHERE id=$1",[campaign.id]);
      await db.query("INSERT INTO transactions(id,business_id,customer_id,amount_q,created_at) VALUES($1,$2,$3,70,now()-interval '2 days'),($4,$2,$3,100,now()-interval '20 days'),($5,$2,$3,200,now())",[randomUUID(),businessId,member,randomUUID(),randomUUID()]);
      let report = (await details(campaign.id)).results;
      assert.equal(report.treatment.recorded_sales_q,70);
      assert.equal(report.measurement.state,'insufficient_sample');
      assert.equal(report.measurement.window.complete,true);
      await db.query("UPDATE growth_campaigns SET status='paused',paused_at=now()-interval '3 days' WHERE id=$1",[campaign.id]);
      report = (await details(campaign.id)).results;
      assert.equal(report.measurement.state,'interrupted');
      assert.equal(report.treatment.recorded_sales_q,70);
    });
    it("returns only active eligible customer offers and hides claimed, control, deleted and other tenant data", async () => {
      const campaign = await active();
      const treatment = (await members(campaign.id))[0].customer_id;
      const control = (await members(campaign.id, "control"))[0].customer_id;
      const query = (customerId) =>
        offer.getCustomerGrowthOffers({ businessId, customerId }, deps);
      assert.equal((await query(treatment)).offers.length, 1);
      assert.deepEqual(await query(control), { offers: [] });
      assert.deepEqual(
        await offer.getCustomerGrowthOffers(
          { businessId: otherBusiness, customerId: treatment },
          deps,
        ),
        { offers: [] },
      );
      await award(treatment);
      assert.deepEqual(await query(treatment), { offers: [] });
    });
    it("applies final ledger caps and guardrails atomically without consuming an offer on failure", async () => {
      const campaign = await active();
      const treatment = (await members(campaign.id))[0].customer_id;
      await assert.rejects(award(treatment, { basePoints: 2147483640 }), {
        statusCode: 400,
      });
      await db.query(
        'UPDATE businesses SET program_json=program_json || \'{"award_guard":{"max_points_per_tx":55}}\' WHERE id=$1',
        [businessId],
      );
      await assert.rejects(award(treatment), { statusCode: 403 });
      assert.equal(
        (await members(campaign.id)).find((m) => m.customer_id === treatment)
          .claimed_at,
        null,
      );
    });
    it("integrates staff and POS writers with exact bonus responses, pending balances and immutable receipts", async (t) => {
      const { awardPointsWithDeps } = await import(
        "../../src/app/services/staff-award-service.js"
      );
      const { awardFromExternalEventWithDeps } = await import(
        "../../src/app/services/external-award-service.js"
      );
      const { AuditRepo } = await import(
        "../../src/app/repositories/audit-repository.js"
      );
      t.mock.method(AuditRepo, "log", async () => {});
      const campaign = await active({ pointsBudget: 50 });
      const customerId = (await members(campaign.id))[0].customer_id;
      await db.query(
        'UPDATE businesses SET program_json=program_json || \'{"external_awards":{"enabled":true,"api_key":"test"},"pending_points_hold_days":7}\' WHERE id=$1',
        [businessId],
      );
      const getById = async () =>
        (await db.query("SELECT * FROM businesses WHERE id=$1", [businessId]))
          .rows[0];
      const hook = (args) => {
        assert.deepEqual(args.planFeatureOverrides, {}, "Writers load plan overrides before starting their purchase transaction");
        return offer.claimTargetedOffer(args, {getPlanFeatureOverrides: async () => { throw new Error("Unexpected nested plan read"); }});
      };
      const staffDeps = {
        withTransaction: deps.transaction,
        BusinessRepo: { getById, activeCustomerCount: async () => 20 },
        computePoints: () => 10,
        planLimits: () => ({ activeCustomers: 500 }),
        claimTargetedOffer: hook,
      getPlanFeatureOverrides: deps.getPlanFeatureOverrides,
        verifyQrToken: async () => ({
          bid: businessId,
          cid: customerId,
          jti: "staff-growth-qr",
          exp: Math.floor(Date.now() / 1000) + 900,
        }),
        enqueueWebhookEvent: async () => {},
        isSourceTransactionActive: async () => false,
      };
      const externalDeps = {
        withTransaction: deps.transaction,
        setCurrentTenant: async () => {},
        BusinessRepo: {
          getById,
          getPublicBySlug: async () => ({ id: businessId }),
        },
        CustomerRepo: {
          getById: async () => ({ id: customerId, business_id: businessId }),
          getByBusinessAndPhone: async () => null,
        },
        computePoints: () => 10,
        timingSafeEqualString: (a, b) => a === b,
        claimTargetedOffer: hook,
      getPlanFeatureOverrides: deps.getPlanFeatureOverrides,
      };
      const staffArgs = {
        staff: { id: staffId, business_id: businessId, role: "OWNER" },
        customerQrToken: "test",
        txId: randomUUID(),
        amount_q: 20,
      };
      const externalArgs = {
        businessSlug: "test",
        apiKey: "test",
        externalEventId: "growth-receipt",
        customerId,
        amount_q: 30,
      };
      const results = await Promise.all([
        awardPointsWithDeps(staffDeps, staffArgs),
        awardFromExternalEventWithDeps(externalDeps, externalArgs),
      ]);
      assert.deepEqual(
        results.map((r) => r.pointsAwarded).sort((a, b) => a - b),
        [10, 60],
      );
      assert.ok(results.every((r) => r.status === "PENDING"));
      assert.deepEqual(
        (
          await db.query(
            "SELECT points,pending_points FROM customer_balances WHERE customer_id=$1",
            [customerId],
          )
        ).rows[0],
        { points: 0, pending_points: 70 },
      );
      const again = await Promise.all([
        awardPointsWithDeps(staffDeps, staffArgs),
        awardFromExternalEventWithDeps(externalDeps, externalArgs),
      ]);
      assert.deepEqual(
        again.map((r) => r.pointsAwarded),
        results.map((r) => r.pointsAwarded),
      );
      assert.ok(again.every((r) => r.replay));
      assert.equal((await details(campaign.id)).campaign.points_committed, 50);
      assert.equal((await details(campaign.id)).campaign.budget_exhausted, true);
      assert.equal(
        (await db.query("SELECT COUNT(*) FROM transactions")).rows[0].count,
        "2",
      );
    });
    it("reads shared plan configuration before starting campaign transactions", async () => {
    let inTransaction = false;
    const safeDeps = {
      ...deps,
      getPlanFeatureOverrides: async () => {
        assert.equal(inTransaction, false, "Plan configuration must not open a nested pooled transaction");
        return {};
      },
      transaction: async fn => {
        inTransaction = true;
        try { return await deps.transaction(fn); } finally { inTransaction = false; }
      }
    };
    const {campaign} = await service.createGrowthCampaign({businessId,staffId,requestId:randomUUID(),recoveryRunId,name:"Safe pool",bonusPoints:50,minimumPurchaseQ:10,durationDays:14},safeDeps);
    await service.activateGrowthCampaign({businessId,staffId,campaignId:campaign.id},safeDeps);
    await service.pauseGrowthCampaign({businessId,staffId,campaignId:campaign.id},safeDeps);
  });
  it("enforces tenant foreign keys, forced RLS and tenant-scoped service access", async () => {
      const campaign = await active();
      await assert.rejects(
        details(campaign.id, { businessId: otherBusiness }),
        { statusCode: 404 },
      );
      await assert.rejects(
        db.query(
          "INSERT INTO growth_campaign_members(id,business_id,campaign_id,customer_id) VALUES($1,$2,$3,$4)",
          [randomUUID(), otherBusiness, campaign.id, customers[0]],
        ),
        { code: "23503" },
      );
      const policies = await db.query(
        "SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname IN ('growth_campaigns','growth_campaign_members')",
      );
      assert.equal(policies.rows.length, 2);
      assert.ok(
        policies.rows.every((r) => r.relrowsecurity && r.relforcerowsecurity),
      );
      await db.query(
        "DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='growth_reader') THEN CREATE ROLE growth_reader; END IF; END $$; GRANT USAGE ON SCHEMA public,app TO growth_reader; GRANT SELECT,INSERT,UPDATE ON growth_campaigns,growth_campaign_members TO growth_reader",
      );
      const client = await db.connect();
      try {
        await client.query("SET ROLE growth_reader");
        assert.equal(
          (await client.query("SELECT * FROM growth_campaigns")).rowCount,
          0,
        );
        await client.query("SELECT set_config('app.current_tenant',$1,false)", [
          otherBusiness,
        ]);
        assert.equal(
          (await client.query("SELECT * FROM growth_campaign_members"))
            .rowCount,
          0,
        );
        await client.query("SELECT set_config('app.current_tenant',$1,false)", [
          businessId,
        ]);
        assert.equal(
          (await client.query("SELECT * FROM growth_campaign_members"))
            .rowCount,
          20,
        );
      } finally {
        await client.query("RESET ROLE");
        await client.query("SELECT set_config('app.current_tenant','',false)");
        client.release();
      }
    });
  },
);
