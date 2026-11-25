import { describe, it } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { config } from "../../src/config/index.js";

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

integrationDescribe("Self-serve trial integration (signup, soft lock, super actions)", () => {
  const baseUrl = process.env.TEST_API_URL || "http://localhost:3001";
  const browserOrigin = new URL(baseUrl).origin;
  const superEmail = process.env.SUPER_ADMIN_EMAIL;
  const superPassword = process.env.SUPER_ADMIN_PASSWORD;
  const forwardedFor =
    process.env.TEST_CLIENT_IP || `198.51.100.${Math.max(10, Math.floor(Math.random() * 200))}`;
  // The super console acts from another client than the visitor who signs up, so its
  // per-IP login budget is independent of the signup attempts.
  const superForwardedFor = `198.51.101.${Math.max(10, Math.floor(Math.random() * 200))}`;
  /** @type {WeakMap<Map<string, string>, string>} */
  const jarIps = new WeakMap();

  async function request(jar, path, options = {}) {
    const headers = {
      "Content-Type": "application/json",
      "X-Forwarded-For": jarIps.get(jar) ?? forwardedFor,
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

  it("creates a trial from a verified phone, locks it after trial_ends_at keeping reads, and converts by hand", async () => {
    if (!superEmail || !superPassword)
      throw new Error(
        "SUPER_ADMIN_EMAIL/SUPER_ADMIN_PASSWORD are required for this integration test",
      );
    assert.ok(
      process.env.DB_NAME === "puntos_e2e" && process.env.DB_MIGRATIONS_USER,
      "This test runs inside the disposable live stack (admin DB access moves the clock)",
    );
    const admin = new pg.Client({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 5432),
      database: process.env.DB_NAME,
      user: process.env.DB_MIGRATIONS_USER,
      password: process.env.DB_MIGRATIONS_PASSWORD,
    });
    await admin.connect();
    const { closeDatabase } = await import("../../src/app/database.js");
    try {
      const anon = new Map(),
        ownerJar = new Map(),
        superJar = new Map();
      jarIps.set(superJar, superForwardedFor);
      const rand = Math.random().toString(36).slice(2, 9);
      const phone = `+50255${Math.floor(Math.random() * 1000000)
        .toString()
        .padStart(6, "0")}`;
      const email = `trial-${rand}@example.com`;
      const password = "OrchardLanternMarble2026!";

      // Public catalog and trial configuration.
      const plans = await request(anon, "/api/public/plans");
      assert.equal(plans.status, 200);
      assert.equal(plans.data.pricing_status, "published");
      assert.deepEqual(
        plans.data.plans.map((p) => p.pricing.monthly),
        [39, 79, 129],
      );
      const trialConfig = await request(anon, "/api/public/trial/config");
      assert.equal(trialConfig.status, 200);
      assert.equal(trialConfig.data.enabled, true);
      assert.equal(trialConfig.data.plan.id, "EMPRENDEDOR");
      assert.equal(trialConfig.data.trial_days, 14);

      // Phone proof through the dev provider (NODE_ENV=test, MESSAGE_PROVIDER=dev).
      const requested = await request(anon, "/api/public/trial/request-code", {
        method: "POST",
        body: JSON.stringify({ phone, turnstileToken: "dev" }),
      });
      assert.equal(requested.status, 200, JSON.stringify(requested.data));
      assert.match(String(requested.data.dev_code || ""), /^\d{6}$/);
      const wrong = await request(anon, "/api/public/trial/verify", {
        method: "POST",
        body: JSON.stringify({ phone, code: "000000" }),
      });
      assert.equal(wrong.status, 401);
      assert.equal(wrong.data.code, "TRIAL_CODE_INVALID");
      const verified = await request(anon, "/api/public/trial/verify", {
        method: "POST",
        body: JSON.stringify({ phone, code: requested.data.dev_code }),
      });
      assert.equal(verified.status, 200, JSON.stringify(verified.data));
      assert.match(verified.data.grant, /^[A-Za-z0-9_-]{43}$/);

      // Signup creates the Conecta trial and signs the owner in.
      const signup = await request(ownerJar, "/api/public/trial/signup", {
        method: "POST",
        body: JSON.stringify({
          grant: verified.data.grant,
          businessName: `Prueba ${rand}`,
          email,
          password,
          category: "cafe",
          turnstileToken: "dev",
          plan: "NEGOCIO",
        }),
      });
      assert.equal(signup.status, 201, JSON.stringify(signup.data));
      assert.equal(signup.data.business.plan, "EMPRENDEDOR");
      assert.equal(signup.data.business.plan_name, "Conecta");
      assert.equal(signup.data.trial.status, "active");
      assert.equal(signup.data.trial.days_left, 14);
      assert.equal(signup.data.intended_plan, "NEGOCIO");
      assert.equal(signup.data.next_url, "/negocio/");
      assert.match(signup.data.join_url, new RegExp(`/registro/${signup.data.business.slug}$`));
      assert.ok(ownerJar.has(config.STAFF_COOKIE_NAME), "owner session cookie is set");
      const businessId = signup.data.business.id;
      const slug = signup.data.business.slug;

      // The grant is single use.
      const replay = await request(new Map(), "/api/public/trial/signup", {
        method: "POST",
        body: JSON.stringify({
          grant: verified.data.grant,
          businessName: "Otro",
          email: `other-${rand}@example.com`,
          password,
          turnstileToken: "dev",
        }),
      });
      assert.equal(replay.status, 401);
      assert.equal(replay.data.code, "TRIAL_GRANT_INVALID");

      // Stored state matches a super-created business plus the trial columns.
      const row = (
        await admin.query(
          `SELECT plan, signup_source, trial_status, billing_status, trial_phone, trial_started_at, trial_ends_at,
             (SELECT count(*)::int FROM branches WHERE business_id=b.id) AS branches,
             (SELECT count(*)::int FROM staff_users WHERE business_id=b.id AND role='OWNER') AS owners,
             (SELECT count(*)::int FROM rewards WHERE business_id=b.id) AS rewards
           FROM businesses b WHERE id=$1`,
          [businessId],
        )
      ).rows[0];
      assert.equal(row.plan, "EMPRENDEDOR");
      assert.equal(row.signup_source, "self_serve");
      assert.equal(row.trial_status, "active");
      assert.equal(row.billing_status, "trialing");
      assert.equal(row.trial_phone, phone.replace(/\D/g, ""));
      assert.equal(row.branches, 1);
      assert.equal(row.owners, 1);
      assert.equal(row.rewards, 3, "category seeds within the Conecta reward limit");
      assert.equal(
        Math.round(
          (new Date(row.trial_ends_at).getTime() - new Date(row.trial_started_at).getTime()) /
            86_400_000,
        ),
        14,
      );
      const started = (
        await admin.query(
          "SELECT event_type FROM billing_events WHERE business_id=$1 ORDER BY created_at",
          [businessId],
        )
      ).rows.map((r) => r.event_type);
      assert.deepEqual(started, ["trial.started"]);

      // Owner reads: trial state and the additive plan fields.
      let trial = await request(ownerJar, "/api/admin/trial");
      assert.equal(trial.status, 200, JSON.stringify(trial.data));
      assert.equal(trial.data.trial.status, "active");
      assert.equal(trial.data.trial.days_left, 14);
      assert.equal(trial.data.trial.plan_name, "Conecta");
      assert.equal(trial.data.trial.upgrade_url, "/negocio/#plan");
      assert.equal(trial.data.billing.status, "trialing");
      const plan = await request(ownerJar, "/api/admin/plan");
      assert.equal(plan.status, 200);
      assert.equal(plan.data.plan_name, "Conecta");
      assert.equal(plan.data.trial.status, "active");
      assert.equal(plan.data.billing.status, "trialing");

      // Owner writes work during the trial.
      const reward = await request(ownerJar, "/api/admin/rewards", {
        method: "POST",
        csrf: true,
        body: JSON.stringify({ name: `Café ${rand}`, description: "Prueba", points_cost: 5 }),
      });
      assert.equal(reward.status, 200, JSON.stringify(reward.data));

      // Move the clock: the trial ended yesterday.
      await admin.query(
        `UPDATE businesses SET trial_started_at = now() - interval '15 days',
           trial_ends_at = now() - interval '1 day' WHERE id=$1`,
        [businessId],
      );
      trial = await request(ownerJar, "/api/admin/trial");
      assert.equal(trial.status, 200);
      assert.equal(
        trial.data.trial.status,
        "locked",
        "locked from the end instant, before the job",
      );
      assert.equal(trial.data.trial.days_left, 0);
      const refused = await request(ownerJar, "/api/admin/rewards", {
        method: "POST",
        csrf: true,
        body: JSON.stringify({ name: `Bloqueado ${rand}`, description: "x", points_cost: 5 }),
      });
      assert.equal(refused.status, 402);
      assert.equal(refused.data.code, "TRIAL_LOCKED");
      assert.equal(refused.data.upgrade_url, "/negocio/#plan");
      assert.match(refused.data.error, /Tu prueba terminó/);
      const customers = await request(ownerJar, "/api/admin/customers");
      assert.equal(customers.status, 200, "reads keep working while locked");
      const rewardsRead = await request(ownerJar, "/api/admin/rewards");
      assert.equal(rewardsRead.status, 200);
      const publicCard = await request(
        new Map(),
        `/api/public/business/${encodeURIComponent(slug)}`,
      );
      assert.equal(publicCard.status, 200, "customers' cards stay readable");

      // The daily job (worker role) applies the lock row, the retention clock and the facts.
      const { runTrialDailyOnce } =
        await import("../../src/app/services/trial-lifecycle-service.js");
      const summary = await runTrialDailyOnce({ now: new Date() });
      assert.ok(summary.locked >= 1, JSON.stringify(summary));
      assert.equal(summary.purge_mode, "dry_run");
      const lockedRow = (
        await admin.query(
          "SELECT billing_status, trial_status, locked_at, purge_after FROM businesses WHERE id=$1",
          [businessId],
        )
      ).rows[0];
      assert.equal(lockedRow.billing_status, "locked");
      assert.equal(lockedRow.trial_status, "expired");
      assert.ok(lockedRow.locked_at);
      assert.equal(
        Math.round(
          (new Date(lockedRow.purge_after).getTime() - new Date(lockedRow.locked_at).getTime()) /
            86_400_000,
        ),
        30,
      );
      const events = (
        await admin.query(
          "SELECT event_type FROM billing_events WHERE business_id=$1 ORDER BY created_at",
          [businessId],
        )
      ).rows.map((r) => r.event_type);
      assert.ok(events.includes("trial.locked"), events.join(","));
      // No SMTP in the isolated stack: nothing is marked as sent, so a configured relay
      // would deliver the lock notice on the next run.
      const markers = await admin.query(
        "SELECT kind FROM trial_notifications WHERE business_id=$1",
        [businessId],
      );
      assert.equal(markers.rowCount, 0);
      const again = await runTrialDailyOnce({ now: new Date() });
      assert.equal(again.locked, 0, "the lock transition is idempotent");

      // Super console: listing, dry-run report, extend, manual activation.
      const login = await request(superJar, "/api/super/login", {
        method: "POST",
        body: JSON.stringify({ email: superEmail, password: superPassword }),
      });
      assert.equal(login.status, 200);
      const listing = await request(superJar, "/api/super/trials?status=locked");
      assert.equal(listing.status, 200);
      const entry = listing.data.trials.find((t) => t.id === businessId);
      assert.ok(entry, "locked trial is listed");
      assert.equal(entry.status, "locked");
      assert.equal(entry.phone_verified, true);
      assert.equal(entry.signup_source, "self_serve");
      assert.equal(entry.purge_candidate, false);
      assert.equal(typeof entry.activation.activated, "boolean");
      const superList = await request(superJar, "/api/super/businesses?limit=200");
      assert.equal(superList.status, 200);
      const listed = superList.data.businesses.find((b) => b.id === businessId);
      assert.equal(listed.billing_status, "locked");
      assert.equal(listed.trial_status, "expired");
      const purge = await request(superJar, "/api/super/trials/purge-candidates");
      assert.equal(purge.status, 200);
      assert.equal(purge.data.mode, "dry_run");
      assert.ok(!purge.data.candidates.some((c) => c.business_id === businessId));
      const cohorts = await request(superJar, "/api/super/trials/summary");
      assert.equal(cohorts.status, 200);
      assert.ok(Array.isArray(cohorts.data.cohorts));

      const extended = await request(superJar, `/api/super/businesses/${businessId}/trial/extend`, {
        method: "POST",
        csrf: true,
        body: JSON.stringify({ days: 7, note: "Soporte" }),
      });
      assert.equal(extended.status, 200, JSON.stringify(extended.data));
      assert.equal(extended.data.trial.status, "active");
      assert.equal(extended.data.trial.days_left, 7);
      trial = await request(ownerJar, "/api/admin/trial");
      assert.equal(trial.data.trial.status, "active");
      const writable = await request(ownerJar, "/api/admin/rewards", {
        method: "POST",
        csrf: true,
        body: JSON.stringify({ name: `Extendido ${rand}`, description: "x", points_cost: 5 }),
      });
      assert.equal(writable.status, 200, "writes return after the extension");
      const badExtend = await request(
        superJar,
        `/api/super/businesses/${businessId}/trial/extend`,
        {
          method: "POST",
          csrf: true,
          body: JSON.stringify({ days: 0 }),
        },
      );
      assert.equal(badExtend.status, 400);

      const activated = await request(
        superJar,
        `/api/super/businesses/${businessId}/billing/manual-activate`,
        {
          method: "POST",
          csrf: true,
          body: JSON.stringify({ plan: "NEGOCIO", currency: "USD", note: "Transferencia" }),
        },
      );
      assert.equal(activated.status, 200, JSON.stringify(activated.data));
      assert.equal(activated.data.business.plan, "NEGOCIO");
      assert.equal(activated.data.business.billing_status, "active");
      assert.equal(activated.data.business.trial_status, "converted");
      assert.equal(activated.data.subscription.provider, "manual");
      assert.equal(activated.data.subscription.unit_amount_minor, 7900);
      assert.equal(activated.data.subscription.metadata.activated_by, superEmail);
      trial = await request(ownerJar, "/api/admin/trial");
      assert.equal(trial.data.trial.status, "converted");
      assert.equal(trial.data.trial.plan_name, "Impulsa");
      assert.equal(trial.data.billing.provider, "manual");
      assert.equal(trial.data.billing.subscription.plan, "NEGOCIO");
      const audit = await admin.query(
        "SELECT action FROM audit_logs WHERE business_id=$1 AND actor_type='SUPER_ADMIN' ORDER BY created_at",
        [businessId],
      );
      assert.deepEqual(
        audit.rows.map((r) => r.action),
        ["super.trial.extend", "super.billing.manual_activate"],
      );
      const converted = (
        await admin.query(
          "SELECT event_type FROM billing_events WHERE business_id=$1 ORDER BY created_at",
          [businessId],
        )
      ).rows.map((r) => r.event_type);
      assert.ok(converted.includes("trial.extended"));
      assert.ok(converted.includes("trial.converted"));
      assert.ok(converted.includes("subscription.activated"));

      // Legacy business created from the super console is never restricted.
      const legacy = await request(superJar, "/api/super/businesses", {
        method: "POST",
        csrf: true,
        body: JSON.stringify({
          businessName: `Interno ${rand}`,
          email: `interno-${rand}@example.com`,
          password,
          category: "cafe",
          plan: "EMPRENDEDOR",
        }),
      });
      assert.equal(legacy.status, 201);
      const legacyRow = (
        await admin.query(
          "SELECT signup_source, trial_status, billing_status FROM businesses WHERE id=$1",
          [legacy.data.business.id],
        )
      ).rows[0];
      assert.deepEqual(legacyRow, {
        signup_source: "internal",
        trial_status: "none",
        billing_status: "none",
      });
    } finally {
      await admin.end().catch(() => {});
      await closeDatabase().catch(() => {});
    }
  });
});
