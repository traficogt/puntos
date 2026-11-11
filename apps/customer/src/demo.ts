import type { Snapshot } from "./model";
export const demo: Snapshot = {
  business: {
    id: "sample-business",
    name: "Café Bourbon",
    slug: "ejemplo",
    customer_branding: {
      customer_program_name: "Café Bourbon",
      primary_color: "#A43D28",
    },
    features: { rewards: true },
  },
  customer: {
    id: "sample-customer",
    name: "Ana",
    points: 340,
    pending_points: 0,
    lifetime_points: 1140,
  },
  rewards: [
    {
      id: "r1",
      name: "Un café, por nuestra cuenta",
      description: "Tu americano favorito, recién preparado.",
      points_cost: 400,
    },
    {
      id: "r2",
      name: "Algo rico para acompañar",
      description: "Una pieza de repostería del día.",
      points_cost: 600,
    },
    {
      id: "r3",
      name: "Un momento para dos",
      description: "Dos bebidas para compartir una buena conversación.",
      points_cost: 900,
    },
  ],
  transactions: [
    {
      id: "t1",
      points_delta: 40,
      amount_q: "40.00",
      created_at: "2026-11-09T16:30:00-06:00",
      source: "purchase",
    },
    {
      id: "t2",
      points_delta: 60,
      amount_q: "60.00",
      created_at: "2026-11-06T09:20:00-06:00",
      source: "purchase",
    },
    {
      id: "t3",
      points_delta: -400,
      created_at: "2026-11-02T10:10:00-06:00",
      source: "redemption",
      reward_name: "Americano gratis",
    },
  ],
  redemptions: [],
  wallet: { providers: { apple: true, google: true }, passes: [] },
};
