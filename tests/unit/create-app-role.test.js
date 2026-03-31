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
    assert.deepEqual(APP_TABLE_PRIVILEGES.auth_sessions, ["INSERT", "UPDATE"]);
    assert.deepEqual(APP_TABLE_PRIVILEGES.ledger_reconciliation_runs, ["SELECT", "INSERT", "UPDATE"]);
    assert.deepEqual(APP_TABLE_PRIVILEGES.ledger_reconciliation_findings, ["SELECT", "INSERT", "UPDATE"]);
    assert.deepEqual(APP_TABLE_PRIVILEGES.ledger_balance_corrections, ["SELECT", "INSERT", "UPDATE"]);
    assert.deepEqual(APP_TABLE_PRIVILEGES.ledger_balance_adjustments, ["SELECT", "INSERT"]);
    assert.deepEqual(APP_TABLE_PRIVILEGES.redemptions, ["SELECT", "INSERT"]);
    assert.deepEqual(APP_TABLE_PRIVILEGES.transactions, ["SELECT", "INSERT", "UPDATE"]);
    assert.deepEqual(APP_TABLE_PRIVILEGES.verify_codes, ["SELECT", "INSERT", "UPDATE", "DELETE"]);
    assert.deepEqual(APP_TABLE_PRIVILEGES.wallet_passes, ["SELECT"]);
    assert.deepEqual(APP_TABLE_PRIVILEGES.super_admin_auth_settings, ["SELECT", "INSERT", "UPDATE"]);
    assert.equal(APP_PUBLIC_TABLES.length, Object.keys(APP_TABLE_PRIVILEGES).length);
  });

  it("keeps runtime app function grants explicit", () => {
    assert.deepEqual(APP_FUNCTION_SIGNATURES, [
      "app.current_tenant()",
      "app.is_platform_admin()",
      "app.is_webhook_ingest()",
      "app.auth_session_lookup(text)",
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
