// Test accounts ("cuenta de prueba") against the live stack: a customer marked is_test keeps
// its card and points but disappears from owner progress, the plan soft-cap usage, the basic
// report and the platform-owner counts; unmarking brings it back. RUN_INTEGRATION-gated
// (`npm run test:db`), restricted runtime role, RLS enforced.
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { closeDatabase, withTransaction } from "../../src/app/database.js";
import { CustomerDirectoryRepo } from "../../src/app/repositories/customer-directory-repository.js";
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { config } from "../../src/config/index.js";
import { resolveJoinCode } from "./_support/dev-join-code.js";

const runIntegration = process.env.RUN_INTEGRATION === "true";
const integrationDescribe = runIntegration ? describe : describe.skip;

function applySetCookieJar(jar, response) {
  const values =
    typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  for (const raw of values) {
    const first = String(raw || "").split(";")[0];
    const eq = first.indexOf("=");
    if (eq <= 0) continue;
    jar.set(first.slice(0, eq), first.slice(eq + 1));
  }
}
const cookieHeader = (jar) =>
  Array.from(jar.entries())
    .map(([key, value]) => `${key}=${value}`)
    .join("; ");

integrationDescribe("Customer test accounts (cuenta de prueba) integration", () => {
  after(closeDatabase);
  const baseUrl = process.env.TEST_API_URL || "http://localhost:3001";
  const browserOrigin = new URL(baseUrl).origin;
  const superEmail = process.env.SUPER_ADMIN_EMAIL;
  const superPassword = process.env.SUPER_ADMIN_PASSWORD;
  const forwardedFor =
    process.env.TEST_CLIENT_IP || `198.51.100.${Math.max(10, Math.floor(Math.random() * 200))}`;

  async function request(jar, path, options = {}) {
    const headers = {
      "Content-Type": "application/json",
      "X-Forwarded-For": forwardedFor,
      ...(options.headers || {}),
    };
    const cookie = cookieHeader(jar);
    if (cookie) headers.Cookie = cookie;
    if (options.csrf) {
      headers["X-CSRF-Token"] = jar.get("pf_csrf_readable") || "";
      headers.Origin ??= browserOrigin;
      headers.Referer ??= `${browserOrigin}/`;
    }
    const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
    applySetCookieJar(jar, response);
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { response, data, status: response.status };
  }

  it("migrates existing rows, supports legacy inserts and rolls the marker back on audit failure", async () => {
    // A transaction-local schema keeps this upgrade test independent of all tenant data.
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed managed migration.
    const migration = await readFile(
      new URL("../../src/app/migrations/2026-11-26-d-customer-test-accounts.sql", import.meta.url),
      "utf8",
    );
    await withTransaction(async (client) => {
      const businessId = crypto.randomUUID(),
        customerId = crypto.randomUUID();
      await client.query("SET LOCAL search_path = pg_temp");
      await client.query(`CREATE TEMP TABLE customers (
        id uuid PRIMARY KEY, business_id uuid NOT NULL, deleted_at timestamptz
      ) ON COMMIT DROP`);
      const legacyInsert = "INSERT INTO customers (id,business_id) VALUES ($1,$2)";
      await client.query(legacyInsert, [customerId, businessId]);
      await client.query(migration);
      await client.query(migration);
      await client.query(legacyInsert, [crypto.randomUUID(), businessId]);
      assert.deepEqual((await client.query("SELECT is_test FROM customers")).rows, [
        { is_test: false },
        { is_test: false },
      ]);
      // Reject the audit INSERT after the UPDATE. Both changes must roll back under the runtime role.
      await client.query(`CREATE TEMP TABLE audit_logs (
        id uuid, business_id uuid, actor_type text, actor_id uuid, action text CHECK (false),
        ip text, ua text, meta jsonb
      ) ON COMMIT DROP`);
      await client.query("SAVEPOINT marker_write");
      await assert.rejects(
        CustomerDirectoryRepo.setTestAccount(
          { businessId, customerId, isTest: true },
          { type: "STAFF", id: crypto.randomUUID(), ip: null, ua: null },
        ),
        { code: "23514" },
      );
      await client.query("ROLLBACK TO SAVEPOINT marker_write");
      assert.equal(
        (await client.query("SELECT is_test FROM customers WHERE id=$1", [customerId])).rows[0]
          .is_test,
        false,
      );
    });
  });

  it("excludes a marked customer from progress, plan usage, reports and super counts without touching its points", async () => {
    if (!superEmail || !superPassword)
      throw new Error(
        "SUPER_ADMIN_EMAIL/SUPER_ADMIN_PASSWORD are required for this integration test",
      );
    const superJar = new Map(),
      ownerJar = new Map(),
      managerJar = new Map(),
      customerJar = new Map();
    const login = await request(superJar, "/api/super/login", {
      method: "POST",
      body: JSON.stringify({ email: superEmail, password: superPassword }),
    });
    assert.equal(login.status, 200);

    const rand = Math.random().toString(36).slice(2, 9);
    const password = "LanternOrchardMarble2026!";
    const created = await request(superJar, "/api/super/businesses", {
      method: "POST",
      csrf: true,
      body: JSON.stringify({
        businessName: `Prueba ${rand}`,
        email: `owner-test-accounts-${rand}@example.com`,
        password,
        category: "cafe",
        plan: "EMPRESA",
        program_type: "SPEND",
        program_json: { points_per_q: 1, round: "ceil" },
      }),
    });
    assert.equal(created.status, 201);
    const businessId = created.data?.business?.id,
      businessSlug = created.data?.business?.slug;
    assert.ok(businessId && businessSlug);

    const impersonate = await request(superJar, `/api/super/impersonate/${businessId}`, {
      method: "POST",
      csrf: true,
      body: "{}",
    });
    assert.equal(impersonate.status, 200);
    for (const [key, value] of superJar.entries())
      if (key === config.STAFF_COOKIE_NAME || key.startsWith("pf_csrf")) ownerJar.set(key, value);

    const reward = await request(ownerJar, "/api/admin/rewards", {
      method: "POST",
      csrf: true,
      body: JSON.stringify({ name: `Café ${rand}`, description: "Prueba", points_cost: 5 }),
    });
    assert.equal(reward.status, 200);

    // The owner's own phone joins the program.
    const phone = `+50255${Math.floor(Math.random() * 1000000)
      .toString()
      .padStart(6, "0")}`;
    const joinPath = `/api/public/business/${encodeURIComponent(businessSlug)}/join`;
    const requested = await request(customerJar, `${joinPath}/request-code`, {
      method: "POST",
      body: JSON.stringify({ phone, name: "Teléfono de la dueña" }),
    });
    assert.equal(requested.status, 200);
    const code = resolveJoinCode({ requestCodeData: requested.data, businessSlug, phone });
    const verified = await request(customerJar, `${joinPath}/verify`, {
      method: "POST",
      body: JSON.stringify({ phone, code, name: "Teléfono de la dueña" }),
    });
    assert.equal(verified.status, 200);

    let me = await request(customerJar, "/api/customer/me");
    assert.equal(me.status, 200);
    const customerId = me.data.customer.id;
    assert.equal(me.data.customer.is_test, false, "a fresh account is real by default");

    // Directory shows the row unmarked; the owner marks it before rehearsing.
    let directory = await request(ownerJar, "/api/admin/customers?limit=25");
    assert.equal(directory.status, 200);
    assert.equal(directory.data.total, 1);
    assert.equal(directory.data.customers[0].is_test, false);

    const badBody = await request(ownerJar, `/api/admin/customers/${customerId}/test-account`, {
      method: "PATCH",
      csrf: true,
      body: JSON.stringify({ is_test: "yes" }),
    });
    assert.equal(badBody.status, 400);
    const marked = await request(ownerJar, `/api/admin/customers/${customerId}/test-account`, {
      method: "PATCH",
      csrf: true,
      body: JSON.stringify({ is_test: true }),
    });
    assert.equal(marked.status, 200);
    assert.equal(marked.data.customer.is_test, true);
    assert.equal(marked.data.customer.id, customerId);

    // The customer card carries the label; nothing else about the account changed.
    me = await request(customerJar, "/api/customer/me");
    assert.equal(me.data.customer.is_test, true);
    assert.equal(me.data.customer.points, 0);

    // A genuine-looking award on the test phone.
    const qr = await request(customerJar, "/api/public/customer/qr", {
      method: "POST",
      csrf: true,
      body: "{}",
    });
    assert.equal(qr.status, 200);
    const award = await request(ownerJar, "/api/staff/award", {
      method: "POST",
      csrf: true,
      body: JSON.stringify({
        customerQrToken: qr.data.token,
        amount_q: 50,
        txId: crypto.randomUUID(),
      }),
    });
    assert.equal(award.status, 200, JSON.stringify(award.data));
    me = await request(customerJar, "/api/customer/me");
    const awardedBalance = me.data.customer.points;
    assert.ok(
      awardedBalance >= 50,
      "the test card receives its purchase points, including any plan bonus",
    );

    // Owner progress: no genuine award, no primer_cliente, no momentum.
    let progress = await request(ownerJar, "/api/admin/owner-progress");
    assert.equal(progress.status, 200);
    assert.equal(progress.data.launch.steps.find((s) => s.key === "live").done, false);
    assert.equal(progress.data.milestones.find((m) => m.key === "primer_cliente").reached_at, null);
    assert.deepEqual(progress.data.momentum, {
      weeks: 0,
      current_week_active: false,
      freezes_available: 1,
    });

    // Plan soft-cap usage and basic reporting exclude the account.
    const plan = await request(ownerJar, "/api/admin/plan");
    assert.equal(plan.status, 200);
    assert.equal(plan.data.usage.active_customers, 0);
    const summary = await request(ownerJar, "/api/admin/analytics/summary");
    assert.equal(summary.status, 200);
    assert.equal(summary.data.customers, 0);
    assert.equal(summary.data.activeCustomers, 0);
    assert.equal(summary.data.tx30.tx_count, 0);
    const overview = await request(ownerJar, "/api/admin/analytics/overview?days=30");
    assert.equal(overview.status, 200);
    assert.equal(overview.data.current.purchases, 0);
    assert.equal(overview.data.current.active_customers, 0);

    const roi = await request(ownerJar, "/api/admin/roi?days=30");
    assert.equal(roi.status, 200);
    assert.equal(roi.data.roi.tx_current, 0);
    assert.equal(roi.data.roi.customers_total, 0);
    const dashboard = await request(ownerJar, "/api/admin/analytics/dashboard");
    assert.equal(dashboard.status, 200);
    assert.equal(Number(dashboard.data.summary.total_points_issued), 0);
    // Operational surfaces keep the account, with the flag visible.
    directory = await request(ownerJar, "/api/admin/customers?limit=25");
    assert.equal(directory.data.total, 1);
    assert.equal(directory.data.customers[0].is_test, true);
    assert.equal(directory.data.customers[0].points, awardedBalance);
    const audit = await request(ownerJar, "/api/admin/audit?limit=50");
    assert.equal(audit.status, 200);
    const auditRow = audit.data.events.find((row) => row.action === "customer.test_account.update");
    assert.ok(auditRow, "the marker change is in the business audit trail");
    assert.equal(auditRow.meta?.customer_id, customerId);
    assert.equal(auditRow.meta?.is_test, true);

    // Platform owner: real customers 0, one test account; trial listing counts match.
    const businesses = await request(superJar, "/api/super/businesses?limit=200");
    assert.equal(businesses.status, 200);
    const row = businesses.data.businesses.find((b) => b.id === businessId);
    assert.ok(row);
    assert.equal(row.customers, 0);
    assert.equal(row.test_customers, 1);

    // Manager cannot mark; CSRF is enforced for the owner.
    const manager = await request(superJar, `/api/super/businesses/${businessId}/users`, {
      method: "POST",
      csrf: true,
      body: JSON.stringify({
        name: "Gerente Prueba",
        email: `manager-test-accounts-${rand}@example.com`,
        password,
        role: "MANAGER",
      }),
    });
    assert.equal(manager.status, 201);
    const managerLogin = await request(managerJar, "/api/staff/login", {
      method: "POST",
      body: JSON.stringify({ email: `manager-test-accounts-${rand}@example.com`, password }),
    });
    assert.equal(managerLogin.status, 200);
    const forbidden = await request(managerJar, `/api/admin/customers/${customerId}/test-account`, {
      method: "PATCH",
      csrf: true,
      body: JSON.stringify({ is_test: false }),
    });
    assert.equal(forbidden.status, 403);
    const noCsrf = await request(ownerJar, `/api/admin/customers/${customerId}/test-account`, {
      method: "PATCH",
      body: JSON.stringify({ is_test: false }),
    });
    assert.equal(noCsrf.status, 403);

    // The platform owner unmarks through the super route; the account counts again.
    const superUnmark = await request(
      superJar,
      `/api/super/businesses/${businessId}/customers/${customerId}/test-account`,
      { method: "PATCH", csrf: true, body: JSON.stringify({ is_test: false }) },
    );
    assert.equal(superUnmark.status, 200, JSON.stringify(superUnmark.data));
    assert.equal(superUnmark.data.customer.is_test, false);
    progress = await request(ownerJar, "/api/admin/owner-progress");
    assert.equal(progress.data.launch.steps.find((s) => s.key === "live").done, true);
    assert.ok(progress.data.milestones.find((m) => m.key === "primer_cliente").reached_at);
    assert.equal(progress.data.momentum.weeks, 1);
    assert.equal((await request(ownerJar, "/api/admin/plan")).data.usage.active_customers, 1);
    me = await request(customerJar, "/api/customer/me");
    assert.equal(me.data.customer.is_test, false);
    assert.equal(me.data.customer.points, awardedBalance, "unmarking never alters points either");

    const ownerAudit = await request(ownerJar, "/api/admin/audit?limit=50");
    const platformEntry = ownerAudit.data.events.find(
      (e) => e.action === "platform.customer.test_account.update",
    );
    assert.ok(platformEntry);
    const detail = await request(ownerJar, `/api/admin/audit/${platformEntry.id}`);
    assert.equal(detail.status, 200);
    for (const entry of [platformEntry, detail.data.event]) {
      assert.equal(entry.actor_type, "PLATFORM");
      assert.equal(entry.actor_email, null);
      assert.deepEqual(entry.meta, { customer_id: customerId, is_test: false });
    }
    const restored = await request(ownerJar, "/api/admin/analytics/overview?days=30");
    assert.equal(restored.data.current.purchases, 1);
    assert.equal(restored.data.current.recorded_sales_q, 50);

    // A customer ID that really exists in another business is as private as a missing ID.
    const otherEmail = `other-marker-${rand}@example.com`;
    const other = await request(superJar, "/api/super/businesses", {
      method: "POST",
      csrf: true,
      body: JSON.stringify({ businessName: `Otro ${rand}`, email: otherEmail, password }),
    });
    assert.equal(other.status, 201);
    const otherOwner = new Map();
    assert.equal(
      (
        await request(otherOwner, "/api/staff/login", {
          method: "POST",
          body: JSON.stringify({ email: otherEmail, password }),
        })
      ).status,
      200,
    );
    const mark = { method: "PATCH", csrf: true, body: JSON.stringify({ is_test: true }) };
    for (const [jar, path] of [
      [otherOwner, `/api/admin/customers/${customerId}/test-account`],
      [
        superJar,
        `/api/super/businesses/${other.data.business.id}/customers/${customerId}/test-account`,
      ],
    ]) {
      const foreign = await request(jar, path, mark);
      assert.equal(foreign.status, 404);
      assert.equal(foreign.data.customer, undefined);
    }
    assert.equal((await request(customerJar, "/api/customer/me")).data.customer.is_test, false);
    assert.deepEqual(superUnmark.data.customer, { id: customerId, is_test: false });
    // Unknown customer or business on the super route.
    assert.equal(
      (
        await request(
          superJar,
          `/api/super/businesses/${businessId}/customers/${crypto.randomUUID()}/test-account`,
          { method: "PATCH", csrf: true, body: JSON.stringify({ is_test: true }) },
        )
      ).status,
      404,
    );
  });
});
