import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";

const url = process.env.CAMPAIGN_CONSENT_TEST_DB_URL;
const suite = url ? describe : describe.skip;
const businessId = randomUUID(),
  customerId = randomUUID(),
  campaignId = randomUUID();
const now = new Date("2026-11-15T16:00:00Z");
let db, database, service, preferences, plans, config, originalPlans, originalFetch;
let submissions, events;
const context = (fn) =>
  database.withDbClientContext({ tenantId: businessId, platformAdmin: false }, fn);
const dispatch = () =>
  service.processCampaignMessagesOnce({ businessId, limit: 1, now: () => now });
const optOut = () =>
  context(() =>
    preferences.setMarketingPreference({ businessId, customerId, marketing_opt_in: false }),
  );
const outbox = async () => (await db.query("SELECT * FROM growth_message_outbox")).rows[0];

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

// Pause after the claim (read 2), or inside the real sendMessage after its
// consent read (read 3). Keep real SQL, transactions and provider routing.
function pausePlanRead(number) {
  const reached = deferred(),
    release = deferred();
  let reads = 0;
  plans.getPlanFeatureOverrides = async () => {
    if (++reads === number) {
      reached.resolve(database.getDbContext().client.processID);
      await release.promise;
    }
    return originalPlans.call(plans);
  };
  return { reached: reached.promise, release: release.resolve };
}

async function waitUntil(check) {
  const deadline = Date.now() + 3000;
  do {
    const value = await check();
    if (value) return value;
    await delay(5);
  } while (Date.now() < deadline);
  assert.fail("Concurrent operation neither completed nor reached the expected PostgreSQL lock");
}

async function completedOrBlocked(pid, completed) {
  return waitUntil(async () => {
    if (completed()) return "completed";
    const { rowCount } = await db.query(
      `SELECT pid FROM pg_stat_activity
      WHERE datname=current_database() AND wait_event_type='Lock' AND $1=ANY(pg_blocking_pids(pid))`,
      [pid],
    );
    return rowCount ? "blocked" : null;
  });
}

async function assertMutationSerialized(mutate, event) {
  const gate = pausePlanRead(3);
  const sending = dispatch();
  let mutation,
    observed,
    completed = false;
  try {
    const pid = await gate.reached;
    assert.equal((await outbox()).status, "processing");
    mutation = mutate().then(() => {
      completed = true;
      events.push(event);
    });
    observed = await completedOrBlocked(pid, () => completed);
  } finally {
    gate.release();
    await Promise.all([sending, mutation]);
  }
  assert.deepEqual(
    events,
    ["provider", event],
    "A completed revocation must precede and prevent every new provider submission",
  );
  assert.equal(
    observed,
    "blocked",
    "Authorization writes must wait for an authorized submission already in progress",
  );
  assert.equal(submissions.length, 1);
}

suite("campaign consent races on disposable PostgreSQL", { timeout: 15000 }, () => {
  before(async () => {
    const parsed = new URL(url);
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname));
    assert.equal(parsed.pathname, "/campaign_consent_test");
    Object.assign(process.env, {
      NODE_ENV: "test",
      DB_HOST: parsed.hostname,
      DB_PORT: parsed.port,
      DB_NAME: "campaign_consent_test",
      DB_USER: decodeURIComponent(parsed.username),
      DB_PASSWORD: decodeURIComponent(parsed.password),
      DB_PASSWORD_FILE: "",
      DB_MIGRATIONS_USER: "",
      DB_MIGRATIONS_PASSWORD: "",
      DB_MIGRATIONS_PASSWORD_FILE: "",
      JWT_SECRET_FILE: "",
      JWT_SECRET: "fixture-campaign-consent-secret-12345678",
    });
    db = new pg.Pool({ connectionString: url });
    await db.query(
      "DROP SCHEMA public CASCADE; CREATE SCHEMA public; CREATE SCHEMA IF NOT EXISTS app",
    );
    await db.query(`CREATE OR REPLACE FUNCTION app.current_tenant() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.current_tenant',true),'')::uuid $$;
      CREATE OR REPLACE FUNCTION app.is_platform_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT COALESCE(current_setting('app.platform_admin',true),'')='true' $$`);
    for (const path of [
      "../../src/app/schema.sql",
      "../../src/app/migrations/2026-02-27-tenant-billing.sql",
      "../../src/app/migrations/2026-11-10-customer-recovery.sql",
      "../../src/app/migrations/2026-11-10-growth-campaigns.sql",
      "../../src/app/migrations/2026-11-10-growth-messaging.sql",
      "../../src/app/migrations/2026-11-10-growth-limits.sql",
      "../../src/app/migrations/2026-11-10-automation-controls.sql",
    ]) {
      // Fixed repository migrations retain the real foreign keys and policies.
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      await db.query(await readFile(new URL(path, import.meta.url), "utf8"));
    }
    database = await import("../../src/app/database.js");
    service = await import("../../src/app/services/campaign-message-service.js");
    preferences = await import("../../src/app/services/marketing-preference-service.js");
    plans = (await import("../../src/app/services/plan-config-service.js")).PlanConfigService;
    config = (await import("../../src/config/index.js")).config;
    originalPlans = plans.getPlanFeatureOverrides;
    originalFetch = globalThis.fetch;
  });

  after(async () => {
    if (plans) plans.getPlanFeatureOverrides = originalPlans;
    if (originalFetch) globalThis.fetch = originalFetch;
    await database?.closeDatabase();
    await db?.end();
  });

  beforeEach(async () => {
    plans.getPlanFeatureOverrides = originalPlans;
    submissions = [];
    events = [];
    Object.assign(config, {
      MESSAGE_PROVIDER_ORDER: ["waha"],
      WAHA_BASE_URL: "http://fixture.invalid",
      WAHA_API_KEY: "fixture-only",
      MESSAGE_PROVIDER_TIMEOUT_MS: 1000,
    });
    // Transport boundary only: never replace sendMessage or perform HTTP I/O.
    globalThis.fetch = async (target, options) => {
      assert.equal(target, "http://fixture.invalid/api/sendText");
      submissions.push(JSON.parse(String(options.body)));
      events.push("provider");
      return Response.json({ id: "fixture-receipt" });
    };
    await db.query("TRUNCATE businesses CASCADE");
    await db.query(
      `INSERT INTO businesses(id,name,slug,email,password_hash,plan)
      VALUES($1,'Consent fixture','consent-fixture','fixture@example.test','unused','NEGOCIO')`,
      [businessId],
    );
    await db.query(
      `INSERT INTO customers(id,business_id,phone,name)
      VALUES($1,$2,'+50255550001','Fixture')`,
      [customerId, businessId],
    );
    await db.query(
      `INSERT INTO growth_campaigns(id,business_id,request_id,name,status,bonus_points,minimum_purchase_q,duration_days,holdout_percent,starts_at,expires_at)
      VALUES($1,$2,$3,'Consent fixture','active',50,20,30,20,$4,$5)`,
      [
        campaignId,
        businessId,
        randomUUID(),
        new Date(now.getTime() - 86400000),
        new Date(now.getTime() + 86400000),
      ],
    );
    await db.query(
      `INSERT INTO growth_campaign_members(id,business_id,campaign_id,customer_id,allocation)
      VALUES($1,$2,$3,$4,'treatment')`,
      [randomUUID(), businessId, campaignId, customerId],
    );
    await context(() =>
      preferences.setMarketingPreference({ businessId, customerId, marketing_opt_in: true }),
    );
    const queued = await context(() =>
      service.queueCampaignMessages({ businessId, campaignId, request_id: randomUUID(), now }),
    );
    assert.equal(queued.queued_count, 1);
  });

  it("serializes real opt-out with the final consent check and provider submission", async () => {
    await assertMutationSerialized(optOut, "opt-out completed");
    assert.equal((await outbox()).status, "accepted");
    assert.equal(
      (await context(() => preferences.getMarketingPreference({ businessId, customerId })))
        .marketing_opt_in,
      false,
    );
  });

  it("suppresses a completed opt-out after claim and before dispatch authorization", async () => {
    const gate = pausePlanRead(2),
      sending = dispatch();
    try {
      const dispatchPid = await gate.reached;
      await context(async (client) => {
        assert.notEqual(client.processID, dispatchPid, "Use independent PostgreSQL contexts");
        await preferences.setMarketingPreference({
          businessId,
          customerId,
          marketing_opt_in: false,
        });
      });
    } finally {
      gate.release();
      await sending;
    }
    assert.equal(submissions.length, 0);
    assert.equal((await outbox()).status, "suppressed");
    assert.equal((await db.query("SELECT * FROM message_logs")).rowCount, 0);
  });

  it("also serializes a preference-row update that does not lock the customer first", async () => {
    await assertMutationSerialized(
      () =>
        context(() =>
          database.dbQuery(
            "UPDATE customer_marketing_preferences SET marketing_opt_in=false WHERE business_id=$1 AND customer_id=$2",
            [businessId, customerId],
          ),
        ),
      "preference revoked",
    );
  });

  it("locks customer before preference and rechecks a revocation that already owns the customer lock", async () => {
    const gate = pausePlanRead(2),
      sending = dispatch();
    let finished = false;
    sending.finally(() => {
      finished = true;
    });
    try {
      await gate.reached;
      await context(() =>
        database.withTransaction(async (client) => {
          await client.query("SET LOCAL lock_timeout='2s'");
          await client.query("SELECT id FROM customers WHERE business_id=$1 AND id=$2 FOR UPDATE", [
            businessId,
            customerId,
          ]);
          gate.release();
          await completedOrBlocked(client.processID, () => finished);
          // The same order used by setMarketingPreference must not deadlock with
          // dispatch holding preference first and waiting for this customer.
          await client.query(
            `UPDATE customer_marketing_preferences SET marketing_opt_in=false
          WHERE business_id=$1 AND customer_id=$2`,
            [businessId, customerId],
          );
        }),
      );
    } finally {
      gate.release();
      await sending;
    }
    assert.equal(submissions.length, 0);
    assert.equal((await outbox()).status, "suppressed");
  });

  it("serializes customer deletion with an authorized submission", async () => {
    await assertMutationSerialized(
      () =>
        context(() =>
          database.dbQuery("UPDATE customers SET deleted_at=now() WHERE business_id=$1 AND id=$2", [
            businessId,
            customerId,
          ]),
        ),
      "customer deleted",
    );
  });

  for (const hardDelete of [false, true]) {
    it(`does not submit after ${hardDelete ? "hard" : "soft"} deletion completed before dispatch authorization`, async () => {
      const gate = pausePlanRead(2),
        sending = dispatch();
      try {
        await gate.reached;
        await context(() =>
          database.dbQuery(
            hardDelete
              ? "DELETE FROM customers WHERE business_id=$1 AND id=$2"
              : "UPDATE customers SET deleted_at=now() WHERE business_id=$1 AND id=$2",
            [businessId, customerId],
          ),
        );
      } finally {
        gate.release();
        await sending;
      }
      assert.equal(submissions.length, 0);
      if (hardDelete) assert.equal(await outbox(), undefined);
      else assert.equal((await outbox()).status, "suppressed");
    });
  }

  it("uses the current authorized customer destination when it changes after claim", async () => {
    const gate = pausePlanRead(2),
      sending = dispatch();
    try {
      await gate.reached;
      await context(() =>
        database.dbQuery("UPDATE customers SET phone=$1 WHERE business_id=$2 AND id=$3", [
          "+50255550002",
          businessId,
          customerId,
        ]),
      );
    } finally {
      gate.release();
      await sending;
    }
    assert.equal(submissions.length, 1);
    assert.equal(submissions[0].chatId, "50255550002@c.us");
    assert.equal((await outbox()).status, "accepted");
  });

  it("releases authorization locks after a bounded provider timeout and never retries uncertainty", async () => {
    config.MESSAGE_PROVIDER_TIMEOUT_MS = 250;
    const providerStarted = deferred();
    globalThis.fetch = async (_target, options) => {
      submissions.push(JSON.parse(String(options.body)));
      events.push("provider");
      providerStarted.resolve(database.getDbContext().client.processID);
      await new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(options.signal.reason), {
          once: true,
        });
      });
      throw new Error("Fixture transport must finish only by aborting");
    };
    const sending = dispatch();
    const pid = await providerStarted.promise;
    let completed = false;
    const revoking = optOut().then(() => {
      completed = true;
      events.push("opt-out completed");
    });
    const observed = await completedOrBlocked(pid, () => completed);
    await Promise.all([sending, revoking]);
    assert.equal(observed, "blocked");
    assert.deepEqual(events, ["provider", "opt-out completed"]);
    assert.equal((await outbox()).status, "uncertain");
    await dispatch();
    assert.equal(submissions.length, 1);
    assert.equal(
      (
        await db.query(`SELECT * FROM pg_stat_activity
      WHERE datname=current_database() AND state='idle in transaction'`)
      ).rowCount,
      0,
    );
  });
});
