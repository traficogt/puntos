import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  APP_FUNCTION_SIGNATURES,
  APP_PUBLIC_TABLES,
  APP_TABLE_PRIVILEGES,
  buildGrantPlan
} from "../../src/scripts/create-app-role.mjs";

describe("create-app-role grant plan", () => {
  it("uses explicit table grants without default privileges", () => {
    const plan = buildGrantPlan({ appDbUser: "puntos_app", dbName: "puntos" });
    const sql = plan.statements.join("\n");

    assert.match(sql, /GRANT CONNECT ON DATABASE "puntos" TO "puntos_app"/);
    assert.match(sql, /GRANT SELECT, INSERT ON TABLE /);
    assert.doesNotMatch(sql, /ON ALL TABLES IN SCHEMA public TO "puntos_app"/);
    assert.doesNotMatch(sql, /ALTER DEFAULT PRIVILEGES/);
    assert.ok(APP_PUBLIC_TABLES.includes("background_jobs"));
  });

  it("keeps the explicit privilege matrix least-privilege by default", () => {
    assert.deepEqual(APP_TABLE_PRIVILEGES.audit_logs, ["SELECT", "INSERT"]);
    assert.deepEqual(APP_TABLE_PRIVILEGES.auth_action_tokens, ["SELECT", "INSERT", "UPDATE"]);
    assert.deepEqual(APP_TABLE_PRIVILEGES.mobile_push_devices, ["SELECT", "INSERT", "UPDATE"]);
    assert.deepEqual(APP_TABLE_PRIVILEGES.auth_sessions, ["INSERT", "UPDATE"]);
    assert.deepEqual(APP_TABLE_PRIVILEGES.ledger_reconciliation_runs, ["SELECT", "INSERT", "UPDATE"]);
    assert.deepEqual(APP_TABLE_PRIVILEGES.ledger_reconciliation_findings, ["SELECT", "INSERT", "UPDATE"]);
    assert.deepEqual(APP_TABLE_PRIVILEGES.ledger_balance_corrections, ["SELECT", "INSERT", "UPDATE"]);
    assert.deepEqual(APP_TABLE_PRIVILEGES.ledger_balance_adjustments, ["SELECT", "INSERT"]);
    assert.deepEqual(APP_TABLE_PRIVILEGES.orders, ["SELECT", "INSERT", "UPDATE"]);
    assert.deepEqual(APP_TABLE_PRIVILEGES.order_returns, ["SELECT", "INSERT"]);
    assert.deepEqual(APP_TABLE_PRIVILEGES.contact_identifiers, ["SELECT", "INSERT", "UPDATE"]);
    assert.deepEqual(APP_TABLE_PRIVILEGES.redemptions, ["SELECT", "INSERT"]);
    assert.deepEqual(APP_TABLE_PRIVILEGES.transactions, ["SELECT", "INSERT", "UPDATE"]);
    assert.deepEqual(APP_TABLE_PRIVILEGES.verify_codes, ["SELECT", "INSERT", "UPDATE", "DELETE"]);
    assert.deepEqual(APP_TABLE_PRIVILEGES.wallet_passes, ["SELECT"]);
    assert.deepEqual(APP_TABLE_PRIVILEGES.super_admin_auth_settings, ["SELECT", "INSERT", "UPDATE"]);
    assert.ok(APP_PUBLIC_TABLES.includes("orders"));
    assert.ok(APP_PUBLIC_TABLES.includes("order_returns"));
    assert.ok(APP_PUBLIC_TABLES.includes("contact_identifiers"));
    assert.equal(
      APP_TABLE_PRIVILEGES.orders.join(","),
      "SELECT,INSERT,UPDATE"
    );
  });

  it("preserves the minimum pilot, recovery, campaign and marketing privileges after role regeneration", () => {
    const required = {
      merchant_pilots: ["SELECT", "INSERT", "UPDATE"],
      merchant_pilot_checks: ["SELECT", "INSERT", "UPDATE"],
      recovery_runs: ["SELECT", "INSERT", "UPDATE"],
      recovery_members: ["SELECT", "INSERT", "UPDATE"],
      growth_campaigns: ["SELECT", "INSERT", "UPDATE"],
      growth_campaign_members: ["SELECT", "INSERT", "UPDATE", "DELETE"],
      customer_marketing_preferences: ["SELECT", "INSERT", "UPDATE"],
      marketing_unsubscribe_tokens: ["SELECT", "INSERT"],
      growth_message_requests: ["SELECT", "INSERT"],
      growth_message_outbox: ["SELECT", "INSERT", "UPDATE"]
    };
    const options = { appDbUser: "puntos_app", dbName: "puntos" };
    const plan = buildGrantPlan(options);
    assert.deepEqual(buildGrantPlan(options), plan);
    const revokeIndex = plan.statements.indexOf('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM "puntos_app"');
    assert.ok(revokeIndex >= 0);
    for (const [table, privileges] of Object.entries(required)) {
      const actual = Object.entries(APP_TABLE_PRIVILEGES).find(([name]) => name === table)?.[1];
      assert.deepEqual(actual, privileges, `${table} must retain only its runtime operations`);
      assert.ok(APP_PUBLIC_TABLES.includes(table), `${table} must remain on the explicit allowlist`);
      const grants = plan.statements.filter(statement => statement.startsWith("GRANT ") && statement.includes(`public."${table}"`));
      assert.equal(grants.length, 1, `${table} must have exactly one explicit table grant`);
      assert.ok(grants[0].startsWith(`GRANT ${privileges.join(", ")} ON TABLE `));
      assert.ok(plan.statements.indexOf(grants[0]) > revokeIndex, `${table} privileges must be restored after revocation`);
    }
  });

  it("keeps runtime app function grants explicit", () => {
    assert.deepEqual(APP_FUNCTION_SIGNATURES, [
      "app.current_tenant()",
      "app.is_platform_admin()",
      "app.is_webhook_ingest()",
      "app.auth_session_lookup(text)",
      "app.mobile_push_session_valid(uuid,uuid,uuid,boolean)",
      "app.auth_session_touch(uuid,timestamp with time zone)",
      "app.auth_session_invalidate_by_id(uuid,text)",
      "app.auth_session_invalidate_by_actor(text,uuid,text,text)",
      "app.auth_session_mark_reauthenticated(uuid,boolean)",
      "app.security_message_log_create(uuid,uuid,uuid,text,text,text,text,text,text)",
      "app.security_message_log_update_status(uuid,text,text,text)",
      "app.security_event_log(uuid,text,text,uuid,text,text,text,text,uuid,jsonb)",
      "app.staff_login_lookup(text)",
      "app.sync_business_public()",
      "app.sync_staff_login_index()"
    ]);
  });
});

it('limits branch changes to public Wallet location columns',()=>{
 const sql=buildGrantPlan({appDbUser:'puntos_app',dbName:'puntos'}).statements.join('\n');
 assert.deepEqual(APP_TABLE_PRIVILEGES.branches,['SELECT','INSERT']);
 assert.match(sql,/GRANT UPDATE \(wallet_location_enabled, wallet_latitude, wallet_longitude\) ON TABLE public\."branches" TO "puntos_app"/);
 assert.match(sql,/REVOKE UPDATE \(wallet_location_enabled, wallet_latitude, wallet_longitude\) ON TABLE public\."branches" FROM "puntos_app"/);
});
