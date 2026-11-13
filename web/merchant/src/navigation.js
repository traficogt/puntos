const fragments = {
  overview: "resumen",
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
};
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
