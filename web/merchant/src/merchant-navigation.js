// Keep each page in one place. Routes and legacy aliases remain in navigation.js.
export const dailyNavigation = [
  { page: "overview", label: "Resumen" },
  { page: "decisions", label: "Decisiones" },
  { page: "transactions", label: "Movimientos" },
  { page: "fulfillment", label: "Canjes y caja" },
  { page: "cases", label: "Atención al cliente" },
];

export const navigationGroups = [
  {
    id: "customers",
    label: "Clientes y ventas",
    items: [
      { page: "customers", label: "Clientes" },
      { page: "recovery", label: "Recuperar clientes" },
      { page: "audiences", label: "Audiencias" },
      { page: "growth", label: "Campañas dirigidas" },
      { page: "referrals", label: "Recomendaciones" },
      { page: "acquisition", label: "Origen de clientes" },
      { page: "demand", label: "Pedidos de clientes" },
      { page: "migration", label: "Importar clientes" },
    ],
  },
  {
    id: "program",
    label: "Programa y recompensas",
    items: [
      { page: "launch", label: "Preparar mi programa" },
      { page: "rewards", label: "Recompensas y catálogo" },
      { page: "campaigns", label: "Reglas de puntos" },
      { page: "automations", label: "Automatizaciones" },
      { page: "promises", label: "Promesas de recompensa" },
      { page: "hospitality", label: "Cortesías del equipo" },
    ],
  },
  {
    id: "analysis",
    label: "Análisis y costos",
    items: [
      { page: "economics", label: "Costos y margen" },
      { page: "funding", label: "Financiamiento de proveedores" },
      { page: "pilot", label: "Mi piloto" },
    ],
  },
  {
    id: "settings",
    label: "Configuración y equipo",
    items: [
      { page: "settings", label: "Configuración" },
      { page: "team", label: "Personal" },
      { page: "branches", label: "Sucursales" },
      { page: "authority", label: "Equipo y permisos" },
      { page: "brand", label: "Marca y QR" },
      { page: "pos", label: "Conectar caja" },
      { page: "operations", label: "Estado de la operación" },
      { page: "region", label: "Región del negocio" },
    ],
  },
];
