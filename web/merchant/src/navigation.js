const fragments = {
  overview: "resumen",
  customers: "clientes",
  team: "personal",
  branches: "sucursales",
  settings: "configuracion",
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
};
export const merchantPages = Object.keys(fragments);
export function pageFromHash(hash) {
  const value = hash.replace(/^#/, "");
  return (
    Object.keys(fragments).find(
      (key) => fragments[key] === value || key === value,
    ) || (value ? null : "overview")
  );
}
export function hashForPage(page) {
  return `#${fragments[page] || fragments.overview}`;
}
