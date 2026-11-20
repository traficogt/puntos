// Business-type presets for guided onboarding. Each applies a WORKING program
// in one click: `program` is a LaunchProgramInput body (PUT /api/admin/launch/
// program, the same path LaunchProgramEditor uses) and `rewards` are starter
// rewards created via POST /api/admin/reward-workspace. STAMP programs create
// their own reward on the server (ensureStampReward), so they list none here.
// The owner can edit everything afterwards; these are sensible defaults, not
// prescriptions.
export const programPresets = [
  {
    key: "cafe",
    label: "Cafetería",
    emoji: "☕",
    summary: "Tarjeta de sellos: junta sellos y llévate uno gratis.",
    program: { program_type: "STAMP", stamps_required: 8, head_start: 2, reward_label: "Bebida gratis", stamp_unit: "visit" },
  },
  {
    key: "restaurante",
    label: "Restaurante",
    emoji: "🍽️",
    summary: "Puntos por lo que gasta cada cliente, canjeables por premios.",
    program: { program_type: "SPEND", rate: 0.1, round: "ceil" },
    rewards: [
      { name: "Postre gratis", points_cost: 120, description: "Un postre de la casa" },
      { name: "10% de descuento", points_cost: 90, description: "Descuento en la cuenta" },
    ],
  },
  {
    key: "retail",
    label: "Tienda / Retail",
    emoji: "🛍️",
    summary: "Cashback: cada compra deja saldo para la próxima.",
    program: { program_type: "CASHBACK", cashback_percent: 5 },
  },
  {
    key: "salon",
    label: "Salón / Belleza",
    emoji: "💇",
    summary: "Puntos por visita, canjeables por servicios.",
    program: { program_type: "VISIT", rate: 10 },
    rewards: [
      { name: "Tratamiento de cortesía", points_cost: 100, description: "Un tratamiento especial" },
      { name: "20% de descuento", points_cost: 180, description: "Descuento en tu servicio" },
    ],
  },
  {
    key: "lavado",
    label: "Lavado de autos",
    emoji: "🚗",
    summary: "Tarjeta de sellos: varios lavados y uno gratis.",
    program: { program_type: "STAMP", stamps_required: 6, head_start: 1, reward_label: "Lavado gratis", stamp_unit: "visit" },
  },
  {
    key: "otro",
    label: "Otro negocio",
    emoji: "🏷️",
    summary: "Puntos por compra, lo más común para empezar.",
    program: { program_type: "SPEND", rate: 0.1, round: "ceil" },
    rewards: [
      { name: "Premio para clientes frecuentes", points_cost: 100, description: "Define el premio que prefieras" },
    ],
  },
];
