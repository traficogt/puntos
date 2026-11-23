import crypto from "node:crypto";
import { describe, it } from "node:test";
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

integrationDescribe("Owner progress (Tu progreso) integration", () => {
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

  it("derives the launch path, milestones and momentum from real records and persists owner choices", async () => {
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

    // Platform default: mode full, no holdout.
    const settings = await request(superJar, "/api/super/platform-settings/owner-progress");
    assert.equal(settings.status, 200);
    assert.deepEqual(settings.data?.settings, { mode: "full", holdout_pct: 0 });
    const badSettings = await request(superJar, "/api/super/platform-settings/owner-progress", {
      method: "PUT",
      csrf: true,
      body: JSON.stringify({ mode: "full", holdout_pct: 101 }),
    });
    assert.equal(badSettings.status, 400);

    const rand = Math.random().toString(36).slice(2, 9);
    const password = "OrchardLanternMarble2026!";
    const created = await request(superJar, "/api/super/businesses", {
      method: "POST",
      csrf: true,
      body: JSON.stringify({
        businessName: `Progreso ${rand}`,
        email: `owner-progress-${rand}@example.com`,
        password,
        category: "cafe",
        plan: "EMPRENDEDOR",
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

    // Every plan: EMPRENDEDOR owner reads the payload.
    let progress = await request(ownerJar, "/api/admin/owner-progress");
    assert.equal(progress.status, 200);
    assert.equal(progress.data.mode, "full");
    assert.equal(progress.data.variant, "treatment");
    assert.equal(progress.data.experience, "full");
    assert.equal(progress.data.hidden, false);
    assert.deepEqual(
      progress.data.launch.steps.map((s) => s.key),
      ["rules", "card", "practice", "team", "live"],
    );
    assert.equal(progress.data.launch.steps[4].done, false, "no genuine award yet");
    assert.deepEqual(progress.data.momentum, {
      weeks: 0,
      current_week_active: false,
      freezes_available: 1,
    });
    assert.equal(progress.data.goal?.key, "launch");
    assert.deepEqual(progress.data.new_milestones, []);
    assert.equal(progress.data.milestones.length, 14);

    const reward = await request(ownerJar, "/api/admin/rewards", {
      method: "POST",
      csrf: true,
      body: JSON.stringify({ name: `Café ${rand}`, description: "Progreso", points_cost: 5 }),
    });
    assert.equal(reward.status, 200);
    progress = await request(ownerJar, "/api/admin/owner-progress");
    assert.equal(progress.data.launch.steps[0].done, true, "rules: configured program + reward");
    assert.equal(progress.data.launch.steps[1].done, false, "no enrollment link or branded QR yet");
    assert.equal(progress.data.launch.steps[2].done, false, "no completed practice yet");

    // A real customer and a genuine award flip `live`, grant primer_cliente and start momentum.
    const phone = `+50255${Math.floor(Math.random() * 1000000)
      .toString()
      .padStart(6, "0")}`;
    const joinPath = `/api/public/business/${encodeURIComponent(businessSlug)}/join`;
    const requested = await request(customerJar, `${joinPath}/request-code`, {
      method: "POST",
      body: JSON.stringify({ phone, name: "Cliente Progreso" }),
    });
    assert.equal(requested.status, 200);
    const code = resolveJoinCode({ requestCodeData: requested.data, businessSlug, phone });
    const verified = await request(customerJar, `${joinPath}/verify`, {
      method: "POST",
      body: JSON.stringify({ phone, code, name: "Cliente Progreso" }),
    });
    assert.equal(verified.status, 200);
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
    assert.equal(award.status, 200);

    progress = await request(ownerJar, "/api/admin/owner-progress");
    assert.equal(progress.status, 200);
    const live = progress.data.launch.steps.find((s) => s.key === "live");
    assert.equal(live.done, true);
    assert.ok(live.done_at);
    assert.equal(progress.data.momentum.weeks, 1);
    assert.equal(progress.data.momentum.current_week_active, true);
    const primerCliente = progress.data.milestones.find((m) => m.key === "primer_cliente");
    assert.ok(primerCliente.reached_at);
    assert.equal(primerCliente.acknowledged_at, null);
    assert.ok(progress.data.new_milestones.includes("primer_cliente"));
    assert.equal(progress.data.milestones.find((m) => m.key === "pionero").reached_at, null);

    // Acknowledge twice: idempotent, and the key leaves new_milestones.
    const ack1 = await request(ownerJar, "/api/admin/owner-progress/acknowledge", {
      method: "POST",
      csrf: true,
      body: JSON.stringify({ keys: ["primer_cliente", "clientes_50"] }),
    });
    const ack2 = await request(ownerJar, "/api/admin/owner-progress/acknowledge", {
      method: "POST",
      csrf: true,
      body: JSON.stringify({ keys: ["primer_cliente", "clientes_50"] }),
    });
    assert.equal(ack1.status, 200);
    assert.equal(ack2.status, 200);
    assert.deepEqual(ack1.data.acknowledged, ["primer_cliente"], "unreached keys are ignored");
    assert.deepEqual(ack2.data.acknowledged, ["primer_cliente"]);
    assert.equal(ack2.data.progress.new_milestones.includes("primer_cliente"), false);
    assert.equal(
      ack1.data.progress.milestones.find((m) => m.key === "primer_cliente").acknowledged_at,
      ack2.data.progress.milestones.find((m) => m.key === "primer_cliente").acknowledged_at,
      "first acknowledgement time is kept",
    );

    // Goal: dismiss the suggestion, then pick one explicitly.
    assert.equal(ack2.data.progress.goal.key, "launch");
    const dismissed = await request(ownerJar, "/api/admin/owner-progress/goal", {
      method: "POST",
      csrf: true,
      body: JSON.stringify({ dismiss: "launch" }),
    });
    assert.equal(dismissed.status, 200);
    assert.equal(dismissed.data.progress.goal.key, "redemption_comfort");
    const chosen = await request(ownerJar, "/api/admin/owner-progress/goal", {
      method: "POST",
      csrf: true,
      body: JSON.stringify({ key: "returning_5" }),
    });
    assert.equal(chosen.status, 200);
    assert.equal(chosen.data.progress.goal.key, "returning_5");
    assert.deepEqual(chosen.data.progress.goal.progress, { current: 0, target: 5 });

    // Review: timestamped decision grants primera_revision.
    const review = await request(ownerJar, "/api/admin/owner-progress/review", {
      method: "POST",
      csrf: true,
      body: JSON.stringify({ decision: "keep", note: "La recompensa se entiende." }),
    });
    assert.equal(review.status, 200);
    assert.equal(review.data.progress.review.decision, "keep");
    assert.ok(review.data.progress.milestones.find((m) => m.key === "primera_revision").reached_at);
    assert.ok(review.data.progress.new_milestones.includes("primera_revision"));

    // Visibility persists across reads.
    const hidden = await request(ownerJar, "/api/admin/owner-progress/visibility", {
      method: "POST",
      csrf: true,
      body: JSON.stringify({ hidden: true }),
    });
    assert.equal(hidden.status, 200);
    assert.equal(hidden.data.progress.hidden, true);
    progress = await request(ownerJar, "/api/admin/owner-progress");
    assert.equal(progress.data.hidden, true);
    assert.equal(progress.data.goal.key, "returning_5", "owner choices persist");

    // Owner role only: a manager of the same business gets 403.
    const manager = await request(superJar, `/api/super/businesses/${businessId}/users`, {
      method: "POST",
      csrf: true,
      body: JSON.stringify({
        name: "Gerente Progreso",
        email: `manager-progress-${rand}@example.com`,
        password,
        role: "MANAGER",
      }),
    });
    assert.equal(manager.status, 201);
    const managerLogin = await request(managerJar, "/api/staff/login", {
      method: "POST",
      body: JSON.stringify({ email: `manager-progress-${rand}@example.com`, password }),
    });
    assert.equal(managerLogin.status, 200);
    assert.equal((await request(managerJar, "/api/admin/owner-progress")).status, 403);
    assert.equal((await request(new Map(), "/api/admin/owner-progress")).status, 401);
  });
});
