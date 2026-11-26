// /precios: the page ships the published prices (Q300 / Q630 / Q1,030 per branch per month for
// Guatemala, USD 39 / 79 / 129 outside Guatemala, IVA included) as static markup; when
// GET /api/public/plans answers with `pricing_status: "published"` the cards are re-rendered
// from the server catalog (docs/product/2026-11-25-self-serve-trial.md §7.1). Any failure
// leaves the static fallback in place.

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

/** @param {number} value whole amounts as published; fixed en-US grouping ("1,030") */
const formatAmount = (value) =>
  Number.isInteger(value) ? value.toLocaleString("en-US") : value.toFixed(2);

/**
 * The price row of a card. With a quetzal amount (`gtq_monthly`) the quetzal price leads and
 * the USD price becomes the aside for businesses outside Guatemala; without one the catalog's
 * own currency is shown and the aside is empty (older catalogs).
 * @param {{ currency?: string, monthly?: number, gtq_monthly?: number, per?: string } | null | undefined} pricing
 * @returns {{ amount: string, unit: string, aside: string } | null}
 */
export function formatPlanPrice(pricing) {
  if (!pricing || typeof pricing.monthly !== "number" || !Number.isFinite(pricing.monthly))
    return null;
  const unit = pricing.per === "branch_month" || !pricing.per ? "al mes por sucursal" : "al mes";
  const currency = String(pricing.currency || "USD").toUpperCase();
  const gtq = pricing.gtq_monthly;
  if (typeof gtq === "number" && Number.isFinite(gtq) && gtq > 0 && currency === "USD")
    return {
      amount: `Q${formatAmount(gtq)}`,
      unit,
      aside: `USD ${formatAmount(pricing.monthly)} fuera de Guatemala`,
    };
  return {
    amount: `${currency === "GTQ" ? "Q" : `${currency} `}${formatAmount(pricing.monthly)}`,
    unit,
    aside: "",
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
 * Updates every `[data-plan]` card in `root` from the catalog. Returns how many cards changed.
 * The dated FX reference some catalogs carry (`reference_gtq`) is ignored: the quetzal amount
 * is a fixed list price, not a conversion.
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
      /** @type {{ id?: string, pricing?: any, limits?: any, features?: Record<string, boolean> }} */ (
        entry
      );
    const card = plan?.id ? root.querySelector(`[data-plan="${plan.id}"]`) : null;
    const price = formatPlanPrice(plan?.pricing);
    if (!card || !price) continue;
    const amount = card.querySelector("[data-plan-price]");
    const unit = card.querySelector("[data-plan-unit]");
    if (amount) amount.textContent = price.amount;
    if (unit) unit.textContent = price.unit;
    const aside = card.querySelector("[data-plan-price-usd]");
    if (aside) {
      aside.textContent = price.aside;
      aside.toggleAttribute("hidden", !price.aside);
    }
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
