import { applyCampaignExpansionFixture } from "../helpers/campaign-expansion-schema.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { before, beforeEach, after, describe, it } from "node:test";
import pg from "pg";

const databaseUrl = process.env.AUDIENCES_TEST_DB_URL;
const integration = databaseUrl ? describe : describe.skip;
const businessId = randomUUID(), otherBusiness = randomUUID(), staffId = randomUUID();
const now = new Date("2026-11-10T12:00:00Z"), day = 86400000;
const ago = days => new Date(now.getTime() - days * day);
const rule = (field, operator, value) => ({ field, operator, value });
const definition = (rules = [rule("has_purchase", "eq", true)], exclude = [], match = "all") => ({ window_days: 90, include: { match, rules }, exclude: { match: "any", rules: exclude } });
let db, service, growth, deps, customers, audits;

integration("reusable audiences and campaign snapshots on disposable PostgreSQL", () => {
  before(async () => {
    const url = new URL(databaseUrl);
    assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
    assert.equal(url.pathname, "/audience_targeting_test");
    db = new pg.Pool({ connectionString: databaseUrl });
    await db.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    // Fixed repository fixture path.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await db.query(await readFile(new URL("../fixtures/customer-recovery.sql", import.meta.url), "utf8"));
    await db.query("ALTER TABLE businesses ADD COLUMN plan text DEFAULT 'NEGOCIO', ADD COLUMN program_json jsonb DEFAULT '{}'; ALTER TABLE customers ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(); CREATE TABLE customer_balances(customer_id uuid PRIMARY KEY,points int DEFAULT 0);");
    for (const file of ["2026-11-10-customer-recovery.sql", "2026-11-10-growth-campaigns.sql", "2026-11-10-growth-limits.sql", "2026-11-10-growth-messaging.sql"])
      // Fixed internal migration names, never client input.
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      await db.query(await readFile(new URL(`../../src/app/migrations/${file}`, import.meta.url), "utf8"));
    let migration;
    // Fixed repository migration path.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    try { migration = await readFile(new URL("../../src/app/migrations/2026-11-10-reusable-audiences.sql", import.meta.url), "utf8"); } catch { /* asserted below */ }
    assert.ok(migration, "Reusable audience schema must exist");
    await db.query(migration);
    await db.query(migration);
    await applyCampaignExpansionFixture(db);
    service = await import("../../src/app/services/customer-audience-service.js");
    growth = await import("../../src/app/services/growth-campaign-service.js");
    deps = {
      query: db.query.bind(db), getPlanFeatureOverrides: async () => ({}), audit: async event => audits.push(event),
      transaction: async fn => {
        const client = await db.connect();
        try { await client.query("BEGIN"); const result = await fn(client); await client.query("COMMIT"); return result; }
        catch (error) { await client.query("ROLLBACK"); throw error; }
        finally { client.release(); }
      },
    };
  });
  after(async () => { await db?.end(); });
  beforeEach(async () => {
    audits = []; customers = Array.from({ length: 20 }, () => randomUUID());
    await db.query("TRUNCATE businesses,staff_users,customers,transactions,customer_balances CASCADE");
    await db.query("INSERT INTO businesses(id) VALUES($1),($2)", [businessId, otherBusiness]);
    await db.query("INSERT INTO staff_users VALUES($1,$2)", [staffId, businessId]);
    for (const [i, id] of customers.entries()) {
      await db.query("INSERT INTO customers(id,business_id,name,phone,created_at,deleted_at) VALUES($1,$2,$3,$4,$5,$6)", [id, businessId, `Cliente ${i}`, `5025555${String(i).padStart(4, "0")}`, ago(i === 0 ? 5 : 100), i === 6 ? now : null]);
      await db.query("INSERT INTO customer_balances VALUES($1,$2)", [id, i === 3 ? 200 : 20]);
      if (i >= 8 || [1, 2, 3].includes(i)) await purchase(id, i === 1 ? 200 : 10, i === 3 ? 500 : 20);
    }
    await purchase(customers[2], 1, 30, { status: "PENDING" });
    await purchase(customers[4], 1, 900, { source: "manual" });
    await purchase(customers[4], 1, 900, { type: "ADJUST" });
    await purchase(customers[4], 1, 900, { reversed_transaction_id: randomUUID() });
    await purchase(customers[4], 1, 900, { original_transaction_id: randomUUID() });
    await purchase(customers[5], -1, 900);
    await purchase(customers[6], 1, 900);
    await purchase(customers[7], 1, 900, { business_id: otherBusiness });
    await db.query("INSERT INTO customer_marketing_preferences(business_id,customer_id,marketing_opt_in) VALUES($1,$2,true),($1,$3,true)", [businessId, customers[0], customers[2]]);
  });

  async function purchase(id, days, amount, extra = {}) {
    await db.query("INSERT INTO transactions(id,business_id,customer_id,amount_q,created_at,status,source,type,original_transaction_id,reversed_transaction_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [randomUUID(), extra.business_id || businessId, id, amount, ago(days), extra.status || "POSTED", extra.source || "online", extra.type || "PURCHASE", extra.original_transaction_id || null, extra.reversed_transaction_id || null]);
  }
  const preview = value => service.previewCustomerAudience({ businessId, definition: value, limit: 20, now }, deps);
  const create = (extra = {}) => service.createCustomerSegment({ businessId, staffId, requestId: randomUUID(), name: "Frecuentes", definition: definition(), ...extra }, deps);
  const campaign = (segment, extra = {}) => growth.createGrowthCampaign({ businessId, staffId, requestId: randomUUID(), name: "Oferta", audienceSegmentId: segment.id, audienceSegmentVersion: segment.version, audienceLimit: 20, bonusPoints: 20, durationDays: 14, now, ...extra }, deps);

  it("evaluates any/all plus exclusion with purchase-only metrics and no contact details", async () => {
    const result = await preview(definition([rule("purchase_count", "gte", 2), rule("spend_q", "gte", 500)], [], "any"));
    assert.deepEqual(new Set(result.customers.map(c => c.id)), new Set([customers[2], customers[3]]));
    assert.equal(result.total, 2); assert.equal(result.contactable_count, 1);
    assert.equal(result.customers.find(c => c.id === customers[2]).spend_q, 50);
    assert.equal(result.customers.find(c => c.id === customers[2]).purchase_count, 2);
    assert.equal(result.generated_at, now.toISOString());
    assert.equal(result.customers[0].phone, undefined);
    const excluded = await preview(definition([rule("purchase_count", "gte", 2), rule("spend_q", "gte", 500)], [rule("points_balance", "gte", 150)], "any"));
    assert.deepEqual(excluded.customers.map(c => c.id), [customers[2]]);
  });
  it("distinguishes never purchased from old purchases and handles null exclusions", async () => {
    const never = await preview(definition([rule("has_purchase", "eq", false)], [rule("last_purchase_days", "gte", 30)]));
    assert.deepEqual(new Set(never.customers.map(c => c.id)), new Set([customers[0], customers[4], customers[5], customers[7]]));
    assert.ok(never.customers.every(c => c.last_purchase_days === null && c.purchase_count === 0));
    const old = await preview(definition([rule("last_purchase_days", "gte", 30)]));
    assert.deepEqual(old.customers.map(c => c.id), [customers[1]]);
    assert.equal(old.customers[0].purchase_count, 0);
    const recent = await preview(definition([rule("joined_days", "lte", 30), rule("has_purchase", "eq", false)]));
    assert.deepEqual(recent.customers.map(c => c.id), [customers[0]]);
  });
  it("applies the requested window and counts consent separately without opting anyone in", async () => {
    const annual = await preview({ ...definition([rule("purchase_count", "gte", 1)]), window_days: 365 });
    assert.ok(annual.customers.some(c => c.id === customers[1]));
    const consenting = await preview(definition([rule("marketing_opt_in", "eq", true)]));
    assert.deepEqual(new Set(consenting.customers.map(c => c.id)), new Set([customers[0], customers[2]]));
    assert.equal(consenting.contactable_count, 2);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM customer_marketing_preferences")).rows[0].n, 2);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM growth_message_outbox")).rows[0].n, 0);
  });
  it("uses elapsed-day window boundaries and keeps matching totals independent of sample size", async () => {
    await purchase(customers[0], 90, 12.25);
    await purchase(customers[0], 90 + 1 / 86400, 99);
    const result = await preview(definition([rule("spend_q", "eq", 12.25)]));
    assert.equal(result.total, 1); assert.equal(result.customers[0].id, customers[0]);
    assert.equal(result.customers[0].purchase_count, 1);
    const small = await service.previewCustomerAudience({ businessId, definition: definition(), limit: 1, now }, deps);
    assert.ok(small.total > 1); assert.equal(small.customers.length, 1);
    await assert.rejects(service.previewCustomerAudience({ businessId, definition: definition(), limit: 21, now }, deps), { statusCode: 400 });
  });
  it("creates once, preserves original create retries after edits and rejects stale updates", async () => {
    const requestId = randomUUID();
    const [a, b] = await Promise.all([create({ requestId }), create({ requestId })]);
    assert.equal(a.segment.id, b.segment.id); assert.equal(a.segment.version, 1);
    const updated = await service.updateCustomerSegment({ businessId, staffId, segmentId: a.segment.id, version: 1, name: "Nuevo", definition: definition([rule("has_purchase", "eq", false)]), archived: false }, deps);
    assert.equal(updated.segment.version, 2);
    assert.equal((await create({ requestId })).segment.id, a.segment.id);
    await assert.rejects(create({ requestId, name: "Diferente" }), { statusCode: 409 });
    await assert.rejects(service.updateCustomerSegment({ businessId, staffId, segmentId: a.segment.id, version: 1, name: "Viejo", definition: definition(), archived: true }, deps), { statusCode: 409 });
    assert.equal((await service.listCustomerSegments({ businessId }, deps)).total, 1);
  });
  it("keeps tenant boundaries and limits saved segments including archived entries", async () => {
    const { segment } = await create();
    assert.equal((await service.listCustomerSegments({ businessId: otherBusiness }, deps)).total, 0);
    await assert.rejects(service.updateCustomerSegment({ businessId: otherBusiness, staffId, segmentId: segment.id, version: 1, name: "Other", definition: definition(), archived: false }, deps), { statusCode: 404 });
    await db.query("INSERT INTO merchant_audiences(id,business_id,request_id,request_fingerprint,name,definition,archived) SELECT gen_random_uuid(),$1,gen_random_uuid(),repeat('a',64),'Archivado', $2::jsonb,true FROM generate_series(1,99)", [businessId, JSON.stringify(definition())]);
    await assert.rejects(create(), { statusCode: 409 });
    assert.equal((await service.listCustomerSegments({ businessId }, deps)).total, 100);
  });
  it("saves a fixed audience snapshot and keeps create retries stable after a segment edit", async () => {
    const { segment } = await create();
    const requestId = randomUUID();
    const first = await campaign(segment, { requestId });
    assert.equal(first.campaign.status, "draft");
    assert.equal(first.campaign.recovery_run_id, null);
    assert.equal(first.campaign.audience_snapshot.segment_version, 1);
    assert.equal((await db.query("SELECT program_json FROM businesses WHERE id=$1", [businessId])).rows[0].program_json.targeted_offers_enabled, undefined);
    const beforeMembers = (await db.query("SELECT customer_id FROM growth_campaign_members WHERE campaign_id=$1 ORDER BY customer_id", [first.campaign.id])).rows;
    await service.updateCustomerSegment({ businessId, staffId, segmentId: segment.id, version: 1, name: "Changed", definition: definition([rule("has_purchase", "eq", false)]), archived: true }, deps);
    const retry = await campaign(segment, { requestId });
    assert.deepEqual(retry.campaign.audience_snapshot, first.campaign.audience_snapshot);
    assert.deepEqual((await db.query("SELECT customer_id FROM growth_campaign_members WHERE campaign_id=$1 ORDER BY customer_id", [first.campaign.id])).rows, beforeMembers);
    await assert.rejects(campaign(segment), { statusCode: 409 });
    assert.equal((await db.query("SELECT count(*)::int AS n FROM growth_message_outbox")).rows[0].n, 0);
  });
  it("requires explicit limits and discloses overflow while preserving holdout assignments", async () => {
    await db.query("INSERT INTO customers(id,business_id,name,phone,created_at) SELECT gen_random_uuid(),$1,'Sin compras','50255554444',$2 FROM generate_series(1,205)", [businessId, ago(5)]);
    const { segment } = await create({ definition: definition([rule("has_purchase", "eq", false)]) });
    await assert.rejects(campaign(segment, { audienceLimit: undefined }), { statusCode: 400 });
    await assert.rejects(campaign(segment, { audienceLimit: 201 }), { statusCode: 400 });
    const result = await campaign(segment, { audienceLimit: 200 });
    assert.equal(result.campaign.member_count, 200);
    assert.equal(result.campaign.audience_snapshot.total, 209);
    assert.equal(result.campaign.audience_snapshot.overflow_count, 9);
    const active = await growth.activateGrowthCampaign({ businessId, staffId, campaignId: result.campaign.id }, deps);
    assert.equal(active.campaign.control_count, 40);
    const allocations = (await db.query("SELECT id,allocation FROM growth_campaign_members WHERE campaign_id=$1 ORDER BY id", [result.campaign.id])).rows;
    await service.updateCustomerSegment({ businessId, staffId, segmentId: segment.id, version: 1, name: "New rules", definition: definition(), archived: false }, deps);
    assert.deepEqual((await db.query("SELECT id,allocation FROM growth_campaign_members WHERE campaign_id=$1 ORDER BY id", [result.campaign.id])).rows, allocations);
  });
  it("rechecks plan entitlements for writes and refuses cross-tenant segment snapshots", async () => {
    const { segment } = await create();
    await assert.rejects(campaign(segment, { businessId: otherBusiness }), { statusCode: 404 });
    await db.query("UPDATE businesses SET plan='EMPRENDEDOR' WHERE id=$1", [businessId]);
    await assert.rejects(create(), { statusCode: 403 });
    await assert.rejects(service.updateCustomerSegment({ businessId, staffId, segmentId: segment.id, version: 1, name: "No", definition: definition(), archived: false }, deps), { statusCode: 403 });
  });
  it("records support attribution for audience changes and resulting campaign creation", async () => {
    const impersonated_by = "support@example.invalid";
    const { segment } = await create({ impersonated_by });
    await service.updateCustomerSegment({ businessId, staffId, segmentId: segment.id, version: 1, name: "Support edit", definition: definition(), archived: false, impersonated_by }, deps);
    await campaign({ ...segment, version: 2 }, { impersonated_by });
    assert.equal(audits.length, 3);
    assert.ok(audits.every(event => event.meta.impersonated_by_super_admin_email === impersonated_by));
  });
  it("allows a first consent row while campaign snapshot waits for the same customer", async () => {
    const { segment } = await create();
    const preference = await db.connect();
    let campaignPid, result, preferenceError;
    await preference.query("BEGIN");
    const preferencePid = (await preference.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    await preference.query("SELECT id FROM customers WHERE id=$1 FOR UPDATE", [customers[3]]);
    const creating = growth.createGrowthCampaign({ businessId, staffId, requestId: randomUUID(), name: "Concurrent consent", audienceSegmentId: segment.id, audienceSegmentVersion: 1, audienceLimit: 20, bonusPoints: 20, durationDays: 14, now }, {
      ...deps, transaction: fn => deps.transaction(async client => { campaignPid = (await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid; return fn(client); }),
    }).then(value => ({ value }), error => ({ error }));
    try {
      const deadline = Date.now() + 2000;
      let blocked = false;
      while (Date.now() < deadline) {
        if (campaignPid) blocked = (await db.query("SELECT $1::int=ANY(pg_blocking_pids($2::int)) AS blocked", [preferencePid, campaignPid])).rows[0].blocked;
        if (blocked) break;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.equal(blocked, true, "Campaign must actually wait for the customer lock");
      try {
        await preference.query("INSERT INTO customer_marketing_preferences(business_id,customer_id,marketing_opt_in) VALUES($1,$2,true)", [businessId, customers[3]]);
        await preference.query("COMMIT");
      } catch (error) { preferenceError = error; await preference.query("ROLLBACK"); }
      result = await creating;
    } finally { await preference.query("ROLLBACK"); preference.release(); }
    assert.equal(preferenceError, undefined);
    assert.equal(result.error, undefined);
    assert.equal(result.value.campaign.status, "draft");
  });
  it("enforces row-level tenant isolation with an unprivileged database role", async () => {
    const { segment } = await create();
    await db.query("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='audience_fixture_actor') THEN CREATE ROLE audience_fixture_actor NOLOGIN; END IF; END $$; GRANT USAGE ON SCHEMA public,app TO audience_fixture_actor; GRANT SELECT,INSERT,UPDATE ON merchant_audiences TO audience_fixture_actor");
    const client = await db.connect();
    try {
      await client.query("BEGIN"); await client.query("SET LOCAL ROLE audience_fixture_actor");
      await client.query("SELECT set_config('app.current_tenant',$1,true)", [otherBusiness]);
      assert.equal((await client.query("SELECT id FROM merchant_audiences")).rowCount, 0);
      await client.query("SELECT set_config('app.current_tenant',$1,true)", [businessId]);
      assert.deepEqual((await client.query("SELECT id FROM merchant_audiences")).rows, [{ id: segment.id }]);
      await assert.rejects(client.query("INSERT INTO merchant_audiences(id,business_id,request_id,request_fingerprint,name,definition) VALUES($1,$2,$3,repeat('a',64),'Other',$4::jsonb)", [randomUUID(), otherBusiness, randomUUID(), JSON.stringify(definition())]), { code: "42501" });
    } finally { await client.query("ROLLBACK"); client.release(); }
  });
});
