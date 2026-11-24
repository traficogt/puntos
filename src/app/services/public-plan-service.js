export const PLAN_DISPLAY_NAMES = {
  EMPRENDEDOR: "Conecta",
  NEGOCIO: "Impulsa",
  EMPRESA: "Expande",
};
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
 * A plan as utils/plan.js listPlans describes it (utils owner).
 * @typedef {{
 *   plan: string,
 *   limits: { activeCustomers: number, branches: number, rewards: number },
 *   features: Record<string, boolean>
 * }} PublicPlanDefinition
 * @typedef {ReturnType<typeof publicPlanCatalog>["plans"][number]} PublicPlanCatalogEntry
 */
/** @param {unknown} value */
const escape = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
/** @param {PublicPlanDefinition[]} plans */
export function publicPlanCatalog(plans) {
  return {
    pricing_status: "quotation",
    comparison_currency: "USD",
    plans: plans
      .filter((p) => Object.hasOwn(PLAN_DISPLAY_NAMES, p.plan))
      .map((p) => ({
        id: p.plan,
        // The filter above keeps only known plan keys.
        name: PLAN_DISPLAY_NAMES[/** @type {keyof typeof PLAN_DISPLAY_NAMES} */ (p.plan)],
        limits: {
          activeCustomers: p.limits.activeCustomers,
          branches: p.limits.branches,
          rewards: p.limits.rewards,
        },
        features: Object.fromEntries(rows.map(([key]) => [key, Boolean(p.features[key])])),
      })),
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
  return `<div class="comparison-scroll" role="region" aria-label="Comparación de planes" tabindex="0"><table class="plan-comparison"><caption>Elige el alcance que necesita tu negocio</caption><thead><tr><th scope="col">Incluye</th>${ps.map((p) => `<th scope="col">${escape(p.name)}</th>`).join("")}</tr></thead><tbody>${row("Clientes activos", (p) => (p.id === "EMPRESA" ? "Confirmar alcance" : `Hasta ${p.limits.activeCustomers}`))}${row("Sucursales", (p) => (p.id === "EMPRESA" ? "Confirmar alcance" : `Hasta ${p.limits.branches}`))}${row("Recompensas configuradas", (p) => (p.limits.rewards > 1000 ? "Confirmar alcance" : `Hasta ${p.limits.rewards}`))}${rows.map(([key, label]) => row(label, (p) => (p.features[key] ? "Incluido" : "No incluido"))).join("")}<tr><th scope="row">Moneda y condiciones</th>${ps.map(() => cell("Según cotización")).join("")}</tr><tr><th scope="row">Siguiente paso</th>${ps.map((p) => `<td><a class="text-link" href="/#contacto" data-umami-event="plan_quote" data-umami-event-plan="${p.id}">Solicitar cotización<span class="sr-only"> de ${escape(p.name)}</span></a></td>`).join("")}</tr></tbody></table></div>`;
}
