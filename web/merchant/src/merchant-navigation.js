// Keep each page in one place. Routes and legacy aliases remain in navigation.js.
// Organised around what an owner is trying to DO, not around the system's
// internals. The first groups cover the everyday job; rarely-touched power
// tools live under "Avanzado" so the main flow stays small and legible.
export const dailyNavigation = [
  { page: "overview", label: "Inicio" },
  { page: "fulfillment", label: "Canjes y caja" },
  { page: "cases", label: "Atención al cliente" },
];

export const navigationGroups = [
  {
    id: "program",
    label: "Mi programa",
    items: [
      { page: "launch", label: "Preparar mi programa" },
      { page: "rewards", label: "Recompensas y catálogo" },
      { page: "campaigns", label: "Reglas de puntos" },
      { page: "automations", label: "Notificaciones automáticas" },
    ],
  },
  {
    id: "customers",
    label: "Clientes",
    items: [
      { page: "customers", label: "Clientes" },
      { page: "recovery", label: "Recuperar clientes" },
      { page: "referrals", label: "Recomendaciones" },
      { page: "transactions", label: "Movimientos" },
    ],
  },
  {
    id: "grow",
    label: "Hacer crecer",
    items: [
      { page: "growth", label: "Campañas y ofertas" },
      { page: "audiences", label: "Audiencias" },
      { page: "acquisition", label: "Origen de clientes" },
    ],
  },
  {
    id: "team",
    label: "Caja, equipo y ajustes",
    advanced: true,
    items: [
      { page: "team", label: "Personal" },
      { page: "authority", label: "Permisos del equipo" },
      { page: "branches", label: "Sucursales" },
      { page: "brand", label: "Marca y QR" },
      { page: "pos", label: "Conectar caja" },
      { page: "settings", label: "Configuración" },
      { page: "region", label: "Región del negocio" },
    ],
  },
  {
    id: "advanced",
    label: "Avanzado",
    advanced: true,
    items: [
      { page: "decisions", label: "Decisiones automáticas" },
      { page: "economics", label: "Costos y margen" },
      { page: "funding", label: "Financiamiento de proveedores" },
      { page: "promises", label: "Promesas de recompensa" },
      { page: "hospitality", label: "Cortesías del equipo" },
      { page: "demand", label: "Pedidos de clientes" },
      { page: "migration", label: "Importar clientes" },
      { page: "pilot", label: "Mi piloto" },
      { page: "operations", label: "Estado de la operación" },
    ],
  },
];

// Public demo: a small, sales-focused subset of the full operator surface.
// Order tells the loyalty story; operator/admin screens are intentionally left
// out so a first-time visitor is not overwhelmed.
export const demoNavigation = [
  { page: "overview", label: "Inicio" },
  { page: "launch", label: "Preparar mi programa" },
  { page: "rewards", label: "Recompensas" },
  { page: "automations", label: "Notificaciones automáticas" },
  { page: "customers", label: "Clientes" },
  { page: "recovery", label: "Recuperar clientes" },
  { page: "growth", label: "Campañas y ofertas" },
  { page: "brand", label: "Marca y QR" },
  { page: "fulfillment", label: "Canjes y caja" },
];

// Plan features each page requires to be usable (ALL must be present). Derived
// from the components' own lock checks (Campaigns, Automations, Recovery,
// Referrals, GrowthCampaigns, Audiences, OwnerTeam, OwnerBranches, BrandedQr,
// PosConnect, Economics, Pilot). Pages not listed are core and always shown —
// including overview/launch/rewards/customers/settings/acquisition, which only
// lock a sub-widget, not the whole page.
export const pageFeatures = {
  campaigns: ["campaign_rules"],
  automations: ["lifecycle_automation"],
  recovery: ["analytics"],
  referrals: ["referrals"],
  growth: ["campaign_rules", "analytics"],
  audiences: ["analytics", "campaign_rules"],
  team: ["staff_management"],
  branches: ["multi_branch"],
  brand: ["branded_qr"],
  pos: ["external_awards"],
  economics: ["analytics"],
  pilot: ["analytics"],
};
