// /precios: the page ships the published prices (USD 39 / 79 / 129 per branch per month) as
// static markup; when GET /api/public/plans answers with `pricing_status: "published"` the cards
// are re-rendered from the server catalog (docs/product/2026-11-25-self-serve-trial.md §7.1).
// Any failure leaves the static fallback in place.

/** @type {Record<string, string>} the comparison rows public-plan-service.js exposes */
export const PLAN_FEATURE_LABELS = {
  rewards: "Puntos y recompensas",
  staff_management: "Accesos para el equipo",
  analytics: "Análisis de resultados",
  lifecycle_automation: "Automatizaciones",
  branded_qr: "QR con marca",
  referrals: "Referidos",
  webhooks: "Webhooks",
  external_awards: "Puntos desde sistemas externos",
};

/**
 * @param {{ currency?: string, monthly?: number, per?: string } | null | undefined} pricing
 * @returns {{ amount: string, unit: string } | null}
 */
export function formatPlanPrice(pricing) {
  if (!pricing || typeof pricing.monthly !== "number" || !Number.isFinite(pricing.monthly))
    return null;
  const currency = String(pricing.currency || "USD").toUpperCase();
  const amount = Number.isInteger(pricing.monthly)
    ? String(pricing.monthly)
    : pricing.monthly.toFixed(2);
  return {
    amount: `${currency} ${amount}`,
    unit: pricing.per === "branch_month" || !pricing.per ? "por sucursal al mes" : "al mes",
  };
}

/**
 * @param {{ activeCustomers?: number, branches?: number, rewards?: number } | undefined} limits
 * @param {string} id plan code
 */
export function formatPlanLimits(limits, id) {
  if (!limits) return "";
  const parts = [];
  if (id === "EMPRESA" || !(Number(limits.activeCustomers) < 100000))
    parts.push("Clientes activos y sucursales según alcance");
  else {
    parts.push(`Hasta ${Number(limits.activeCustomers).toLocaleString("es-GT")} clientes activos`);
    parts.push(
      Number(limits.branches) === 1 ? "1 sucursal" : `Hasta ${Number(limits.branches)} sucursales`,
    );
  }
  if (Number(limits.rewards) > 1000) parts.push("recompensas según tu catálogo");
  else if (Number.isFinite(Number(limits.rewards)))
    parts.push(`hasta ${Number(limits.rewards)} recompensas`);
  return parts.join(" · ");
}

/**
 * @param {{ monthly?: number, amount?: number, as_of?: string, rate?: number } | null | undefined} reference
 */
export function formatGtqReference(reference) {
  const value = reference?.monthly ?? reference?.amount;
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  const date = reference?.as_of ? ` (tipo de cambio del ${reference.as_of})` : "";
  return `Referencia: Q${value.toLocaleString("es-GT")} al mes por sucursal${date}. El cobro en quetzales se confirma al elegir plan.`;
}

/**
 * Updates every `[data-plan]` card in `root` from the catalog. Returns how many cards changed.
 * @param {ParentNode} root
 * @param {unknown} catalog
 */
export function applyPlanCatalog(root, catalog) {
  const data = /** @type {{ pricing_status?: string, plans?: unknown } | null} */ (
    catalog && typeof catalog === "object" ? catalog : null
  );
  if (!data || data.pricing_status !== "published" || !Array.isArray(data.plans)) return 0;
  let updated = 0;
  for (const entry of data.plans) {
    const plan =
      /** @type {{ id?: string, pricing?: any, limits?: any, features?: Record<string, boolean>, reference_gtq?: any }} */ (
        entry
      );
    const card = plan?.id ? root.querySelector(`[data-plan="${plan.id}"]`) : null;
    const price = formatPlanPrice(plan?.pricing);
    if (!card || !price) continue;
    const amount = card.querySelector("[data-plan-price]");
    const unit = card.querySelector("[data-plan-unit]");
    if (amount) amount.textContent = price.amount;
    if (unit) unit.textContent = price.unit;
    const limits = card.querySelector("[data-plan-limits]");
    const limitsText = formatPlanLimits(plan.limits, String(plan.id));
    if (limits && limitsText) limits.textContent = limitsText;
    const list = card.querySelector("[data-plan-features]");
    if (list && plan.features && typeof plan.features === "object") {
      list.replaceChildren();
      for (const [key, label] of Object.entries(PLAN_FEATURE_LABELS)) {
        if (!plan.features[key]) continue;
        const item = document.createElement("li");
        item.textContent = label;
        list.appendChild(item);
      }
    }
    const reference = card.querySelector("[data-plan-reference]");
    if (reference) {
      const text = formatGtqReference(plan.reference_gtq);
      reference.textContent = text;
      reference.toggleAttribute("hidden", !text);
    }
    updated += 1;
  }
  return updated;
}

async function main() {
  try {
    const res = await fetch("/api/public/plans", { headers: { Accept: "application/json" } });
    if (!res.ok) return;
    applyPlanCatalog(document, await res.json());
  } catch {
    /* The static prices on the page are the fallback. */
  }
}

if (typeof document !== "undefined" && typeof fetch === "function") void main();
