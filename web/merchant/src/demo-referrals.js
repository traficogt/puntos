import {
  editableReferralSettings,
  referralPayload,
  validateReferralSettings,
} from "./referral-model.js";

// Synthetic, browser-memory-only data. Settings do not rewrite sample history.
let settings = {
  enabled: true,
  referrer_reward_points: 100,
  referred_reward_points: 50,
  min_purchase_to_complete: 50,
  reward_on_signup: false,
  custom_message: null,
};
const now = new Date("2026-11-10T18:00:00Z");
const names = [
  "Ana",
  "Luis",
  "Beatriz",
  "Carlos",
  "María",
  "Daniel",
  "Sofía",
  "Pablo",
];
const referrals = Array.from({ length: 42 }, (_, index) => {
  const created = new Date(now.getTime() - (index + 1) * 86400000);
  const purchased = index % 3 !== 0;
  const rewarded = index % 4 !== 0;
  return {
    id: `demo-referral-${index}`,
    created_at: created.toISOString(),
    referred_name: names[index % names.length],
    referrer_name: names[(index + 3) % names.length],
    first_purchase_at: purchased
      ? new Date(created.getTime() + 3 * 3600000).toISOString()
      : null,
    status: rewarded ? "rewarded" : "pending",
    recorded_reward_points: rewarded ? 150 : 0,
  };
});

export function demoReferrals(url, options = {}) {
  const method = options.method || "GET";
  if (url.pathname === "/api/admin/referral-settings") {
    if (method === "PUT") {
      const body = JSON.parse(options.body || "{}");
      const invalid = validateReferralSettings({
        ...body,
        min_purchase_to_complete:
          body.min_purchase_to_complete === null
            ? 0
            : body.min_purchase_to_complete,
      });
      if (invalid) throw new Error(invalid);
      settings = referralPayload(editableReferralSettings(body));
    } else if (method !== "GET")
      throw new Error(
        "Acción de recomendaciones no disponible en la demostración.",
      );
    return structuredClone({ ok: true, settings });
  }
  if (url.pathname !== "/api/admin/referral-growth" || method !== "GET")
    throw new Error(
      "Ruta de recomendaciones no disponible en la demostración.",
    );
  const days = url.searchParams.get("days") === "90" ? 90 : 30;
  const phase = url.searchParams.get("phase") || "all";
  const limit = Math.min(
    100,
    Math.max(1, Number(url.searchParams.get("limit") || 25)),
  );
  const offset = Math.min(
    10000,
    Math.max(0, Number(url.searchParams.get("offset") || 0)),
  );
  const start = new Date(Date.UTC(2026, 10, 11 - days, 6));
  const cohort = referrals.filter((row) => new Date(row.created_at) >= start);
  const purchased = cohort.filter((row) => row.first_purchase_at);
  const filtered = cohort.filter(
    (row) =>
      phase === "all" ||
      (phase === "purchased"
        ? !!row.first_purchase_at
        : !row.first_purchase_at),
  );
  return structuredClone({
    ok: true,
    generated_at: now.toISOString(),
    timezone: "America/Guatemala",
    period: { days, start: start.toISOString(), end: now.toISOString() },
    summary: {
      registered: cohort.length,
      purchased: purchased.length,
      purchased_and_rewarded: purchased.filter(
        (row) => row.status === "rewarded",
      ).length,
      awaiting_purchase: cohort.length - purchased.length,
      purchase_rate_pct: cohort.length
        ? Math.round((10000 * purchased.length) / cohort.length) / 100
        : null,
      reward_status: {
        pending: cohort.filter((row) => row.status === "pending").length,
        completed: 0,
        rewarded: cohort.filter((row) => row.status === "rewarded").length,
        other: 0,
      },
      recorded_reward_points: cohort.reduce(
        (sum, row) => sum + row.recorded_reward_points,
        0,
      ),
    },
    referrals: filtered.slice(offset, offset + limit),
    pagination: {
      total: filtered.length,
      limit,
      offset,
      has_more: offset + limit < filtered.length,
    },
    notes: [
      "Datos ficticios de demostración. No corresponden a clientes ni resultados reales.",
      "Las compras y el estado del premio son datos independientes. Un premio al registro puede existir sin compra.",
    ],
  });
}
