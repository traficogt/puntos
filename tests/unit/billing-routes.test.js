import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import cookieParser from "cookie-parser";
import { errorHandler } from "../../src/middleware/common.js";
import { mountRawBody } from "../../src/middleware/raw-body.js";
import { createSubscriptionService } from "../../src/app/services/billing/subscription-service.js";
import { createManualProvider } from "../../src/app/services/billing/manual-provider.js";
import { createAdminBillingSubscriptionRoutes } from "../../src/app/routes/admin/billing-subscription-routes.js";
import { createPublicBillingWebhookRoutes } from "../../src/app/routes/public-billing-webhook-routes.js";
import { createSuperBillingRoutes } from "../../src/app/routes/super-billing-routes.js";
import { AuditRepo } from "../../src/app/repositories/audit-repository.js";
import { SecurityEventRepo } from "../../src/app/repositories/security-event-repository.js";
import {
  createFakeProvider,
  createMemoryBillingRepo,
  FIXTURE_BUSINESS_ID as BIZ,
  FIXTURE_CHECKOUT_ID as CHK,
  gtqFixtureCatalog as fixtureCatalog,
  loadGtqFixture as loadFixture,
} from "../fixtures/billing/memory-billing-repo.mjs";

import { stripeCatalog, stripeFixture } from "../fixtures/billing/stripe.mjs";

const now = new Date("2026-12-01T14:10:00.000Z");

function build({ configured, stripe = false }) {
  /** @type {Map<string, any>} */
  const businesses = new Map([
    [
      BIZ,
      {
        id: BIZ,
        name: "Café Uno",
        slug: "cafe-uno",
        email: "owner@example.com",
        phone: null,
        plan: "EMPRENDEDOR",
        program_json: {},
        trial_status: "active",
        billing_status: "trialing",
        billing_currency: null,
        trial_started_at: new Date("2026-11-25T15:00:00Z"),
        trial_ends_at: new Date("2026-12-09T15:00:00Z"),
        locked_at: null,
        purge_after: null,
      },
    ],
  ]);
  const catalog = stripe ? stripeCatalog() : fixtureCatalog();
  const processor = stripe ? stripeFixture({ catalog, now: () => now }) : null;
  const repo = createMemoryBillingRepo({ businesses });
  const provider = configured
    ? createFakeProvider({ currency: "GTQ", catalog: fixtureCatalog(), now: () => now })
    : null;
  const ids = [CHK];
  const service = createSubscriptionService({
    repo,
    getBusiness: async (id) => businesses.get(id) ?? null,
    countBranches: async () => 1,
    getCatalog: async () => catalog,
    saveCatalogPrices: async (_name, c) => c,
    provider,
    stripeProvider: processor?.provider ?? null,
    manualProvider: createManualProvider({
      getSubscription: (id) => repo.getSubscriptionByProviderId("manual", id),
    }),
    platform: async (fn) => fn(),
    tenant: async (_id, fn) => fn(),
    transaction: async (fn) => fn(),
    emitBillingEvent: async () => {},
    countEvent: () => {},
    countTransition: () => {},
    config: {
      APP_ORIGIN: "https://app.test",
      BILLING_RETURN_ORIGIN: "https://app.test",
      BILLING_PROVIDER: "recurrente",
      TRIAL_RETENTION_DAYS: 30,
    },
    now: () => now,
    uuid: () => ids.shift() ?? crypto.randomUUID(),
    log: { warn() {}, info() {} },
  });
  const securityEvents = [];
  const app = express();
  mountRawBody(app);
  app.use(express.json({ limit: "200kb" }));
  app.use(cookieParser());
  const staffAuth = (req, res, next) => {
    const role = req.get("x-role");
    if (!role) return res.status(401).json({ error: "Sign in" });
    req.staff = { id: "owner-1", business_id: BIZ, role };
    return next();
  };
  const superAuth = (req, res, next) => {
    if (!req.get("x-super")) return res.status(401).json({ error: "Sign in" });
    req.superAdmin = { email: "super@example.com" };
    return next();
  };
  app.use("/api", createAdminBillingSubscriptionRoutes({ service: () => service, staffAuth }));
  const webhookRouter = createPublicBillingWebhookRoutes({
    service: () => service,
    rateLimit: (_req, _res, next) => next(),
    logSecurityEvent: async (entry) => {
      securityEvents.push(entry);
    },
  });
  app.use("/api", webhookRouter);
  app.use("/api/v1", webhookRouter);
  app.use(
    "/api",
    createSuperBillingRoutes({
      service: () => service,
      repo,
      superAuth,
      getBusiness: async (id) => businesses.get(id) ?? null,
      platform: async (fn) => fn(),
    }),
  );
  app.use(errorHandler);
  return { app, service, repo, provider, processor, businesses, securityEvents };
}

async function listen(app) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  /**
   * @param {string} path
   * @param {{ method?: string, body?: unknown, role?: string, superAdmin?: boolean, headers?: Record<string, string>, raw?: string }} [options]
   */
  const call = async (
    path,
    { method = "GET", body, role = "OWNER", superAdmin = false, headers = {}, raw } = {},
  ) => {
    const response = await fetch(`${origin}${path}`, {
      method,
      headers: {
        ...(role ? { "x-role": role } : {}),
        ...(superAdmin ? { "x-super": "1" } : {}),
        ...(method !== "GET"
          ? {
              "content-type": "application/json",
              origin,
              cookie: "pf_csrf=fixture-csrf-token",
              "x-csrf-token": "fixture-csrf-token",
            }
          : {}),
        ...headers,
      },
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { status: response.status, data, headers: response.headers };
  };
  return { server, origin, call };
}

test("owner routes without a configured provider: overview says no upgrade, mutations answer 503/404", async (t) => {
  t.mock.method(AuditRepo, "log", async () => {});
  t.mock.method(SecurityEventRepo, "log", async () => {});
  const { app } = build({ configured: false });
  const { server, origin, call } = await listen(app);
  try {
    const overview = await call("/api/admin/billing");
    assert.equal(overview.status, 200);
    assert.equal(overview.headers.get("cache-control"), "private, no-store");
    assert.equal(overview.data.ok, true);
    assert.equal(overview.data.billing.status, "trialing");
    assert.equal(overview.data.billing.upgrade_available, false);
    assert.equal(overview.data.billing.checkout_pending, null);
    assert.equal(overview.data.billing.subscription, null);
    assert.equal(overview.data.billing.plan_name, "Conecta");
    assert.deepEqual(Object.keys(overview.data.catalog), [
      "currency",
      "currencies",
      "iva_included",
      "plans",
    ]);
    assert.equal(overview.data.catalog.iva_included, true);
    assert.equal(overview.data.catalog.plans.length, 3);
    assert.equal(overview.data.branches, 1);
    assert.equal(overview.data.trial.status, "active");
    assert.equal(overview.data.trial.days_left, 8);

    const checkout = await call("/api/admin/billing/checkout", {
      method: "POST",
      body: { plan: "NEGOCIO" },
    });
    assert.equal(checkout.status, 503);
    assert.equal(checkout.data.code, "BILLING_UNAVAILABLE");
    const invalid = await call("/api/admin/billing/checkout", {
      method: "POST",
      body: { plan: "ORO" },
    });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.data.code, "BILLING_PLAN_INVALID");
    const change = await call("/api/admin/billing/change", {
      method: "POST",
      body: { plan: "NEGOCIO" },
    });
    assert.equal(change.status, 404);
    assert.equal(change.data.code, "BILLING_NO_SUBSCRIPTION");
    const cancelNow = await call("/api/admin/billing/cancel", {
      method: "POST",
      body: { at_period_end: false },
    });
    assert.equal(cancelNow.status, 400, "immediate cancel is a super action");
    const cancel = await call("/api/admin/billing/cancel", {
      method: "POST",
      body: { at_period_end: true },
    });
    assert.equal(cancel.status, 404);
    const invoices = await call("/api/admin/billing/invoices");
    assert.deepEqual(invoices.data, { ok: true, invoices: [] });
    const missing = await call("/api/admin/billing/checkout/not-a-uuid");
    assert.equal(missing.status, 404);
    assert.equal(missing.data.code, "BILLING_CHECKOUT_NOT_FOUND");

    assert.equal((await call("/api/admin/billing", { role: "CASHIER" })).status, 403);
    assert.equal((await call("/api/admin/billing", { role: "" })).status, 401);
    const noCsrf = await fetch(`${origin}/api/admin/billing/checkout`, {
      method: "POST",
      headers: { "x-role": "OWNER", "content-type": "application/json" },
      body: JSON.stringify({ plan: "NEGOCIO" }),
    });
    assert.equal(noCsrf.status, 403, "csrfProtect guards the mutation");
    // A webhook for an unconfigured provider answers 503 and never crashes.
    const hook = await call("/api/public/billing/webhooks/recurrente", {
      method: "POST",
      role: "",
      raw: JSON.stringify(loadFixture("intent-succeeded-first.json")),
      headers: { "svix-id": "msg_1" },
    });
    assert.equal(hook.status, 503);
    assert.equal(hook.data.code, "BILLING_UNAVAILABLE");
    const sync = await call("/api/super/billing/catalog/sync", {
      method: "POST",
      role: "",
      superAdmin: true,
      body: {},
    });
    assert.equal(sync.status, 503);
  } finally {
    server.close();
  }
});

test("owner routes with a provider: checkout 201 then 200 reused, status polling, change and cancel shapes", async (t) => {
  t.mock.method(AuditRepo, "log", async () => {});
  t.mock.method(SecurityEventRepo, "log", async () => {});
  const { app, provider, businesses } = build({ configured: true });
  const { server, call } = await listen(app);
  try {
    const before = await call("/api/admin/billing");
    assert.equal(before.data.billing.upgrade_available, true);
    assert.equal(before.data.billing.provider, "recurrente");

    const created = await call("/api/admin/billing/checkout", {
      method: "POST",
      body: { plan: "NEGOCIO" },
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.deepEqual(Object.keys(created.data.checkout), [
      "id",
      "url",
      "expires_at",
      "plan",
      "quantity",
      "currency",
      "unit_amount_minor",
    ]);
    assert.equal(created.data.checkout.id, CHK);
    assert.match(created.data.checkout.url, /^https:\/\/app\.recurrente\.com\/checkout-session\//);
    const reused = await call("/api/admin/billing/checkout", {
      method: "POST",
      body: { plan: "NEGOCIO" },
    });
    assert.equal(reused.status, 200);
    assert.equal(reused.data.reused, true);

    const pending = await call(`/api/admin/billing/checkout/${CHK}`);
    assert.equal(pending.status, 200);
    assert.equal(pending.data.status, "pending");
    assert.equal(pending.data.subscription, null);
    const overview = await call("/api/admin/billing");
    assert.deepEqual(Object.keys(overview.data.billing.checkout_pending), [
      "id",
      "url",
      "expires_at",
    ]);

    // The webhook lands (raw body, fixture signature) and the business converts.
    provider.program("subscription-get.json");
    const raw = JSON.stringify(loadFixture("intent-succeeded-first.json"));
    const hook = await call("/api/public/billing/webhooks/recurrente", {
      method: "POST",
      role: "",
      raw,
      headers: { "svix-id": "msg_1", "content-type": "application/json" },
    });
    assert.equal(hook.status, 200, JSON.stringify(hook.data));
    assert.equal(hook.data.handled, true);
    const dup = await call("/api/v1/public/billing/webhooks/recurrente", {
      method: "POST",
      role: "",
      raw,
      headers: { "svix-id": "msg_1", "content-type": "application/json" },
    });
    assert.deepEqual(dup.data, { ok: true, duplicate: true });
    assert.equal(businesses.get(BIZ).billing_status, "active");

    const completed = await call(`/api/admin/billing/checkout/${CHK}`);
    assert.equal(completed.data.status, "completed");
    assert.equal(completed.data.subscription.plan, "NEGOCIO");
    assert.equal(completed.data.subscription.monthly_total_minor, 63000);
    const after = await call("/api/admin/billing");
    assert.equal(after.data.billing.status, "active");
    assert.equal(after.data.billing.upgrade_available, false);
    assert.equal(after.data.billing.change_available, true);
    assert.equal(
      after.data.billing.latest_tax_invoice_url,
      "https://app.recurrente.com/fel/in_fixture001",
    );
    assert.equal(after.data.billing.current_period_end, "2027-01-01T14:03:21.000Z");
    const again = await call("/api/admin/billing/checkout", {
      method: "POST",
      body: { plan: "EMPRESA" },
    });
    assert.equal(again.status, 409);
    assert.equal(again.data.code, "BILLING_ALREADY_ACTIVE");

    const change = await call("/api/admin/billing/change", {
      method: "POST",
      body: { plan: "EMPRESA" },
    });
    assert.equal(change.status, 200);
    assert.equal(change.data.subscription.plan, "EMPRESA");
    const cancel = await call("/api/admin/billing/cancel", {
      method: "POST",
      body: { at_period_end: true },
    });
    assert.equal(cancel.status, 200);
    assert.equal(cancel.data.subscription.cancel_at, "2027-01-01T14:03:21.000Z");
    const invoices = await call("/api/admin/billing/invoices");
    assert.equal(invoices.status, 200);
    assert.ok(Array.isArray(invoices.data.invoices));
  } finally {
    server.close();
  }
});

test("webhook route: bad signature is 401 with a HIGH security event, unknown provider 404, raw body preserved", async () => {
  const { app, provider, securityEvents, repo } = build({ configured: true });
  const { server, call } = await listen(app);
  try {
    provider.program("subscription-get.json");
    const bad = await call("/api/public/billing/webhooks/recurrente", {
      method: "POST",
      role: "",
      raw: JSON.stringify(loadFixture("unknown-event.json")),
      headers: {
        "svix-id": "msg_x",
        "x-fixture-signature": "invalid",
        "content-type": "application/json",
      },
    });
    assert.equal(bad.status, 401);
    assert.equal(bad.data.code, "WEBHOOK_SIGNATURE_INVALID");
    assert.equal(securityEvents.length, 1);
    assert.equal(securityEvents[0].event_type, "billing_webhook_auth_failed");
    assert.equal(securityEvents[0].severity, "HIGH");
    assert.equal(repo.state.providerEvents.length, 0);

    const unknownProvider = await call("/api/public/billing/webhooks/paypal", {
      method: "POST",
      role: "",
      raw: "{}",
    });
    assert.equal(unknownProvider.status, 404);
    const manual = await call("/api/public/billing/webhooks/manual", {
      method: "POST",
      role: "",
      raw: "{}",
    });
    assert.equal(manual.status, 404);

    // Pretty-printed JSON must reach the verifier byte for byte (no re-serialization).
    const pretty = JSON.stringify(loadFixture("unknown-event.json"), null, 2);
    const ok = await call("/api/public/billing/webhooks/recurrente", {
      method: "POST",
      role: "",
      raw: pretty,
      headers: { "svix-id": "msg_y", "content-type": "text/plain" },
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.type, "ignored");
    assert.equal(
      JSON.stringify(repo.state.providerEvents[0].payload),
      JSON.stringify(JSON.parse(pretty)),
    );
    const empty = await call("/api/public/billing/webhooks/recurrente", {
      method: "POST",
      role: "",
      raw: "",
      headers: { "svix-id": "msg_z" },
    });
    assert.equal(empty.status, 400);
  } finally {
    server.close();
  }
});

test("super routes: listings, catalog sync and the immediate cancel with audit", async (t) => {
  const audits = [];
  t.mock.method(AuditRepo, "log", async (entry) => {
    audits.push(entry);
  });
  const security = [];
  t.mock.method(SecurityEventRepo, "log", async (entry) => {
    security.push(entry);
  });
  const { app, provider, businesses } = build({ configured: true });
  const { server, call } = await listen(app);
  try {
    assert.equal((await call("/api/super/billing/subscriptions", { role: "" })).status, 401);
    const emptyList = await call("/api/super/billing/subscriptions", {
      role: "",
      superAdmin: true,
    });
    assert.deepEqual(emptyList.data, { ok: true, provider_configured: true, subscriptions: [] });

    await call("/api/admin/billing/checkout", { method: "POST", body: { plan: "NEGOCIO" } });
    provider.program("subscription-get.json");
    await call("/api/public/billing/webhooks/recurrente", {
      method: "POST",
      role: "",
      raw: JSON.stringify(loadFixture("intent-succeeded-first.json")),
      headers: { "svix-id": "msg_1", "content-type": "application/json" },
    });
    const list = await call("/api/super/billing/subscriptions?status=active", {
      role: "",
      superAdmin: true,
    });
    assert.equal(list.status, 200);
    assert.equal(list.data.subscriptions.length, 1);
    const entry = list.data.subscriptions[0];
    assert.equal(entry.business.id, BIZ);
    assert.equal(entry.business_id, BIZ);
    assert.equal(entry.business_name, entry.business.name);
    assert.equal(entry.slug, entry.business.slug);
    assert.equal(entry.business.billing_status, "active");
    assert.equal(entry.provider_subscription_id, "su_fixture01");
    assert.equal(entry.plan_name, "Impulsa");
    const badQuery = await call("/api/super/billing/subscriptions?status=weird", {
      role: "",
      superAdmin: true,
    });
    assert.equal(badQuery.status, 400);

    const events = await call(`/api/super/billing/events?business_id=${BIZ}`, {
      role: "",
      superAdmin: true,
    });
    assert.equal(events.status, 200);
    assert.equal(events.data.events.length, 1);
    assert.equal(events.data.events[0].event_type, "intent.succeeded");
    assert.equal(events.data.events[0].status, "processed");
    assert.equal(events.data.events[0].summary.amount_in_cents, 63000);
    assert.equal(events.data.events[0].summary.subscription_id, "su_fixture01");
    assert.equal(
      "payload" in events.data.events[0],
      false,
      "raw payloads (PII) stay in the database",
    );

    const sync = await call("/api/super/billing/catalog/sync", {
      method: "POST",
      role: "",
      superAdmin: true,
      body: { force: false },
    });
    assert.equal(sync.status, 200);
    assert.equal(sync.data.kept.length, 6);
    assert.equal(sync.data.provider, "recurrente");
    assert.equal(security.at(-1).event_type, "super.billing_catalog.sync");

    const missing = await call(
      "/api/super/businesses/44444444-4444-4444-8444-444444444444/billing/cancel",
      {
        method: "POST",
        role: "",
        superAdmin: true,
        body: {},
      },
    );
    assert.equal(missing.status, 404);
    const canceled = await call(`/api/super/businesses/${BIZ}/billing/cancel`, {
      method: "POST",
      role: "",
      superAdmin: true,
      body: { note: "Fraude" },
    });
    assert.equal(canceled.status, 200, JSON.stringify(canceled.data));
    assert.equal(canceled.data.ended, true);
    assert.equal(canceled.data.business.billing_status, "locked");
    assert.equal(canceled.data.subscription.status, "canceled");
    assert.ok(canceled.data.business.purge_after);
    assert.equal(businesses.get(BIZ).billing_status, "locked");
    assert.equal(audits.at(-1).action, "super.billing.cancel");
    assert.equal(audits.at(-1).meta.note, "Fraude");
    assert.equal(audits.at(-1).meta.super_admin_email, "super@example.com");
    const none = await call(`/api/super/businesses/${BIZ}/billing/cancel`, {
      method: "POST",
      role: "",
      superAdmin: true,
      body: {},
    });
    assert.equal(none.status, 404);
    assert.equal(none.data.code, "BILLING_NO_SUBSCRIPTION");
  } finally {
    server.close();
  }
});

test("Stripe raw signatures on both API prefixes and provider selection on the existing super endpoint", async (t) => {
  t.mock.method(SecurityEventRepo, "log", async () => {});
  const { app, processor: f, securityEvents } = build({ configured: false, stripe: true });
  const { server, call } = await listen(app);
  try {
    const signed = f.signed(f.event("invoice.created", f.invoice));
    const webhook = { method: "POST", role: "", raw: signed.rawBody, headers: signed.headers };
    assert.equal(
      (await call("/api/public/billing/webhooks/stripe", { ...webhook, raw: signed.rawBody + " " }))
        .status,
      401,
    );
    assert.equal(securityEvents.length, 1);
    assert.equal((await call("/api/public/billing/webhooks/stripe", webhook)).data.type, "ignored");
    assert.equal(
      (
        await call("/api/v1/public/billing/webhooks/stripe", {
          ...webhook,
          headers: { ...signed.headers, "svix-id": "new" },
        })
      ).data.duplicate,
      true,
    );
    const sync = (body) =>
      call("/api/super/billing/catalog/sync", { method: "POST", superAdmin: true, body });
    assert.equal((await sync({ provider: "manual" })).status, 400);
    assert.equal((await sync({})).status, 503);
    const out = await sync({ provider: "stripe", force: true });
    assert.equal(out.status, 200);
    assert.equal(out.data.provider, "stripe");
    assert.equal(out.data.created.length, 3);
    assert.ok(out.data.created.every((p) => p.currency === "USD"));
  } finally {
    server.close();
  }
});
