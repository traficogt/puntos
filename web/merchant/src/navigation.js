const fragments = {
  overview: "resumen",
  progress: "tu-progreso",
  customers: "clientes",
  team: "personal",
  branches: "sucursales",
  settings: "configuracion",
  // Plan y facturación (self-serve trial wave 2); Recurrente returns to #plan?checkout=…
  plan: "plan",
  decisions: "decisiones",
  cases: "casos",
  demand: "pedidos-de-clientes",
  funding: "proveedores",
  authority: "equipo",
  hospitality: "cortesias",
  promises: "promesas",
  region: "region",
  transactions: "movimientos",
  launch: "preparar",
  migration: "importar-clientes",
  audiences: "audiencias",
  campaigns: "campanas",
  recovery: "recuperar-clientes",
  referrals: "referidos",
  pos: "conectar-caja",
  growth: "ofertas",
  brand: "marca",
  operations: "operacion",
  pilot: "piloto",
  acquisition: "origenes",
  economics: "costos",
  fulfillment: "canjes",
  rewards: "recompensas",
  automations: "automatizaciones",
  reports: "reportes",
  limits: "limites",
  tiers: "niveles",
  gamification: "logros-y-retos",
  giftcards: "tarjetas-de-regalo",
  branding: "identidad",
  onboarding: "puesta-en-marcha",
  // operations (wave 15b)
  jobs: "trabajos",
  alerts: "alertas",
  ledger: "conciliacion",
  audit: "auditoria",
  // analytics (wave 15a)
  analytics: "analitica",
  redemptions: "canjes-por-recompensa",
};
export const merchantPages = Object.keys(fragments);
export function pageFromHash(hash) {
  // A hash may carry a query (`#plan?checkout=…`, the payment return); the page is the part before it.
  const value = hash.replace(/^#/, "").split("?")[0];
  return (
    Object.keys(fragments).find(
      (key) => fragments[key] === value || key === value,
    ) || (value ? null : "overview")
  );
}
export function hashForPage(page) {
  return `#${fragments[page] || fragments.overview}`;
}
