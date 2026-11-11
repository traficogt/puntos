import assert from "node:assert/strict";
import crypto from "node:crypto";
import pg from "pg";
import test from "node:test";
import { pool, closeDatabase, runWithDbContext, withTransaction } from "../../src/app/database.js";
import { PlanConfigService } from "../../src/app/services/plan-config-service.js";
import { awardFromExternalEventTrusted } from "../../src/app/services/external-award-service.js";

test("plan reads and ledger transactions finish while all request connections are occupied", {
  skip: process.env.RUN_INTEGRATION !== "true"
}, async () => {
  assert.ok(process.env.NODE_ENV === "test" && process.env.DB_NAME === "puntos_e2e"
    && process.env.DB_HOST === "db" && process.env.DB_USER === "loyalty_app",
  "This regression may only run inside the disposable pilot stack");
  const admin = new pg.Client({ host: process.env.DB_HOST, database: process.env.DB_NAME,
    user: process.env.DB_MIGRATIONS_USER, password: process.env.DB_MIGRATIONS_PASSWORD });
  const businessId = crypto.randomUUID(), otherId = crypto.randomUUID(), customerId = crypto.randomUUID();
  const slug = `pool-isolation-${businessId.slice(0, 8)}`;
  await admin.connect();
  try {
    for (const [id, fixtureSlug] of [[businessId, slug], [otherId, `other-${slug}`]]) {
      await admin.query(`INSERT INTO businesses (id,name,slug,email,password_hash,plan,program_type,program_json)
        VALUES ($1,$2,$2,$3,'test-only','EMPRESA','SPEND',$4)`,
      [id, fixtureSlug, `${fixtureSlug}@example.invalid`, { points_per_q: 1, external_awards: { enabled: true, api_key: "test-only" } }]);
    }
    await admin.query("INSERT INTO customers (id,business_id,phone,name) VALUES ($1,$2,'50255554444','Pool regression')", [customerId, businessId]);
    await admin.query("INSERT INTO customer_balances (customer_id) VALUES ($1)", [customerId]);

    async function underSaturatedRequestPool(operation) {
      const clients = await Promise.all(Array.from({ length: 20 }, () => pool.connect()));
      const pending = Promise.all(clients.map((client, index) => runWithDbContext({
        client, tenantId: businessId, platformAdmin: false, webhookIngest: false
      }, async () => {
        await client.query("SELECT set_config('app.current_tenant',$1,false), set_config('app.platform_admin','',false)", [businessId]);
        await operation(index);
      })));
      let timer;
      let finishedWhileHeld = false;
      try {
        finishedWhileHeld = await Promise.race([
          pending.then(() => true),
          new Promise(resolve => { timer = setTimeout(() => resolve(false), 3000); })
        ]);
        if (finishedWhileHeld) {
          await Promise.all(clients.map(async client => {
            const { rows } = await client.query("SELECT current_setting('app.platform_admin',true) AS elevated");
            assert.notEqual(rows[0].elevated, "true", "the request connection must never inherit plan-read privileges");
            const foreign = await client.query("SELECT id FROM businesses WHERE id=$1", [otherId]);
            assert.equal(foreign.rowCount, 0, "foreign business rows remain hidden after the transaction");
          }));
        }
      } finally {
        clearTimeout(timer);
        // Also drain the original broken implementation after the deadline so
        // a failing regression cannot leave the disposable pool hanging.
        if (!finishedWhileHeld) clients.forEach(client => client.release());
        await pending;
        if (finishedWhileHeld) {
          await Promise.all(clients.map(client => client.query("SELECT set_config('app.current_tenant','',false), set_config('app.platform_admin','',false)")));
          clients.forEach(client => client.release());
        }
      }
      assert.equal(finishedWhileHeld, true, "work starved behind the 20 request connections it needed to finish");
    }

    await underSaturatedRequestPool(async () => {
      assert.equal(typeof await PlanConfigService.getPlanFeatureOverrides(), "object");
    });
    await underSaturatedRequestPool(async index => {
      await withTransaction(async client => {
        const state = await client.query("SELECT current_user AS role, current_setting('app.platform_admin',true) AS elevated");
        assert.equal(state.rows[0].role, process.env.DB_USER);
        assert.notEqual(state.rows[0].elevated, "true", "a previous plan read cannot elevate the next transaction");
        const foreign = await client.query("SELECT id FROM businesses WHERE id=$1", [otherId]);
        assert.equal(foreign.rowCount, 0);
      });
      if (index === 0) {
        await assert.rejects(withTransaction(async client => {
          await client.query("UPDATE customer_balances SET points=points+100 WHERE customer_id=$1", [customerId]);
          throw new Error("intentional rollback");
        }), /intentional rollback/);
      }
      await awardFromExternalEventTrusted({
        businessSlug: slug, customerId, externalEventId: `pool-award-${index}`, amount_q: 1, visits: 1
      });
    });
    const { rows } = await admin.query("SELECT points, lifetime_points FROM customer_balances WHERE customer_id=$1", [customerId]);
    assert.equal(Number(rows[0].points), 20);
    assert.equal(Number(rows[0].lifetime_points), 20);
    const count = await admin.query("SELECT count(*)::int AS count FROM transactions WHERE business_id=$1", [businessId]);
    assert.equal(count.rows[0].count, 20);
  } finally {
    try { await admin.query("DELETE FROM businesses WHERE id=ANY($1::uuid[])", [[businessId, otherId]]); }
    finally { await admin.end(); await closeDatabase(); }
  }
});
