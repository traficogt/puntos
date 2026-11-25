import test from "node:test";
import assert from "node:assert/strict";
import { purgeDryRun, runTrialDailyOnce } from "../../src/app/services/trial-lifecycle-service.js";
import { renderTrialEmail } from "../../src/app/services/trial-email-service.js";

const DAY = 86_400_000;
const now = new Date("2026-12-09T15:00:00.000Z"); // 09:00 in Guatemala

/**
 * @param {any[]} businesses rows of businesses (trialing or locked)
 * @param {Record<string, any>} [overrides]
 */
function fixture(businesses, overrides = {}) {
  const state = {
    rows: businesses.map((b) => ({ program_json: {}, email: `${b.slug}@example.com`, ...b })),
    markers: [],
    emails: [],
    billingEvents: [],
    transitions: [],
    locks: [],
    emailOk: true,
    emailReady: true,
    purgeEvents: new Set(),
  };
  const withKinds = (row) => ({
    ...row,
    kinds_sent: state.markers.filter((m) => m.businessId === row.id).map((m) => m.kind),
  });
  const deps = {
    repo: {
      listTrialing: async () =>
        state.rows.filter((r) => r.billing_status === "trialing").map(withKinds),
      listLocked: async () =>
        state.rows.filter((r) => r.billing_status === "locked").map(withKinds),
      lockExpired: async ({ businessId, now: at, purgeAfter }) => {
        const row = state.rows.find((r) => r.id === businessId);
        if (!row || row.billing_status !== "trialing") return null;
        Object.assign(row, {
          billing_status: "locked",
          trial_status: "expired",
          locked_at: at,
          purge_after: purgeAfter,
        });
        state.locks.push({ businessId, purgeAfter });
        return businessId;
      },
      markNotified: async (marker) => {
        if (state.markers.some((m) => m.businessId === marker.businessId && m.kind === marker.kind))
          return false;
        state.markers.push(marker);
        return true;
      },
      purgeCandidates: async (at) =>
        state.rows
          .filter((r) => r.billing_status === "locked" && r.purge_after && r.purge_after <= at)
          .map((r) => ({
            business_id: r.id,
            name: r.name,
            slug: r.slug,
            purge_after: r.purge_after,
            locked_at: r.locked_at ?? null,
            counts: { customers: 3, transactions: 7 },
          })),
      hasBillingEvent: async (businessId, type) => state.purgeEvents.has(`${businessId}:${type}`),
    },
    platform: async (fn) => fn(),
    tenant: async (_id, fn) => fn(),
    query: async () => ({ rows: [] }),
    loadFacts: async () => ({ active_customers: 12, genuine_awards: 30, genuine_redemptions: 2 }),
    sendEmail: async (message) => {
      state.emails.push(message);
      return state.emailOk
        ? { ok: true, providerId: "smtp:x" }
        : { ok: false, error: "DELIVERY_UNCERTAIN" };
    },
    emailReady: () => state.emailReady,
    emitBillingEvent: async (event) => {
      state.billingEvents.push(event);
      if (event.eventType === "trial.purge_candidate")
        state.purgeEvents.add(`${event.businessId}:${event.eventType}`);
    },
    countTransition: (to) => state.transitions.push(to),
    getBillingCatalog: async () => ({ usd: { EMPRENDEDOR: 39, NEGOCIO: 79, EMPRESA: 129 } }),
    config: { APP_ORIGIN: "https://app.puntosfieles.com", TRIAL_RETENTION_DAYS: 30 },
    log: { warn: () => {}, info: () => {} },
    ...overrides,
  };
  return { state, deps, run: (at = now) => runTrialDailyOnce({ now: at }, deps) };
}

const trialing = (id, endsInDays, extra = {}) => ({
  id,
  name: `Negocio ${id}`,
  slug: `negocio-${id}`,
  plan: "EMPRENDEDOR",
  trial_status: "active",
  billing_status: "trialing",
  trial_started_at: new Date(now.getTime() - (14 - endsInDays) * DAY),
  trial_ends_at: new Date(now.getTime() + endsInDays * DAY),
  locked_at: null,
  purge_after: null,
  created_at: now,
  ...extra,
});

test("day 10 and day 13 reminders go out once per business and carry the owner's progress", async () => {
  const { state, run } = fixture([
    trialing("a", 4), // day 10
    trialing("b", 1), // day 13
    trialing("c", 9), // nothing yet
  ]);
  const first = await run();
  assert.deepEqual(first.reminders, { day10: 1, day13: 1 });
  assert.equal(first.locked, 0);
  assert.deepEqual(
    state.emails.map((e) => [e.to, e.kind]),
    [
      ["negocio-a@example.com", "day10"],
      ["negocio-b@example.com", "day13"],
    ],
  );
  assert.deepEqual(state.emails[0].context.progress, {
    active_customers: 12,
    genuine_awards: 30,
    genuine_redemptions: 2,
  });
  assert.equal(state.emails[0].context.priceUsd, 39);
  assert.equal(state.emails[0].context.planName, "Conecta");
  assert.equal(state.emails[0].context.joinUrl, "https://app.puntosfieles.com/registro/negocio-a");
  assert.deepEqual(
    state.billingEvents.map((e) => [e.businessId, e.eventType, e.metadata.kind]),
    [
      ["a", "trial.reminder_sent", "day10"],
      ["b", "trial.reminder_sent", "day13"],
    ],
  );
  // Idempotent: the same day (and the next) sends nothing new.
  const again = await run();
  assert.deepEqual(again.reminders, { day10: 0, day13: 0 });
  assert.equal(state.emails.length, 2);
  // Next day: a has 3 days left (day10 already sent, day13 not yet due); b reached its
  // end and is locked with the lock notice.
  const nextDay = await run(new Date(now.getTime() + DAY));
  assert.deepEqual(nextDay.reminders, { day10: 0, day13: 0 });
  assert.equal(nextDay.locked, 1);
  assert.deepEqual(
    state.emails.map((e) => e.kind),
    ["day10", "day13", "locked"],
  );
});

test("a reminder the relay did not accept leaves no marker and retries on the next run; no SMTP means skipped, not marked", async () => {
  const { state, run } = fixture([trialing("a", 4)]);
  state.emailOk = false;
  let summary = await run();
  assert.deepEqual(summary.reminders, { day10: 0, day13: 0 });
  assert.equal(state.markers.length, 0);
  assert.equal(state.emails.length, 1);
  state.emailOk = true;
  summary = await run();
  assert.deepEqual(summary.reminders, { day10: 1, day13: 0 });
  assert.equal(state.markers.length, 1);

  const silent = fixture([trialing("z", 1)]);
  silent.state.emailReady = false;
  const quiet = await silent.run();
  assert.equal(quiet.emails_skipped, 1);
  assert.equal(silent.state.markers.length, 0);
  assert.equal(silent.state.emails.length, 0);
});

test("the day-14 lock moves only trialing businesses, sets purge_after 30 days out, records the fact and emails once", async () => {
  const { state, run } = fixture([trialing("a", -0.5), trialing("b", 9)]);
  const summary = await run();
  assert.equal(summary.locked, 1);
  assert.deepEqual(state.locks, [
    { businessId: "a", purgeAfter: new Date(now.getTime() + 30 * DAY) },
  ]);
  assert.deepEqual(state.transitions, ["locked"]);
  const row = state.rows.find((r) => r.id === "a");
  assert.equal(row.billing_status, "locked");
  assert.equal(row.trial_status, "expired");
  assert.deepEqual(
    state.billingEvents.map((e) => e.eventType),
    ["trial.locked", "trial.reminder_sent"],
  );
  assert.deepEqual(
    state.emails.map((e) => e.kind),
    ["locked"],
  );
  assert.equal(
    state.emails[0].context.purgeAfter.toISOString(),
    new Date(now.getTime() + 30 * DAY).toISOString(),
  );
  // Next run: already locked, nothing repeats; the purge warning is not due yet.
  const next = await run(new Date(now.getTime() + DAY));
  assert.equal(next.locked, 0);
  assert.equal(next.purge7, 0);
  assert.equal(state.emails.length, 1);
  assert.deepEqual(next.purge_candidates, []);
});

test("the purge warning goes out 7 days before purge_after and the day-44 purge is a dry run that records each candidate once", async () => {
  const locked = (id, purgeInDays) =>
    trialing(id, -31, {
      trial_status: "expired",
      billing_status: "locked",
      locked_at: new Date(now.getTime() - 30 * DAY),
      purge_after: new Date(now.getTime() + purgeInDays * DAY),
    });
  const { state, run } = fixture([locked("w", 6), locked("p", -1), locked("later", 20)]);
  const summary = await run();
  assert.equal(summary.purge7, 2, "both w (6 days) and p (overdue) get the last call once");
  assert.deepEqual(state.emails.map((e) => [e.to, e.kind]).sort(), [
    ["negocio-p@example.com", "purge7"],
    ["negocio-w@example.com", "purge7"],
  ]);
  assert.equal(summary.purge_mode, "dry_run");
  assert.deepEqual(
    summary.purge_candidates.map((c) => c.business_id),
    ["p"],
  );
  assert.deepEqual(summary.purge_candidates[0].counts, { customers: 3, transactions: 7 });
  assert.equal(state.rows.length, 3, "nothing was deleted");
  assert.deepEqual(
    state.billingEvents
      .filter((e) => e.eventType === "trial.purge_candidate")
      .map((e) => e.businessId),
    ["p"],
  );
  assert.deepEqual(state.transitions, ["purge_candidate"]);
  const again = await purgeDryRun({ now }, fixture([]).deps);
  assert.deepEqual(again, []);
  const second = await run();
  assert.equal(second.purge7, 0);
  assert.equal(
    state.billingEvents.filter((e) => e.eventType === "trial.purge_candidate").length,
    1,
    "the candidate fact is recorded once, not daily",
  );
});

test("every trial email is Spanish, branded and carries the dates in the business timezone", () => {
  const context = {
    businessName: "Café Prueba",
    panelUrl: "https://app.puntosfieles.com/negocio/",
    joinUrl: "https://app.puntosfieles.com/registro/cafe-prueba",
    planUrl: "https://app.puntosfieles.com/negocio/#plan",
    exportUrl: "https://app.puntosfieles.com/negocio/#clientes",
    endsAt: "2026-12-09T21:00:00.000Z",
    purgeAfter: "2027-01-08T21:00:00.000Z",
    timezone: "America/Guatemala",
    planName: "Conecta",
    priceUsd: 39,
    progress: { active_customers: 12, genuine_awards: 1, genuine_redemptions: 0 },
  };
  const welcome = renderTrialEmail("welcome", context);
  assert.equal(welcome.subject, "Tu prueba de PuntosFieles empezó");
  assert.match(welcome.text, /9 de diciembre de 2026/);
  assert.match(welcome.text, /registro\/cafe-prueba/);
  assert.match(welcome.html, /PuntosFieles/);
  const day10 = renderTrialEmail("day10", context);
  assert.equal(day10.subject, "Te quedan 4 días de prueba");
  assert.match(day10.text, /12 clientes registrados, 1 compra con puntos y 0 canjes/);
  assert.match(day10.text, /USD 39 por sucursal al mes/);
  assert.match(day10.html, /Elegir plan/);
  assert.equal(renderTrialEmail("day13", context).subject, "Mañana termina tu prueba");
  const locked = renderTrialEmail("locked", context);
  assert.equal(locked.subject, "Tu prueba terminó");
  assert.match(locked.text, /hasta el 8 de enero de 2027/);
  const purge = renderTrialEmail("purge7", context);
  assert.equal(purge.subject, "Tus datos se eliminarán el 8 de enero de 2027");
  assert.match(purge.text, /exporta tus clientes/);
  assert.doesNotMatch(purge.html, /<script/);
  assert.throws(() => renderTrialEmail(/** @type {any} */ ("other"), context), RangeError);
});
