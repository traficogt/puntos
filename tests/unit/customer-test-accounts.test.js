// Test-account marker (customers.is_test): every counting surface must filter marked
// accounts out at each reference to the customers table, while operational reads keep
// them. These tests pin the statements each service runs; the real-database behaviour
// (a marked customer disappears from owner progress and plan usage) is covered by
// tests/integration/customer-test-accounts.test.js under `npm run test:db`.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, describe, it } from "node:test";
import express from "express";
import cookieParser from "cookie-parser";
import { pool } from "../../src/app/database.js";
import { runWithDbContext } from "../../src/app/db/context.js";
import { config } from "../../src/config/index.js";
import { errorHandler } from "../../src/middleware/common.js";
import { StaffRepo } from "../../src/app/repositories/staff-repository.js";
import { BusinessRepo } from "../../src/app/repositories/business-repository.js";
import { TrialRepo } from "../../src/app/repositories/trial-repository.js";
import { TxnRepo } from "../../src/app/repositories/transaction-repository.js";
import { PlanConfigService } from "../../src/app/services/plan-config-service.js";
import { createBrowserSession } from "../../src/app/services/auth-session-service.js";
import { loadOwnerProgressFacts } from "../../src/app/services/owner-progress-service.js";
import {
  getRewardExposure,
  getStaffActivity,
} from "../../src/app/services/activation-insights-service.js";
import { businessSummary } from "../../src/app/services/analytics-service.js";
import { getMerchantOverview } from "../../src/app/services/merchant-overview-service.js";
import { getPilot } from "../../src/app/services/merchant-pilot-service.js";
import { previewWeeklyOwnerBrief } from "../../src/app/services/weekly-owner-brief-service.js";

const businessId = randomUUID();
const originals = {
  query: pool.query,
  staff: StaffRepo.getById,
  business: BusinessRepo.getById,
  plans: PlanConfigService.getPlanFeatureOverrides,
};
afterEach(() => {
  pool.query = originals.query;
  StaffRepo.getById = originals.staff;
  BusinessRepo.getById = originals.business;
  PlanConfigService.getPlanFeatureOverrides = originals.plans;
});

/** References to the customers table that need a filter (aliased joins and bare FROMs). */
const referencePattern = /\bcustomers\s+(?:c|customer)\b|\bFROM\s+customers\s+WHERE\b/g;
/** Explicit exclusions of marked accounts. */
const exclusionPattern = /\bNOT\s+(?:c|customer)\.is_test\b|\bNOT\s+is_test\b/g;
/** Guards on tables without a customers join (transactions, redemptions). */
const guardPattern = /NOT EXISTS \(SELECT 1 FROM customers c WHERE [^)]*\bc\.is_test\)/g;

/**
 * Every customers reference in `sql` must carry an is_test exclusion. Guards on other
 * tables are counted separately so they neither hide nor inflate a reference.
 * @param {string} sql
 * @param {string} label
 */
function assertExcludesTestAccounts(sql, label) {
  const guards = (sql.match(guardPattern) || []).length;
  const stripped = sql.replace(guardPattern, "");
  const references = (stripped.match(referencePattern) || []).length;
  const exclusions = (stripped.match(exclusionPattern) || []).length;
  assert.ok(references + guards > 0, `${label}: expected a customers reference or guard`);
  assert.ok(
    exclusions >= references,
    `${label}: ${references} customers reference(s) but ${exclusions} is_test exclusion(s)\n${sql}`,
  );
  return { references, exclusions, guards };
}

/** @param {(sql: string) => {rows: any[]}} [answer] */
function recorder(answer = () => ({ rows: [] })) {
  /** @type {string[]} */
  const statements = [];
  const query = async (/** @type {string} */ sql) => {
    statements.push(String(sql));
    return answer(String(sql));
  };
  return { statements, query };
}

describe("test accounts are excluded from every counting surface", () => {
  it("owner progress facts filter marked accounts at each customers reference", async () => {
    const { statements, query } = recorder(() => ({
      rows: [{ program_type: "SPEND", program_json: {}, customer_branding_json: {} }],
    }));
    const facts = await loadOwnerProgressFacts(query, businessId);
    assert.equal(statements.length, 1);
    const counts = assertExcludesTestAccounts(statements[0], "owner progress facts");
    // genuine awards, first award, returning customers, redemptions (2), team readiness,
    // award weeks and the active-customer head count all read customers.
    assert.ok(counts.references >= 8, `expected the eight facts joins, saw ${counts.references}`);
    assert.equal(facts.active_customers, 0);
  });

  it("activation insights (reward exposure and staff activity) filter marked accounts", async () => {
    const { statements, query } = recorder((sql) =>
      sql.includes("FROM businesses")
        ? { rows: [{ program_json: {}, owner_progress_variant: null }] }
        : {
            rows: [
              {
                issued: {},
                protected_choices: {},
                points: { outstanding: 0 },
                cost_per_point_q: null,
                completed: {},
                history_start: "2026-11-01T00:00:00Z",
                start_at: "2026-11-23T06:00:00Z",
                totals: {},
                staff: [],
                sources: [],
                staff_total: 0,
              },
            ],
          },
    );
    pool.query = /** @type {any} */ (query);
    await runWithDbContext({ tenantId: businessId }, async () => {
      await getRewardExposure({ businessId });
      await getStaffActivity({ businessId });
    });
    const reports = statements.filter((sql) => !sql.includes("FROM businesses"));
    assert.equal(reports.length, 2);
    const exposure = assertExcludesTestAccounts(reports[0], "reward exposure");
    assert.equal(exposure.references, 4, "issued, choices, balances and completed");
    const activity = assertExcludesTestAccounts(reports[1], "staff activity");
    assert.equal(activity.references, 2, "transactions and ledger adjustments");
  });

  it("plan soft-cap usage (activeCustomerCount) and the basic report filter marked accounts", async () => {
    const { statements, query } = recorder((sql) => ({
      rows: [
        sql.includes("AS tx_count") ? { tx_count: 0, amount_sum: "0.00", points_sum: 0 } : { c: 0 },
      ],
    }));
    pool.query = /** @type {any} */ (query);
    assert.equal(await BusinessRepo.activeCustomerCount(businessId), 0);
    assertExcludesTestAccounts(statements[0], "activeCustomerCount");
    statements.length = 0;
    const summary = await businessSummary(businessId);
    assert.deepEqual(summary, {
      customers: 0,
      activeCustomers: 0,
      tx30: { tx_count: 0, amount_sum: "0.00", points_sum: 0 },
      redemptions30: 0,
    });
    for (const sql of statements) assertExcludesTestAccounts(sql, "businessSummary");
    statements.length = 0;
    await businessSummary(businessId, randomUUID());
    for (const sql of statements) assertExcludesTestAccounts(sql, "businessSummary(branch)");
    statements.length = 0;
    await TxnRepo.summaryByBusiness(businessId, 30);
    assert.match(statements[0], guardPattern, "30-day movements guard against test accounts");
  });

  it("the Reportes overview filters marked accounts out of purchases and redemptions", async () => {
    const { statements, query } = recorder((sql) =>
      sql.includes("FROM businesses")
        ? { rows: [{ program_json: {} }] }
        : {
            rows: [
              {
                start_at: "2026-11-04T06:00:00Z",
                end_at: "2026-11-10T18:00:00Z",
                previous_start_at: "2026-10-28T06:00:00Z",
                previous_end_at: "2026-11-03T18:00:00Z",
                current: {},
                previous: {},
                daily: [],
                rewards: [],
              },
            ],
          },
    );
    await getMerchantOverview({ businessId }, query);
    const overview = statements.find((sql) => sql.includes("customer_counts"));
    assert.ok(overview);
    assert.equal(assertExcludesTestAccounts(overview, "merchant overview").references, 2);
  });

  it("pilot evidence metrics filter marked accounts", async () => {
    const { statements, query } = recorder();
    await assert.rejects(getPilot({ businessId, pilotId: randomUUID() }, { query }), /Piloto/);
    assert.equal(
      assertExcludesTestAccounts(statements[0], "pilot metrics").references,
      3,
      "purchases, new customers and redemptions",
    );
  });

  it("the weekly owner brief counts purchases of real customers only", async () => {
    const sentinel = new Error("captured");
    const { statements, query } = recorder((sql) => {
      if (sql.includes("FROM businesses"))
        return { rows: [{ id: businessId, plan: "EMPRESA", program_json: {} }] };
      if (sql.includes("FROM staff_users"))
        return { rows: [{ id: "owner", role: "OWNER", active: true }] };
      if (sql.includes("posted_purchases")) throw sentinel;
      return { rows: [] };
    });
    await assert.rejects(
      previewWeeklyOwnerBrief(
        { businessId, staffId: "owner" },
        { query, getPlanFeatureOverrides: async () => ({}) },
      ),
      (error) => error === sentinel,
    );
    const brief = statements.find((sql) => sql.includes("posted_purchases"));
    assert.ok(brief);
    assert.equal(
      assertExcludesTestAccounts(brief, "weekly brief").references,
      2,
      "posted and pending purchases",
    );
  });

  it("the super trials list counts real customers only", async () => {
    const { statements, query } = recorder();
    pool.query = /** @type {any} */ (query);
    await TrialRepo.listTrials();
    assertExcludesTestAccounts(statements[0], "trial listing");
    assert.match(statements[0], /owner_progress_milestones/, "activation facts stay derived");
  });

  it("the advanced analytics dashboard filters marked accounts (business and branch scope)", async () => {
    const staffId = randomUUID(),
      branchId = randomUUID();
    StaffRepo.getById = async () => ({
      id: staffId,
      business_id: businessId,
      role: "OWNER",
      branch_id: null,
      active: true,
    });
    BusinessRepo.getById = async () => ({ id: businessId, plan: "EMPRESA" });
    PlanConfigService.getPlanFeatureOverrides = async () => ({});
    const { statements, query } = recorder((sql) =>
      sql.includes("FROM branches") && !sql.includes("LATERAL")
        ? { rows: [{ id: branchId, business_id: businessId }] }
        : { rows: [{}] },
    );
    pool.query = /** @type {any} */ (query);
    const { default: analyticsRoutes } = await import("../../src/app/routes/analytics-routes.js");
    const session = await createBrowserSession({
      actorType: "STAFF",
      actorId: staffId,
      businessId,
      role: "OWNER",
    });
    const app = express();
    app.use(cookieParser());
    app.use("/api", analyticsRoutes);
    app.use(errorHandler);
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    try {
      const address = /** @type {import("node:net").AddressInfo} */ (server.address());
      const headers = { cookie: `${config.STAFF_COOKIE_NAME}=${session.token}` };
      for (const scope of ["", `?branch_id=${branchId}`]) {
        statements.length = 0;
        const response = await fetch(
          `http://127.0.0.1:${address.port}/api/admin/analytics/dashboard${scope}`,
          { headers },
        );
        assert.equal(response.status, 200, scope || "business scope");
        const reports = statements.filter((sql) => /\bcustomers\b/.test(sql));
        assert.ok(reports.length >= 3, `dashboard ${scope || "business"} statements`);
        for (const sql of reports) {
          assert.match(sql, /(?:NOT c\.is_test|c\.is_test\))/);
          if (scope && sql.includes("AS total_points_issued")) {
            assert.match(
              sql,
              /FROM transactions t\s+JOIN customers c[^\n]+NOT c\.is_test\s+WHERE t\.business_id = \$1\s+AND t\.branch_id = \$2\s+AND t\.points > 0/,
            );
          }
        }
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe("operational reads keep test accounts, visibly", () => {
  it("the directory projection and the CSV export carry the flag instead of hiding the row", async () => {
    const { CustomerDirectoryRepo } =
      await import("../../src/app/repositories/customer-directory-repository.js");
    const { CustomerRepo } = await import("../../src/app/repositories/customer-repository.js");
    const { statements, query } = recorder(() => ({ rows: [{ total: 0 }] }));
    pool.query = /** @type {any} */ (query);
    await CustomerDirectoryRepo.list({ businessId });
    await CustomerRepo.listByBusiness(businessId);
    for (const sql of statements.filter((sql) => /SELECT c\.id/.test(sql))) {
      assert.match(sql, /c\.is_test/, "the flag is selected");
      assert.doesNotMatch(sql, exclusionPattern, "the row is not filtered out");
    }
  });

  it("writes the tenant-scoped marker and audit together, returning only the marker", async () => {
    const { CustomerDirectoryRepo } =
      await import("../../src/app/repositories/customer-directory-repository.js");
    const customerId = randomUUID();
    const { statements, query } = recorder(() => ({ rows: [{ id: customerId, is_test: true }] }));
    pool.query = /** @type {any} */ (query);
    const row = await CustomerDirectoryRepo.setTestAccount(
      { businessId, customerId, isTest: true },
      { type: "STAFF", id: randomUUID(), ip: null, ua: null },
    );
    assert.deepEqual(row, { id: customerId, is_test: true });
    assert.equal(statements.length, 1);
    assert.match(statements[0], /UPDATE customers SET is_test = \$3/);
    assert.match(statements[0], /business_id = \$1 AND id = \$2 AND deleted_at IS NULL/);
    assert.match(statements[0], /INSERT INTO audit_logs/);
    assert.doesNotMatch(statements[0], /points|customer_balances/);
  });
});
