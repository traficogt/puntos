import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { config } from "../../src/config/index.js";
import { closeDatabase } from "../../src/app/database.js";
import {
  processCustomerImportChunk,
  runCustomerImportJob,
} from "../../src/app/services/customer-import-job-service.js";

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

function cookieHeader(jar) {
  return Array.from(jar.entries())
    .map(([key, value]) => `${key}=${value}`)
    .join("; ");
}

function csrfTokenFromJar(jar) {
  return jar.get("pf_csrf_readable") || "";
}

integrationDescribe("Plan enforcement regression", () => {
  const baseUrl = process.env.TEST_API_URL || "http://localhost:3001";
  const browserOrigin = new URL(baseUrl).origin;
  const forwardedFor =
    process.env.TEST_CLIENT_IP ||
    `198.19.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`;
  const superEmail = process.env.SUPER_ADMIN_EMAIL;
  const superPassword = process.env.SUPER_ADMIN_PASSWORD;

  async function request(jar, path, options = {}) {
    const headers = {
      "Content-Type": "application/json",
      "X-Forwarded-For": forwardedFor,
      ...(options.headers || {}),
    };
    const cookie = cookieHeader(jar);
    if (cookie) headers.Cookie = cookie;
    if (options.csrf) {
      headers["X-CSRF-Token"] = csrfTokenFromJar(jar);
      headers.Origin ??= browserOrigin;
      headers.Referer ??= `${browserOrigin}/`;
    }

    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers,
    });
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

  it("returns PLAN_FEATURE_LOCKED for disabled premium endpoints", async () => {
    if (!superEmail || !superPassword) {
      throw new Error(
        "SUPER_ADMIN_EMAIL/SUPER_ADMIN_PASSWORD are required for this integration test",
      );
    }

    const superJar = new Map();

    const login = await request(superJar, "/api/super/login", {
      method: "POST",
      body: JSON.stringify({ email: superEmail, password: superPassword }),
    });
    assert.equal(login.status, 200);
    assert.ok(superJar.get(config.SUPER_COOKIE_NAME), "expected super auth cookie");

    const rand = Math.random().toString(36).slice(2, 9);
    const ownerEmail = `owner-lock-${rand}@example.com`;
    const password = "OrchardLanternMarble2026!";
    const createdBusiness = await request(superJar, "/api/super/businesses", {
      method: "POST",
      csrf: true,
      body: JSON.stringify({
        businessName: `Cafe Lock ${rand}`,
        email: ownerEmail,
        password,
        category: "cafe",
        plan: "EMPRENDEDOR",
      }),
    });
    assert.equal(createdBusiness.status, 201);
    const businessId = createdBusiness.data?.business?.id;
    assert.ok(businessId, "expected business id");

    const impersonate = await request(
      superJar,
      `/api/super/impersonate/${encodeURIComponent(businessId)}`,
      {
        method: "POST",
        csrf: true,
        body: "{}",
      },
    );
    assert.equal(impersonate.status, 200);
    assert.ok(superJar.get(config.STAFF_COOKIE_NAME), "expected owner staff cookie");

    const planInfo = await request(superJar, "/api/admin/plan");
    assert.equal(planInfo.status, 200);
    const features = planInfo.data?.features || {};

    const checks = [
      { feature: "analytics", method: "GET", path: "/api/admin/analytics/rfm?days=30" },
      { feature: "campaign_rules", method: "GET", path: "/api/admin/campaign-rules" },
      { feature: "external_awards", method: "GET", path: "/api/admin/external-awards" },
      { feature: "lifecycle_automation", method: "GET", path: "/api/admin/automations" },
      { feature: "fraud_monitoring", method: "GET", path: "/api/admin/awards/suspicious" },
    ];

    const lockedChecks = checks.filter((c) => features[c.feature] === false);
    if (!lockedChecks.length) {
      // Environment may override all features to true; do not fail in that case.
      return;
    }

    for (const c of lockedChecks) {
      const out = await request(superJar, c.path, { method: c.method });
      assert.equal(out.status, 403, `expected 403 for ${c.feature}`);
      assert.equal(
        out.data?.code,
        "PLAN_FEATURE_LOCKED",
        `expected PLAN_FEATURE_LOCKED code for ${c.feature}`,
      );
    }
  });

  // Scale limits (src/app/services/scale-limits.js): an import above the former 100-row
  // bound succeeds end to end, both synchronously (one 200-row chunk per request) and as
  // a background job processed in 200-row chunks; campaign audiences follow the plan.
  after(async () => closeDatabase().catch(() => {}));
  it("imports above 100 rows end to end and bounds campaign audiences by plan", async () => {
    if (!superEmail || !superPassword) {
      throw new Error(
        "SUPER_ADMIN_EMAIL/SUPER_ADMIN_PASSWORD are required for this integration test",
      );
    }
    const superJar = new Map();
    const login = await request(superJar, "/api/super/login", {
      method: "POST",
      body: JSON.stringify({ email: superEmail, password: superPassword }),
    });
    assert.equal(login.status, 200);
    const rand = Math.random().toString(36).slice(2, 9);
    const created = await request(superJar, "/api/super/businesses", {
      method: "POST",
      csrf: true,
      body: JSON.stringify({
        businessName: `Escala ${rand}`,
        email: `owner-scale-${rand}@example.com`,
        password: "OrchardLanternMarble2026!",
        category: "cafe",
        plan: "NEGOCIO",
        program_type: "SPEND",
        program_json: { points_per_q: 1, round: "ceil" },
      }),
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const businessId = created.data?.business?.id;
    assert.ok(businessId);
    const impersonate = await request(superJar, `/api/super/impersonate/${businessId}`, {
      method: "POST",
      csrf: true,
      body: "{}",
    });
    assert.equal(impersonate.status, 200);

    const columns = { phone: "phone", name: "name", points: "points" };
    const csvRows = (start, count) =>
      "phone,name,points\n" +
      Array.from({ length: count }, (_, i) => `+502${start + i},Cliente ${start + i},2`).join("\n");

    // 1) Synchronous commit: 150 rows (the former bound was 100) in one request.
    const syncStart = Date.now();
    const sync = await request(superJar, "/api/admin/customer-migrations/commit", {
      method: "POST",
      csrf: true,
      body: JSON.stringify({
        request_id: randomUUID(),
        label: "Saldo anterior",
        csv: csvRows(55600000, 150),
        columns,
        existing_policy: "skip",
        confirmed: true,
      }),
    });
    assert.equal(sync.status, 201, JSON.stringify(sync.data));
    assert.equal(sync.data.batch.imported_count, 150);
    assert.equal(sync.data.batch.skipped_count, 0);
    console.log(`[measure] synchronous import of 150 rows: ${Date.now() - syncStart} ms`);
    // One request commits at most one chunk (200 rows); the bound is explained in Spanish.
    const tooMany = await request(superJar, "/api/admin/customer-migrations/commit", {
      method: "POST",
      csrf: true,
      body: JSON.stringify({
        request_id: randomUUID(),
        label: "Demasiado",
        csv: csvRows(55800000, 201),
        columns,
        existing_policy: "skip",
        confirmed: true,
      }),
    });
    assert.equal(tooMany.status, 400);
    assert.match(String(tooMany.data?.error), /200 filas/);

    // 2) Background job: 250 rows are accepted (202) and processed in 200-row chunks.
    const queued = await request(superJar, "/api/admin/customer-import-jobs", {
      method: "POST",
      csrf: true,
      body: JSON.stringify({
        request_id: randomUUID(),
        label: "Lote grande",
        csv: csvRows(55700000, 250),
        columns,
        existing_policy: "skip",
        confirmed: true,
      }),
    });
    assert.equal(queued.status, 202, JSON.stringify(queued.data));
    assert.equal(queued.data.job.status, "queued");
    assert.equal(queued.data.job.total, 250);
    assert.equal(queued.data.job.rows_json, undefined, "contact rows never leave the server");
    const importJobId = queued.data.job.id;

    // The live stack runs the API without workers (IN_PROCESS_WORKERS=false), so run the
    // job handler here against the same database, exactly as the worker process does.
    const admin = new pg.Client({
      host: process.env.TEST_DB_HOST || process.env.DB_HOST || "localhost",
      port: Number(process.env.TEST_DB_PORT || process.env.DB_PORT || 5432),
      database: process.env.TEST_DB_NAME || process.env.DB_NAME || "puntos",
      user: process.env.TEST_DB_USER || process.env.DB_MIGRATIONS_USER || "postgres",
      password: process.env.TEST_DB_PASSWORD || process.env.DB_MIGRATIONS_PASSWORD || "",
    });
    await admin.connect();
    try {
      const scoped = async (fn) => {
        await admin.query("BEGIN");
        try {
          await admin.query("SELECT set_config('app.current_tenant',$1,true)", [businessId]);
          const value = await fn(admin);
          await admin.query("COMMIT");
          return value;
        } catch (error) {
          await admin.query("ROLLBACK");
          throw error;
        }
      };
      const deps = {
        transaction: scoped,
        query: (sql, values) => scoped((client) => client.query(sql, values)),
        context: (_context, fn) => fn(),
      };
      const payload = { businessId, importJobId };
      const jobStart = Date.now();
      const first = await processCustomerImportChunk(payload, deps);
      assert.equal(first.terminal, false);
      assert.equal(first.job.processed, 200, "first chunk is 200 rows");
      assert.equal(first.job.status, "running");
      assert.equal(first.job.batch_ids.length, 1);
      // A restarted worker resumes from the persisted cursor and finishes the file.
      const finished = await runCustomerImportJob(payload, deps);
      console.log(`[measure] 250-row import job in 200-row chunks: ${Date.now() - jobStart} ms`);
      assert.deepEqual(
        { status: finished.status, processed: finished.processed, total: finished.total },
        { status: "completed", processed: 250, total: 250 },
      );
      // Replaying a completed job changes nothing.
      const replay = await runCustomerImportJob(payload, deps);
      assert.equal(replay.status, "completed");
      assert.equal(replay.processed, 250);
    } finally {
      await admin.end().catch(() => {});
    }

    // 3) The owner sees one completed job (two 200-row lotes) and three saved batches.
    const jobs = await request(superJar, "/api/admin/customer-import-jobs");
    assert.equal(jobs.status, 200);
    const job = jobs.data.jobs.find((row) => row.id === importJobId);
    assert.ok(job);
    assert.equal(job.status, "completed");
    assert.equal(job.processed, 250);
    assert.equal(job.imported, 250);
    assert.equal(job.skipped, 0);
    assert.equal(job.batch_ids.length, 2);
    assert.equal(Number(job.opening_points), 500);
    const batches = await request(superJar, "/api/admin/customer-migrations");
    assert.equal(batches.status, 200);
    const labels = batches.data.batches.map((batch) => batch.label).sort();
    assert.deepEqual(labels, ["Lote grande · 1", "Lote grande · 2", "Saldo anterior"]);
    assert.equal(
      batches.data.batches.reduce((sum, batch) => sum + batch.imported_count, 0),
      400,
      "150 synchronous + 250 background rows, no duplicates",
    );

    // 4) Campaign audiences: Impulsa (NEGOCIO) allows 2,000 customers per campaign; above
    // that the owner gets a Spanish explanation, and audiences above 200 are prepared by
    // the job queue (202) instead of inside the request.
    const planInfo = await request(superJar, "/api/admin/plan");
    assert.equal(planInfo.status, 200);
    const features = planInfo.data?.features || {};
    if (features.campaign_rules === false || features.analytics === false) return;
    const audience = await request(superJar, "/api/admin/audiences", {
      method: "POST",
      csrf: true,
      body: JSON.stringify({
        request_id: randomUUID(),
        name: "Todos los clientes",
        definition: {
          window_days: 90,
          include: { match: "all", rules: [{ field: "joined_days", operator: "gte", value: 0 }] },
          exclude: { match: "any", rules: [] },
        },
      }),
    });
    assert.equal(audience.status, 201, JSON.stringify(audience.data));
    const segment = audience.data.segment;
    const campaign = (patch) => ({
      request_id: randomUUID(),
      name: "Vuelve pronto",
      audience_segment_id: segment.id,
      audience_segment_version: segment.version,
      bonus_points: 50,
      minimum_purchase_q: 20,
      duration_days: 14,
      holdout_percent: 20,
      ...patch,
    });
    const post = (path, body) =>
      request(superJar, `/api/admin/growth-campaigns${path}`, {
        method: "POST",
        csrf: true,
        body: JSON.stringify(body),
      });
    const overPlan = await post("/prepare", campaign({ audience_limit: 2500 }));
    assert.equal(overPlan.status, 400, JSON.stringify(overPlan.data));
    assert.equal(overPlan.data.code, "PLAN_AUDIENCE_LIMIT");
    assert.match(String(overPlan.data.error), /plan Impulsa permite hasta 2,000 clientes/);
    const overPlanSync = await post("", campaign({ audience_limit: 2500 }));
    assert.equal(overPlanSync.status, 400);
    assert.equal(overPlanSync.data.code, "PLAN_AUDIENCE_LIMIT");
    const delegated = await post("", campaign({ audience_limit: 2000 }));
    assert.equal(delegated.status, 202, JSON.stringify(delegated.data));
    assert.equal(delegated.data.campaign.preparation_status, "queued");
    assert.equal(delegated.data.campaign.audience_snapshot.limit, 2000);
    const quiet = await post("/quiet", {
      request_id: randomUUID(),
      name: "Tarde tranquila",
      audience_segment_id: segment.id,
      audience_segment_version: segment.version,
      audience_limit: 250,
      bonus_points: 20,
      points_budget: 5000,
      duration_minutes: 60,
    });
    assert.equal(quiet.status, 202, JSON.stringify(quiet.data));
    assert.equal(quiet.data.campaign.offer_kind, "quiet");
    assert.equal(quiet.data.campaign.preparation_status, "queued");
    const syncStartCampaign = Date.now();
    const immediate = await post("", campaign({ audience_limit: 150 }));
    assert.equal(immediate.status, 201, JSON.stringify(immediate.data));
    console.log(
      `[measure] synchronous campaign of 150 members: ${Date.now() - syncStartCampaign} ms`,
    );
    assert.equal(immediate.data.campaign.preparation_status, "ready");
    assert.equal(immediate.data.campaign.member_count, 150);
  });
});
