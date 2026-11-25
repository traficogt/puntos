import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import pg from "pg";

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

// Wave 2 of the self-serve trial (docs/product/2026-11-25-self-serve-trial.md): a trial
// business pays through an injected fake provider, converts, loses the lock, pays a
// renewal, falls past due, is canceled and locks again; the real database, RLS and the
// HTTP owner/super surfaces are exercised. The live stack has no Recurrente key, so the
// HTTP checkout answers 503 and the provider calls go through the fake only.
integrationDescribe("Subscription billing integration (fake provider, real database)", () => {
  const baseUrl = process.env.TEST_API_URL || "http://localhost:3001";
  const browserOrigin = new URL(baseUrl).origin;
  const superEmail = process.env.SUPER_ADMIN_EMAIL;
  const superPassword = process.env.SUPER_ADMIN_PASSWORD;
  const forwardedFor = `198.51.102.${Math.max(10, Math.floor(Math.random() * 200))}`;
  const superForwardedFor = `198.51.103.${Math.max(10, Math.floor(Math.random() * 200))}`;
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

  it("converts a locked trial through a paid checkout, lifts the lock, and locks again after cancellation", async () => {
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
    const { closeDatabase, withDbClientContext } = await import("../../src/app/database.js");
    const { createSubscriptionService } =
      await import("../../src/app/services/billing/subscription-service.js");
    const { createFakeProvider, fixtureCatalog, loadFixture } =
      await import("../fixtures/billing/memory-billing-repo.mjs");
    try {
      const anon = new Map(),
        ownerJar = new Map(),
        superJar = new Map();
      jarIps.set(superJar, superForwardedFor);
      const rand = Math.random().toString(36).slice(2, 9);
      const phone = `+50256${Math.floor(Math.random() * 1000000)
        .toString()
        .padStart(6, "0")}`;
      const password = "OrchardLanternMarble2026!";

      // A self-serve trial (wave 1 flow).
      const requested = await request(anon, "/api/public/trial/request-code", {
        method: "POST",
        body: JSON.stringify({ phone, turnstileToken: "dev" }),
      });
      assert.equal(requested.status, 200, JSON.stringify(requested.data));
      const verified = await request(anon, "/api/public/trial/verify", {
        method: "POST",
        body: JSON.stringify({ phone, code: requested.data.dev_code }),
      });
      assert.equal(verified.status, 200, JSON.stringify(verified.data));
      const signup = await request(ownerJar, "/api/public/trial/signup", {
        method: "POST",
        body: JSON.stringify({
          grant: verified.data.grant,
          businessName: `Pago ${rand}`,
          email: `billing-${rand}@example.com`,
          password,
          category: "cafe",
          turnstileToken: "dev",
          plan: "NEGOCIO",
        }),
      });
      assert.equal(signup.status, 201, JSON.stringify(signup.data));
      const businessId = signup.data.business.id;

      // Unconfigured server: the HTTP surface says so, nothing breaks.
      let billing = await request(ownerJar, "/api/admin/billing");
      assert.equal(billing.status, 200, JSON.stringify(billing.data));
      assert.equal(billing.data.billing.status, "trialing");
      assert.equal(billing.data.billing.upgrade_available, false);
      assert.equal(billing.data.billing.provider, null);
      assert.deepEqual(
        billing.data.catalog.plans.map((p) => p.unit_amount_minor),
        [3900, 7900, 12900],
      );
      assert.equal(billing.data.branches, 1);
      const unavailable = await request(ownerJar, "/api/admin/billing/checkout", {
        method: "POST",
        csrf: true,
        body: JSON.stringify({ plan: "NEGOCIO" }),
      });
      assert.equal(unavailable.status, 503);
      assert.equal(unavailable.data.code, "BILLING_UNAVAILABLE");
      const trial = await request(ownerJar, "/api/admin/trial");
      assert.equal(trial.data.trial.upgrade_available, false);
      const hookUnconfigured = await request(anon, "/api/public/billing/webhooks/recurrente", {
        method: "POST",
        body: JSON.stringify(loadFixture("unknown-event.json")),
        headers: { "svix-id": `msg_${rand}_0` },
      });
      assert.equal(hookUnconfigured.status, 503);

      // The trial ended yesterday: owner writes are locked (402).
      await admin.query(
        `UPDATE businesses SET trial_started_at = now() - interval '15 days',
           trial_ends_at = now() - interval '1 day' WHERE id=$1`,
        [businessId],
      );
      const refused = await request(ownerJar, "/api/admin/rewards", {
        method: "POST",
        csrf: true,
        body: JSON.stringify({ name: `Bloqueado ${rand}`, description: "x", points_cost: 5 }),
      });
      assert.equal(refused.status, 402);
      assert.equal(refused.data.code, "TRIAL_LOCKED");

      // The service with a fake provider but the real repository and database contexts.
      const catalog = fixtureCatalog();
      const provider = createFakeProvider({ catalog });
      // The fixtures are dated December 2026 to February 2027; the service clock follows
      // them so period ends and cancellations are evaluated against those dates.
      const clock = { now: new Date() };
      const service = createSubscriptionService({
        provider,
        getCatalog: async () => catalog,
        setCatalog: async (c) => c,
        now: () => clock.now,
      });
      const asOwner = (fn) =>
        withDbClientContext({ tenantId: businessId, platformAdmin: false }, fn);

      const started = await asOwner(() => service.startCheckout({ businessId, plan: "NEGOCIO" }));
      assert.equal(started.reused, false);
      assert.equal(started.checkout.unit_amount_minor, 7900);
      const checkoutId = started.checkout.id;
      const reused = await asOwner(() => service.startCheckout({ businessId, plan: "NEGOCIO" }));
      assert.equal(reused.reused, true, "the open checkout is reused (tenant RLS read)");
      billing = await request(ownerJar, "/api/admin/billing");
      assert.equal(billing.data.billing.checkout_pending.id, checkoutId);
      const polling = await request(ownerJar, `/api/admin/billing/checkout/${checkoutId}`);
      assert.equal(polling.status, 200);
      assert.equal(polling.data.status, "pending");
      const stored = (
        await admin.query(
          "SELECT status, provider, provider_checkout_id FROM billing_checkouts WHERE id=$1",
          [checkoutId],
        )
      ).rows[0];
      assert.equal(stored.status, "open");
      assert.equal(stored.provider, "recurrente");

      // First payment webhook: the business converts and the lock lifts.
      provider.program("subscription-get.json", { businessId, checkoutId });
      const payload = (name) => JSON.stringify(loadFixture(name, { businessId, checkoutId }));
      const hook = (name, id) =>
        service.handleWebhook({
          provider: "recurrente",
          rawBody: payload(name),
          headers: { "svix-id": `msg_${rand}_${id}` },
        });
      const paid = await hook("intent-succeeded-first.json", 1);
      assert.equal(paid.status, 200, JSON.stringify(paid.body));
      assert.equal(paid.body.handled, true);
      const row = (
        await admin.query(
          "SELECT plan, billing_status, trial_status, billing_currency, locked_at, purge_after FROM businesses WHERE id=$1",
          [businessId],
        )
      ).rows[0];
      assert.equal(row.plan, "NEGOCIO");
      assert.equal(row.billing_status, "active");
      assert.equal(row.trial_status, "converted");
      assert.equal(row.billing_currency, "USD");
      assert.equal(row.purge_after, null);
      const sub = (
        await admin.query("SELECT * FROM billing_subscriptions WHERE business_id=$1", [businessId])
      ).rows;
      assert.equal(sub.length, 1);
      assert.equal(sub[0].status, "active");
      assert.equal(sub[0].provider_subscription_id, "su_fixture01");
      assert.equal(sub[0].checkout_id, checkoutId);
      assert.equal(Number(sub[0].unit_amount_minor), 7900);
      assert.equal(sub[0].metadata.first_payment_at, "2026-12-01T14:03:21.000Z");
      const events = (
        await admin.query(
          "SELECT event_type, metadata FROM billing_events WHERE business_id=$1 ORDER BY created_at",
          [businessId],
        )
      ).rows;
      const types = events.map((e) => e.event_type);
      for (const type of [
        "trial.started",
        "checkout.created",
        "checkout.completed",
        "trial.converted",
        "subscription.activated",
        "payment.succeeded",
      ])
        assert.ok(types.includes(type), `${type} in ${types.join(",")}`);
      assert.equal(
        events.find((e) => e.event_type === "payment.succeeded").metadata.fee_minor,
        357,
      );
      const providerEvents = (
        await admin.query(
          "SELECT status, event_type, business_id, subscription_id FROM billing_provider_events WHERE provider_event_id=$1",
          [`msg_${rand}_1`],
        )
      ).rows;
      assert.equal(providerEvents.length, 1);
      assert.equal(providerEvents[0].status, "processed");
      assert.equal(providerEvents[0].business_id, businessId);
      assert.equal(providerEvents[0].subscription_id, sub[0].id);

      const writable = await request(ownerJar, "/api/admin/rewards", {
        method: "POST",
        csrf: true,
        body: JSON.stringify({ name: `Pagado ${rand}`, description: "x", points_cost: 5 }),
      });
      assert.equal(writable.status, 200, "the lock lifts once the subscription is active");
      const converted = await request(ownerJar, "/api/admin/trial");
      assert.equal(converted.data.trial.status, "converted");
      assert.equal(converted.data.trial.plan_name, "Impulsa");
      assert.equal(converted.data.billing.provider, "recurrente");
      billing = await request(ownerJar, "/api/admin/billing");
      assert.equal(billing.data.billing.status, "active");
      assert.equal(billing.data.billing.subscription.plan, "NEGOCIO");
      assert.equal(billing.data.billing.subscription.quantity, 1);
      assert.equal(billing.data.billing.monthly_total_minor, 7900);
      assert.equal(
        billing.data.billing.latest_tax_invoice_url,
        "https://app.recurrente.com/fel/in_fixture001",
      );
      assert.equal(billing.data.billing.current_period_end, "2027-01-01T14:03:21.000Z");
      assert.equal(billing.data.billing.checkout_pending, null);
      const completed = await request(ownerJar, `/api/admin/billing/checkout/${checkoutId}`);
      assert.equal(completed.data.status, "completed");
      assert.equal(completed.data.subscription.plan, "NEGOCIO");
      let invoices = await request(ownerJar, "/api/admin/billing/invoices");
      assert.equal(invoices.status, 200);
      assert.equal(invoices.data.invoices.length, 1);
      assert.equal(invoices.data.invoices[0].status, "paid");
      assert.equal(invoices.data.invoices[0].amount_minor, 7900);
      assert.equal(
        invoices.data.invoices[0].tax_invoice_url,
        "https://app.recurrente.com/fel/in_fixture001",
      );

      // Idempotent ingestion and the companion subscription.create.
      const dup = await hook("intent-succeeded-first.json", 1);
      assert.deepEqual(dup, { status: 200, body: { ok: true, duplicate: true } });
      const created = await hook("subscription-create.json", 2);
      assert.equal(created.status, 200);
      assert.equal(
        (
          await admin.query(
            "SELECT count(*)::int AS n FROM billing_subscriptions WHERE business_id=$1",
            [businessId],
          )
        ).rows[0].n,
        1,
      );

      // Renewal, failed charge (past_due keeps access), recovery.
      const renewal = await hook("intent-succeeded-renewal.json", 3);
      assert.equal(renewal.status, 200);
      invoices = await request(ownerJar, "/api/admin/billing/invoices");
      assert.equal(invoices.data.invoices.length, 2);
      provider.program("subscription-get-past-due.json", { businessId, checkoutId });
      const failed = await hook("intent-failed.json", 4);
      assert.equal(failed.status, 200);
      assert.equal(
        (await admin.query("SELECT billing_status FROM businesses WHERE id=$1", [businessId]))
          .rows[0].billing_status,
        "past_due",
      );
      const stillWritable = await request(ownerJar, "/api/admin/rewards", {
        method: "POST",
        csrf: true,
        body: JSON.stringify({ name: `Gracia ${rand}`, description: "x", points_cost: 5 }),
      });
      assert.equal(stillWritable.status, 200, "past_due keeps full access during the grace period");
      billing = await request(ownerJar, "/api/admin/billing");
      assert.equal(billing.data.billing.status, "past_due");
      assert.equal(billing.data.billing.next_payment_attempt_at, "2027-02-02T14:05:00.000Z");
      invoices = await request(ownerJar, "/api/admin/billing/invoices");
      assert.equal(invoices.data.invoices[0].status, "failed");
      provider.program("subscription-get.json", { businessId, checkoutId });
      const recovered = await hook("intent-succeeded-renewal.json", 5);
      assert.equal(recovered.status, 200);
      assert.equal(
        (await admin.query("SELECT billing_status FROM businesses WHERE id=$1", [businessId]))
          .rows[0].billing_status,
        "active",
      );

      // Branch hook: a second branch moves the quantity to 2 (plan NEGOCIO allows 3).
      const synced = await service.syncBranchQuantity({ businessId, reason: "branch_added" });
      assert.deepEqual(synced, { skipped: "unchanged" }, "one branch, one unit");
      await admin.query(
        "INSERT INTO branches(id,business_id,name,address,code) VALUES($1,$2,'Sucursal 2',NULL,$3)",
        [crypto.randomUUID(), businessId, `b2-${rand}`],
      );
      const grown = await service.syncBranchQuantity({ businessId, reason: "branch_added" });
      assert.equal(grown.changed, true);
      assert.equal(grown.mode, "now_and_charge");
      assert.equal(
        Number(
          (
            await admin.query("SELECT quantity FROM billing_subscriptions WHERE business_id=$1", [
              businessId,
            ])
          ).rows[0].quantity,
        ),
        2,
      );
      billing = await request(ownerJar, "/api/admin/billing");
      assert.equal(billing.data.billing.monthly_total_minor, 15800);

      // Daily reconcile: a past-due read older than the grace period locks without a purge date.
      provider.program("subscription-get-past-due.json", { businessId, checkoutId });
      await admin.query(
        `UPDATE billing_subscriptions SET metadata = metadata || jsonb_build_object('past_due_since',
           to_char((now() - interval '8 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
         WHERE business_id=$1`,
        [businessId],
      );
      await admin.query("UPDATE businesses SET billing_status='past_due' WHERE id=$1", [
        businessId,
      ]);
      const summary = await service.reconcileOnce({ now: new Date() });
      assert.ok(summary.subscriptions_checked >= 1, JSON.stringify(summary));
      const graceLocked = (
        await admin.query("SELECT billing_status, purge_after FROM businesses WHERE id=$1", [
          businessId,
        ])
      ).rows[0];
      assert.equal(graceLocked.billing_status, "locked");
      assert.equal(graceLocked.purge_after, null);
      const lockedAgain = await request(ownerJar, "/api/admin/rewards", {
        method: "POST",
        csrf: true,
        body: JSON.stringify({ name: `Mora ${rand}`, description: "x", points_cost: 5 }),
      });
      assert.equal(lockedAgain.status, 402);
      billing = await request(ownerJar, "/api/admin/billing");
      assert.equal(billing.data.billing.lock_reason, "payment_failed");
      // A later successful retry unlocks.
      provider.program("subscription-get.json", { businessId, checkoutId });
      await hook("intent-succeeded-renewal.json", 6);
      assert.equal(
        (await admin.query("SELECT billing_status FROM businesses WHERE id=$1", [businessId]))
          .rows[0].billing_status,
        "active",
      );

      // Final cancellation (retries exhausted): the lock returns with the retention clock.
      provider.program("subscription-get-cancelled.json", { businessId, checkoutId });
      clock.now = new Date("2027-02-16T15:00:00.000Z");
      const canceled = await hook("subscription-cancel.json", 7);
      assert.equal(canceled.status, 200, JSON.stringify(canceled.body));
      const ended = (
        await admin.query(
          "SELECT billing_status, trial_status, purge_after, locked_at FROM businesses WHERE id=$1",
          [businessId],
        )
      ).rows[0];
      assert.equal(ended.billing_status, "locked");
      assert.equal(ended.trial_status, "converted");
      assert.ok(ended.purge_after && ended.locked_at);
      assert.equal(
        Math.round(
          (new Date(ended.purge_after).getTime() - new Date(ended.locked_at).getTime()) /
            86_400_000,
        ),
        30,
      );
      const refusedAgain = await request(ownerJar, "/api/admin/rewards", {
        method: "POST",
        csrf: true,
        body: JSON.stringify({ name: `Cancelado ${rand}`, description: "x", points_cost: 5 }),
      });
      assert.equal(refusedAgain.status, 402, "the lock returns after cancellation");
      billing = await request(ownerJar, "/api/admin/billing");
      assert.equal(billing.data.billing.status, "locked");
      assert.equal(billing.data.billing.lock_reason, "canceled");
      assert.equal(billing.data.billing.subscription.status, "canceled");
      const ignored = await hook("unknown-event.json", 8);
      assert.equal(ignored.status, 200);
      assert.equal(ignored.body.type, "ignored");

      // Super console surfaces.
      const login = await request(superJar, "/api/super/login", {
        method: "POST",
        body: JSON.stringify({ email: superEmail, password: superPassword }),
      });
      assert.equal(login.status, 200);
      const subs = await request(superJar, "/api/super/billing/subscriptions?status=canceled");
      assert.equal(subs.status, 200, JSON.stringify(subs.data));
      assert.equal(subs.data.provider_configured, false);
      const mine = subs.data.subscriptions.find((s) => s.business.id === businessId);
      assert.ok(mine, "the canceled subscription is listed");
      assert.equal(mine.business.billing_status, "locked");
      const providerEventList = await request(
        superJar,
        `/api/super/billing/events?business_id=${businessId}`,
      );
      assert.equal(providerEventList.status, 200);
      // Seven deliveries were tied to the business; the unknown event is stored without one.
      assert.ok(
        providerEventList.data.events.length >= 7,
        String(providerEventList.data.events.length),
      );
      assert.ok(providerEventList.data.events.every((e) => e.business_id === businessId));
      assert.ok(providerEventList.data.events.every((e) => !("payload" in e)));
      const allEvents = await request(superJar, "/api/super/billing/events?limit=50");
      assert.equal(allEvents.status, 200);
      const ignoredRow = allEvents.data.events.find((e) => e.provider_event_id === `msg_${rand}_8`);
      assert.ok(ignoredRow, "the unknown event is listed");
      assert.equal(ignoredRow.status, "ignored");
      assert.equal(ignoredRow.event_type, "withdrawal.update");
      const sync = await request(superJar, "/api/super/billing/catalog/sync", {
        method: "POST",
        csrf: true,
        body: JSON.stringify({}),
      });
      assert.equal(sync.status, 503, "no Recurrente key in the live stack");
      const noSub = await request(superJar, `/api/super/businesses/${businessId}/billing/cancel`, {
        method: "POST",
        csrf: true,
        body: JSON.stringify({}),
      });
      assert.equal(noSub.status, 404);
      assert.equal(noSub.data.code, "BILLING_NO_SUBSCRIPTION");
    } finally {
      await admin.end().catch(() => {});
      await closeDatabase().catch(() => {});
    }
  });
});
