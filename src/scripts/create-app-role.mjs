#!/usr/bin/env node
/**
 * Create a least-privilege application DB role (login, nosuperuser, nobypassrls) and grant explicit runtime rights.
 *
 * Env:
 *   APP_DB_USER (default: puntos_app)
 *   APP_DB_PASSWORD (required)
 *   DB_HOST/DB_PORT/DB_NAME
 *   DB_MIGRATIONS_USER/DB_MIGRATIONS_PASSWORD (fallback to DB_USER/DB_PASSWORD)
 */
import pg from "pg";
import { pathToFileURL } from "node:url";

const {
  APP_DB_USER = "puntos_app",
  APP_DB_PASSWORD,
  DB_HOST = "localhost",
  DB_PORT = 5432,
  DB_NAME = "puntos",
  DB_MIGRATIONS_USER,
  DB_MIGRATIONS_PASSWORD,
  DB_USER,
  DB_PASSWORD
} = process.env;

export const APP_TABLE_PRIVILEGES = {
  businesses: ["SELECT", "INSERT", "UPDATE"],
  business_public: ["SELECT"],
  branches: ["SELECT", "INSERT"],
  staff_users: ["SELECT", "INSERT", "UPDATE"],
  customers: ["SELECT", "INSERT", "UPDATE"],
  auth_sessions: ["INSERT", "UPDATE"],
  auth_action_tokens: ["SELECT", "INSERT", "UPDATE"],
  merchant_audiences: ["SELECT", "INSERT", "UPDATE"],
  second_visit_budgets: ["SELECT", "INSERT", "UPDATE"],
  second_visit_enrollments: ["SELECT", "INSERT"],
  owner_brief_email_verifications: ["SELECT", "INSERT", "UPDATE"],
  weekly_owner_briefs: ["SELECT", "INSERT", "UPDATE"],
  customer_import_jobs: ["SELECT", "INSERT", "UPDATE"],
  reward_promise_cycles: ["SELECT", "INSERT", "UPDATE"],
  customer_reward_promises: ["SELECT", "INSERT"],
  reward_availability: ["SELECT", "INSERT", "UPDATE"],
  hospitality_grants: ["SELECT", "INSERT", "UPDATE"],
  hospitality_entitlements: ["SELECT", "INSERT"],
  reward_entitlement_fulfillments: ["SELECT", "INSERT"],
  growth_campaign_preparations: ["SELECT", "INSERT", "UPDATE"],
  growth_campaign_preflights: ["SELECT", "INSERT"],
  merchant_decision_reviews: ["SELECT", "INSERT", "UPDATE"],
  service_cases: ["SELECT", "INSERT", "UPDATE"],
  service_case_events: ["SELECT", "INSERT"],
  service_redemption_restorations: ["SELECT", "INSERT"],
  staff_service_grants: ["SELECT", "INSERT", "UPDATE"],
  staff_service_usage: ["SELECT", "INSERT"],
  staff_shift_notices: ["SELECT", "INSERT", "UPDATE"],
  staff_shift_acknowledgements: ["SELECT", "INSERT"],
  customer_migration_batches: ["SELECT", "INSERT"],
  customer_balances: ["SELECT", "INSERT", "UPDATE"],
  contact_identifiers: ["SELECT", "INSERT", "UPDATE"],
  ledger_reconciliation_runs: ["SELECT", "INSERT", "UPDATE"],
  ledger_reconciliation_findings: ["SELECT", "INSERT", "UPDATE"],
  ledger_balance_corrections: ["SELECT", "INSERT", "UPDATE"],
  ledger_balance_adjustments: ["SELECT", "INSERT"],
  rewards: ["SELECT", "INSERT", "UPDATE"],
  reward_branches: ["SELECT", "INSERT", "DELETE"],
  transactions: ["SELECT", "INSERT", "UPDATE"],
  orders: ["SELECT", "INSERT", "UPDATE"],
  order_returns: ["SELECT", "INSERT"],
  redemptions: ["SELECT", "INSERT"],
  merchant_catalog_items: ["SELECT", "INSERT", "UPDATE"],
  merchant_catalog_sources: ["SELECT", "INSERT", "UPDATE"],
  merchant_inventory_snapshots: ["SELECT", "INSERT", "UPDATE"],
  merchant_catalog_events: ["SELECT", "INSERT"],
  pos_checkout_sources: ["SELECT", "INSERT", "UPDATE"],
  pos_checkout_intents: ["SELECT", "INSERT", "UPDATE"],
  reward_workspace_requests: ["SELECT", "INSERT"],
  reward_pos_mappings: ["SELECT", "INSERT", "UPDATE"],
  redemption_pos_records: ["SELECT", "INSERT", "UPDATE"],
  redemption_pos_events: ["SELECT", "INSERT"],
  verify_codes: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  qr_tokens: ["SELECT", "INSERT"],
  message_logs: ["SELECT", "INSERT", "UPDATE"],
  webhook_endpoints: ["SELECT", "INSERT", "UPDATE"],
  webhook_deliveries: ["SELECT", "INSERT", "UPDATE"],
  audit_logs: ["SELECT", "INSERT"],
  security_events: ["SELECT", "INSERT"],
  lifecycle_events: ["SELECT", "INSERT"],
  lifecycle_automation_budgets: ["SELECT", "INSERT", "UPDATE"],
  lifecycle_message_outbox: ["SELECT", "INSERT", "UPDATE"],
  pos_refund_receipts: ["SELECT", "INSERT", "UPDATE"],
  acquisition_sources: ["SELECT", "INSERT", "UPDATE"],
  acquisition_visits: ["SELECT", "INSERT", "DELETE"],
  acquisition_attributions: ["SELECT", "INSERT"],
  reward_unit_costs: ["SELECT", "INSERT", "UPDATE"],
  reward_economics_settings: ["SELECT", "INSERT", "UPDATE"],
  redemption_cost_snapshots: ["SELECT", "INSERT"],
  merchant_pilots: ["SELECT", "INSERT", "UPDATE"],
  merchant_pilot_checks: ["SELECT", "INSERT", "UPDATE"],
  recovery_runs: ["SELECT", "INSERT", "UPDATE"],
  recovery_members: ["SELECT", "INSERT", "UPDATE"],
  growth_campaigns: ["SELECT", "INSERT", "UPDATE"],
  // Activation removes members whose customer was deleted after the snapshot.
  growth_campaign_members: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  customer_marketing_preferences: ["SELECT", "INSERT", "UPDATE"],
  marketing_unsubscribe_tokens: ["SELECT", "INSERT"],
  growth_message_requests: ["SELECT", "INSERT"],
  growth_message_outbox: ["SELECT", "INSERT", "UPDATE"],
  billing_events: ["SELECT", "INSERT"],
  background_jobs: ["SELECT", "INSERT", "UPDATE"],
  payment_webhook_events: ["SELECT", "INSERT", "UPDATE"],
  super_admin_auth_settings: ["SELECT", "INSERT", "UPDATE"],
  gift_cards: ["SELECT", "INSERT", "UPDATE"],
  gift_card_transactions: ["SELECT", "INSERT"],
  platform_settings: ["SELECT", "INSERT", "UPDATE"],
  loyalty_tiers: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  customer_tiers: ["SELECT", "INSERT", "UPDATE"],
  tier_history: ["SELECT", "INSERT"],
  referral_codes: ["SELECT", "INSERT", "UPDATE"],
  referrals: ["SELECT", "INSERT", "UPDATE"],
  referral_settings: ["SELECT", "INSERT", "UPDATE"],
  achievements: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  customer_achievements: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  challenges: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  customer_challenges: ["SELECT", "INSERT", "UPDATE"],
  visit_streaks: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  customer_segments: ["SELECT", "INSERT"],
  customer_segment_assignments: ["SELECT", "INSERT", "DELETE"],
  customer_ltv: ["SELECT", "INSERT", "UPDATE"],
  customer_cohorts: ["SELECT", "INSERT"],
  customer_cohort_assignments: ["SELECT", "INSERT"],
  mobile_access_codes: ["SELECT", "INSERT", "UPDATE"],
  mobile_access_grants: ["SELECT", "INSERT", "UPDATE"],
  mobile_push_devices: ["SELECT", "INSERT", "UPDATE"],
  native_wallet_passes: ["SELECT", "INSERT", "UPDATE"],
  native_wallet_registrations: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  wallet_passes: ["SELECT"],
  wallet_pass_updates: ["SELECT"]
};

export const APP_PUBLIC_TABLES = Object.keys(APP_TABLE_PRIVILEGES);

export const APP_FUNCTION_SIGNATURES = [
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
];

function quoteIdent(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function quoteLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function buildGrantPlan({ appDbUser, dbName }) {
  const appDbUserIdent = quoteIdent(appDbUser);
  const appDbUserLiteral = quoteLiteral(appDbUser);
  const dbNameIdent = quoteIdent(dbName);
  const grantGroups = new Map();

  for (const [table, privileges] of Object.entries(APP_TABLE_PRIVILEGES)) {
    const key = privileges.join(", ");
    const qualifiedTable = `public.${quoteIdent(table)}`;
    const tables = grantGroups.get(key) || [];
    tables.push(qualifiedTable);
    grantGroups.set(key, tables);
  }

  const grantStatements = Array.from(grantGroups.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([privileges, tables]) =>
      `GRANT ${privileges} ON TABLE ${tables.join(", ")} TO ${appDbUserIdent}`
    );

  return {
    statements: [
      `GRANT CONNECT ON DATABASE ${dbNameIdent} TO ${appDbUserIdent}`,
      `GRANT USAGE ON SCHEMA public TO ${appDbUserIdent}`,
      `REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ${appDbUserIdent}`,
      `REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM ${appDbUserIdent}`,
      `REVOKE UPDATE (wallet_location_enabled, wallet_latitude, wallet_longitude) ON TABLE public."branches" FROM ${appDbUserIdent}`,
      `REVOKE UPDATE (status) ON TABLE public."redemptions" FROM ${appDbUserIdent}`,
      ...grantStatements,
      `GRANT UPDATE (status) ON TABLE public."redemptions" TO ${appDbUserIdent}`,
      `GRANT UPDATE (wallet_location_enabled, wallet_latitude, wallet_longitude) ON TABLE public."branches" TO ${appDbUserIdent}`,
      `GRANT USAGE, SELECT ON SEQUENCE public.native_wallet_revision_seq TO ${appDbUserIdent}`,
      "CREATE SCHEMA IF NOT EXISTS app",
      `GRANT USAGE ON SCHEMA app TO ${appDbUserIdent}`
    ],
    grantFunctionsSql: `DO $$
    DECLARE
      fn_sig text;
    BEGIN
      FOREACH fn_sig IN ARRAY ARRAY[${APP_FUNCTION_SIGNATURES.map((signature) => quoteLiteral(signature)).join(", ")}]
      LOOP
        IF to_regprocedure(fn_sig) IS NOT NULL THEN
          EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I', fn_sig, ${appDbUserLiteral});
        END IF;
      END LOOP;
    END$$;`
  };
}

async function main() {
  if (!APP_DB_PASSWORD) {
    console.error("APP_DB_PASSWORD is required (will be used to create the app role).");
    process.exit(1);
  }

  const connUser = DB_MIGRATIONS_USER || DB_USER;
  const connPass = DB_MIGRATIONS_PASSWORD || DB_PASSWORD;

  if (!connUser || !connPass) {
    console.error("DB_MIGRATIONS_USER/DB_MIGRATIONS_PASSWORD (or DB_USER/DB_PASSWORD) are required to create roles.");
    process.exit(1);
  }

  const client = new pg.Client({
    host: DB_HOST,
    port: Number(DB_PORT),
    database: DB_NAME,
    user: connUser,
    password: connPass
  });

  await client.connect();
  await client.query("BEGIN");
  try {
    const appDbUserLiteral = quoteLiteral(APP_DB_USER);
    const appDbPasswordLiteral = quoteLiteral(APP_DB_PASSWORD);

    await client.query(`DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${appDbUserLiteral}) THEN
        EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS', ${appDbUserLiteral}, ${appDbPasswordLiteral});
      ELSE
        EXECUTE format('ALTER ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS', ${appDbUserLiteral}, ${appDbPasswordLiteral});
      END IF;
    END$$;`);

    const plan = buildGrantPlan({ appDbUser: APP_DB_USER, dbName: DB_NAME });
    for (const statement of plan.statements) {
      await client.query(statement);
    }
    await client.query(plan.grantFunctionsSql);

    await client.query("COMMIT");
    console.log(`App role '${APP_DB_USER}' ensured with explicit runtime grants.`);
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    await client.end();
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
