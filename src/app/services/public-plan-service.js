import {
  DEFAULT_BILLING_CATALOG,
  IVA_RATE,
  PLAN_PRICING_GTQ,
  PLAN_PRICING_USD,
  PRICING_UNIT,
} from "../../utils/plan.js";

export const PLAN_DISPLAY_NAMES = {
  EMPRENDEDOR: "Conecta",
  NEGOCIO: "Impulsa",
  EMPRESA: "Expande",
};
export const TRIAL_PLAN = "EMPRENDEDOR";
export const TRIAL_SIGNUP_PATH = "/prueba/";
const rows = [
  ["rewards", "Puntos y recompensas"],
  ["staff_management", "Accesos para el equipo"],
  ["analytics", "Análisis de resultados"],
  ["lifecycle_automation", "Automatizaciones"],
  ["branded_qr", "QR con marca"],
  ["referrals", "Referidos"],
  ["webhooks", "Webhooks"],
  ["external_awards", "Puntos desde sistemas externos"],
];
/**
 * A plan as utils/plan.js listPlans describes it (utils owner). The price blocks are
 * optional so callers that still hand over the bare limits/features shape keep working.
 * @typedef {{
 *   plan: string,
 *   limits: { activeCustomers: number, branches: number, rewards: number },
 *   features: Record<string, boolean>,
 *   pricing_usd?: { monthly: number, gtq_monthly?: number },
 *   pricing_gtq?: { monthly: number }
 * }} PublicPlanDefinition
 * @typedef {ReturnType<typeof publicPlanCatalog>["plans"][number]} PublicPlanCatalogEntry
 * @typedef {{ trialDays?: number, gtqReference?: { rate: number, as_of: string } | null }} PublicPlanCatalogOptions
 */
/** @param {unknown} value */
const escape = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
/**
 * "Q300" / "Q1,030": fixed en-US grouping so the markup does not depend on ICU data.
 * @param {number} amount
 */
export const formatGtq = (amount) => `Q${Number(amount).toLocaleString("en-US")}`;
/** Short tax statement shared by the cards, the comparison table and the help copy. */
export const IVA_NOTE = "Precios con IVA (12 %) incluido.";
/**
 * The published catalog behind /precios and GET /api/public/plans: the quetzal list price
 * Guatemalan businesses pay and the USD price for businesses outside Guatemala, both per
 * branch per month and IVA-inclusive, the caps, the feature list and the trial call to
 * action. `pricing.monthly` stays the USD amount (wave-1 contract); `pricing.gtq_monthly`
 * carries the quetzal amount. Nothing provisional (provider message quotas) is exposed.
 * @param {PublicPlanDefinition[]} plans
 * @param {PublicPlanCatalogOptions} [options]
 */
export function publicPlanCatalog(plans, { trialDays = 14, gtqReference = null } = {}) {
  const reference =
    gtqReference && Number(gtqReference.rate) > 0 && gtqReference.as_of
      ? { rate: Number(gtqReference.rate), as_of: String(gtqReference.as_of) }
      : null;
  return {
    pricing_status: "published",
    comparison_currency: "USD",
    local_currency: "GTQ",
    pricing_unit: PRICING_UNIT,
    published_at: DEFAULT_BILLING_CATALOG.published_at,
    tax: { iva_included: true, rate: IVA_RATE },
    // Informational only (API compatibility): the dated reference rate a platform admin may
    // record. The fixed quetzal list price is what /precios shows and what is charged.
    reference_gtq: reference,
    trial: {
      days: trialDays,
      plan: TRIAL_PLAN,
      plan_name: PLAN_DISPLAY_NAMES[TRIAL_PLAN],
      requires_card: false,
      url: TRIAL_SIGNUP_PATH,
    },
    plans: plans
      .filter((p) => Object.hasOwn(PLAN_DISPLAY_NAMES, p.plan))
      .map((p) => {
        // The filter above keeps only known plan keys.
        const id = /** @type {keyof typeof PLAN_DISPLAY_NAMES} */ (p.plan);
        const monthly = Number(p.pricing_usd?.monthly ?? PLAN_PRICING_USD[id]);
        const gtqMonthly = Number(
          p.pricing_gtq?.monthly ?? p.pricing_usd?.gtq_monthly ?? PLAN_PRICING_GTQ[id],
        );
        return {
          id,
          name: PLAN_DISPLAY_NAMES[id],
          pricing: {
            currency: "USD",
            per: PRICING_UNIT,
            monthly,
            gtq_monthly: gtqMonthly,
            reference_gtq_monthly: reference ? Math.round(monthly * reference.rate) : null,
          },
          limits: {
            activeCustomers: p.limits.activeCustomers,
            branches: p.limits.branches,
            rewards: p.limits.rewards,
          },
          features: Object.fromEntries(rows.map(([key]) => [key, Boolean(p.features[key])])),
          feature_list: rows.filter(([key]) => p.features[key]).map(([, label]) => label),
          cta: {
            trial_url: id === TRIAL_PLAN ? TRIAL_SIGNUP_PATH : `${TRIAL_SIGNUP_PATH}?plan=${id}`,
            trial_label:
              id === TRIAL_PLAN
                ? `Prueba ${trialDays} días gratis`
                : `Empezar con ${PLAN_DISPLAY_NAMES[id]}`,
            contact_url: "/#contacto",
          },
        };
      }),
  };
}
/** @param {ReturnType<typeof publicPlanCatalog>} catalog */
export function renderPlanComparison(catalog) {
  const ps = catalog.plans,
    cell = (/** @type {unknown} */ value) => `<td>${escape(value)}</td>`,
    row = (
      /** @type {string} */ name,
      /** @type {(plan: PublicPlanCatalogEntry) => unknown} */ fn,
    ) => `<tr><th scope="row">${name}</th>${ps.map((p) => cell(fn(p))).join("")}</tr>`;
  // Guatemalan audience first: the quetzal list price leads, the USD price for businesses
  // outside Guatemala follows, and the tax row states that both include IVA. The dated
  // reference rate (`reference_gtq`) is not rendered: the quetzal amount is a fixed price.
  return `<div class="comparison-scroll" role="region" aria-label="Comparación de planes" tabindex="0"><table class="plan-comparison"><caption>Elige el alcance que necesita tu negocio</caption><thead><tr><th scope="col">Incluye</th>${ps.map((p) => `<th scope="col">${escape(p.name)}</th>`).join("")}</tr></thead><tbody>${row("Precio en Guatemala", (p) => `${formatGtq(p.pricing.gtq_monthly)} al mes por sucursal`)}${row("Fuera de Guatemala", (p) => `USD ${p.pricing.monthly} al mes por sucursal`)}${row("Impuestos", () => (catalog.tax.iva_included ? "IVA (12 %) incluido" : "Más IVA"))}${row("Clientes activos", (p) => (p.id === "EMPRESA" ? "Confirmar alcance" : `Hasta ${p.limits.activeCustomers}`))}${row("Sucursales", (p) => (p.id === "EMPRESA" ? "Confirmar alcance" : `Hasta ${p.limits.branches}`))}${row("Recompensas configuradas", (p) => (p.limits.rewards > 1000 ? "Confirmar alcance" : `Hasta ${p.limits.rewards}`))}${rows.map(([key, label]) => row(label, (p) => (p.features[key] ? "Incluido" : "No incluido"))).join("")}<tr><th scope="row">Para empezar</th>${ps.map((p) => `<td><a class="text-link" href="${escape(p.cta.trial_url)}" data-umami-event="trial_start_click" data-umami-event-location="precios" data-umami-event-plan="${p.id}">${escape(p.cta.trial_label)}<span class="sr-only"> (${escape(p.name)}, ${catalog.trial.days} días sin tarjeta)</span></a></td>`).join("")}</tr><tr><th scope="row">¿Dudas?</th>${ps.map((p) => `<td><a class="text-link" href="${escape(p.cta.contact_url)}" data-umami-event="plan_quote" data-umami-event-plan="${p.id}">Hablar con nosotros<span class="sr-only"> sobre ${escape(p.name)}</span></a></td>`).join("")}</tr></tbody></table></div>`;
}
