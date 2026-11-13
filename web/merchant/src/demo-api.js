import {demoServiceCompletion} from './demo-service-completion.js';
import {demoDemandFunding} from './demo-demand-funding.js';
import {demoEvidenceHealth} from './demo-evidence-health.js';
import {demoRewardWorkspace} from './demo-reward-workspace.js';
import { demoFulfillment } from './demo-fulfillment.js';
import { demoImportJobs } from './demo-import-jobs.js';
import { demoRewardHospitality } from './demo-reward-hospitality.js';
import { demoWalletLocations } from './demo-wallet-locations.js';
import { demoRegion } from './demo-region.js';
import { demoDecisions } from "./demo-decisions.js";
import { demoServiceCases } from "./demo-service-cases.js";
import { demoStaffDelegation } from "./demo-staff-delegation.js";
import { demoTransactions } from "./demo-transactions.js";
import { demoMigration } from "./demo-migration.js";
import { demoAudiences } from "./demo-audiences.js";
import { demoLaunchProgram } from "./demo-launch.js";
import { demoAutomations } from "./demo-automations.js";
import { demoAcquisition } from "./demo-acquisition.js";
import { demoEconomics } from "./demo-economics.js";
import { demoOperations } from "./demo-operations.js";
import { demoPilots } from "./demo-pilots.js";
import { demoGrowth } from "./demo-growth.js";
import { demoReferrals } from "./demo-referrals.js";
import { demoPos } from "./demo-pos.js";
import { demoRecovery } from "./demo-recovery.js";
import { demoRedemptionReturns } from "./demo-redemption-returns.js";
// Synthetic, browser-only preview. No request in this module reaches a PF API.
const businessId = "11111111-1111-4111-8111-111111111111";
const branchId = "22222222-2222-4222-8222-222222222222";
let rules = [
  {
    id: "demo-weekend",
    name: "Doble puntos el fin de semana",
    active: false,
    kind: "multiplier",
    value: 2,
    condition: { weekdays: [0, 6] },
  },
];
const business = {
  id: businessId,
  name: "Café Jacaranda · demo",
  slug: "cafe-jacaranda-demo",
};
function overview(url) {
  const days = [7, 30, 90].includes(Number(url.searchParams.get("days")))
    ? Number(url.searchParams.get("days"))
    : 30;
  const branch = url.searchParams.get("branch_id");
  const scale = branch ? 0.55 : 1;
  const end = new Date("2026-11-10T18:00:00Z");
  const start = new Date(Date.UTC(2026, 10, 11 - days, 6));
  const daily = Array.from({ length: days }, (_, index) => {
    const purchases = Math.round((12 + ((index * 7) % 19)) * scale);
    return {
      date: new Date(start.getTime() + index * 86400000)
        .toISOString()
        .slice(0, 10),
      purchases,
      recorded_sales_q: purchases * (42 + ((index * 3) % 18)),
    };
  });
  const purchases = daily.reduce((sum, row) => sum + row.purchases, 0);
  const sales = daily.reduce((sum, row) => sum + row.recorded_sales_q, 0);
  const active = Math.round(purchases / 1.6),
    repeat = Math.round(active * 0.375);
  const redemptions = Math.round(purchases * 0.1);
  const current = {
    recorded_sales_q: sales,
    purchases,
    active_customers: active,
    repeat_customers: repeat,
    repeat_rate_pct: Math.round((10000 * repeat) / active) / 100,
    average_ticket_q: Math.round((100 * sales) / purchases) / 100,
    redemptions,
  };
  return {
    ok: true,
    generated_at: end.toISOString(),
    timezone: "America/Guatemala",
    currency: "GTQ",
    scope: { branch_id: branch || null },
    period: {
      days,
      start: start.toISOString(),
      end: end.toISOString(),
      previous_start: new Date(start.getTime() - days * 86400000).toISOString(),
      previous_end: new Date(end.getTime() - days * 86400000).toISOString(),
    },
    current,
    previous: {
      ...current,
      recorded_sales_q: Math.round(sales * 0.83),
      purchases: Math.round(purchases * 0.85),
      active_customers: Math.round(active * 0.9),
      repeat_customers: Math.round(active * 0.27),
      repeat_rate_pct: 30,
      average_ticket_q: 48,
      redemptions: Math.round(redemptions * 0.75),
    },
    daily,
    rewards: [
      {
        name: "Café de la casa",
        redemptions: Math.round(redemptions * 0.7),
        points_redeemed: Math.round(redemptions * 0.7) * 100,
      },
      {
        name: "Pan artesanal",
        redemptions: redemptions - Math.round(redemptions * 0.7),
        points_redeemed: (redemptions - Math.round(redemptions * 0.7)) * 80,
      },
    ],
    notes: [
      "Datos ficticios de demostración. No corresponden a clientes, ventas ni resultados reales.",
    ],
  };
}
export async function demoApi(path, options = {}) {
  if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const url = new URL(path, "https://preview.invalid");
  if(url.pathname==='/api/admin/data-health'||url.pathname==='/api/admin/transaction-rejections'||url.pathname.startsWith('/api/admin/analytics/ledger-corrections'))return demoEvidenceHealth(url,options);
  if (['/api/admin/demand-notebook','/api/admin/supplier-funding'].some(prefix=>url.pathname.startsWith(prefix))) return demoDemandFunding(url,options);
  if (url.pathname.startsWith('/api/admin/service-operations')) return demoServiceCompletion(url,options);
  const method = options.method || "GET";
  if (["/api/admin/reward-workspace", "/api/admin/merchant-catalog", "/api/admin/pos-checkout/sources"].some(prefix=>url.pathname.startsWith(prefix))) return structuredClone(demoRewardWorkspace(url, options));
  if (url.pathname.startsWith('/api/admin/customer-import-jobs')) return structuredClone(demoImportJobs(url,options));
  if(url.pathname==='/api/admin/branches/wallet-locations'||/^\/api\/admin\/branches\/[^/]+\/wallet-location$/.test(url.pathname)) return structuredClone(demoWalletLocations(url,options));
  if (url.pathname === '/api/admin/region') return structuredClone(demoRegion(url,options));
  if (url.pathname.startsWith('/api/admin/reward-promises') || url.pathname.startsWith('/api/admin/hospitality')) return structuredClone(demoRewardHospitality(url,options));
  if (url.pathname.startsWith('/api/admin/decisions')) return structuredClone(demoDecisions(url,options));
  if (url.pathname.startsWith('/api/admin/service-cases') || url.pathname.startsWith('/api/admin/service-redemptions')) return structuredClone(demoServiceCases(url,options));
  if (url.pathname.startsWith('/api/admin/staff-authority') || url.pathname.startsWith('/api/admin/shift-notices')) return structuredClone(demoStaffDelegation(url,options));
  if (url.pathname.startsWith('/api/admin/transaction-history')) return structuredClone(await demoTransactions(url,options));
  if (url.pathname.startsWith("/api/admin/redemption-pos") || url.pathname.startsWith("/api/admin/reward-pos-mappings")) return structuredClone(demoFulfillment(url, options));
  if (url.pathname === "/api/admin/operations-health" && method === "GET") return structuredClone(demoOperations());
  if (url.pathname === "/api/admin/pilots" || url.pathname.startsWith("/api/admin/pilots/")) return structuredClone(demoPilots(url, options));
  if (url.pathname === "/api/admin/growth-campaigns" || url.pathname.startsWith("/api/admin/growth-campaigns/")) return structuredClone(demoGrowth(url, options));
  if (url.pathname.startsWith("/api/admin/analytics/recovery/"))
    return structuredClone(demoRecovery(url, options));
  if (["/api/admin/referral-settings", "/api/admin/referral-growth"].includes(url.pathname)) return structuredClone(demoReferrals(url, options));
  if (["/api/admin/pos", "/api/admin/pos/preflight"].includes(url.pathname) || url.pathname.startsWith("/api/admin/pos/refunds")) return structuredClone(demoPos(url, options));
  if (url.pathname === "/api/admin/acquisition" || url.pathname.startsWith("/api/admin/acquisition/")) return structuredClone(demoAcquisition(url, options));
  if (url.pathname === "/api/admin/reward-economics/service-restorations") return {ok:true,restored_redemptions:2,restored_points:150,known_original_cost_q:7,unknown_original_costs:1};
  if (url.pathname === "/api/admin/reward-economics" || url.pathname.startsWith("/api/admin/reward-economics/")) return structuredClone(demoEconomics(url, options));
  if (url.pathname.startsWith("/api/admin/automations")) return structuredClone(demoAutomations(url, options));
  if (url.pathname === "/api/admin/launch/program") return structuredClone(demoLaunchProgram(options));
  if (url.pathname.startsWith("/api/admin/customer-migrations")) return structuredClone(demoMigration(url,options));
  if (url.pathname.startsWith("/api/admin/audiences")) return structuredClone(demoAudiences(url,options));
  let result;
  if (url.pathname === "/api/admin/campaign-rules" && method === "PUT") {
    const body = JSON.parse(options.body || "{}");
    if (!Array.isArray(body.rules))
      throw new Error("Reglas de demostración inválidas.");
    rules = structuredClone(body.rules);
    result = { ok: true, rules };
  } else if (method !== "GET")
    throw new Error("Esta acción no está disponible en la demostración.");
  else
    switch (url.pathname) {
      case "/api/staff/me":
        result = {
          staff: { id: "demo-owner", role: "OWNER", business_id: businessId },
        };
        break;
      case "/api/admin/plan":
        result = {
          plan: "NEGOCIO",
          features: {
            analytics: true,
            program_rules: true,
            lifecycle_automation: true,
            referrals: true,
            external_awards: true,
            campaign_rules: true,
            branded_qr: true,
            multi_branch: true,
          },
        };
        break;
      case "/api/admin/customer-enrollment":
        result = {
          business,
          registration_url:
            "https://app.puntosfieles.com/demostracion/#preparar",
        };
        break;
      case "/api/admin/branches":
        result = { branches: [{ id: branchId, name: "Zona 4 · demo" }] };
        break;
      case "/api/admin/analytics/overview":
        result = overview(url);
        break;
      case "/api/admin/analytics/redemption-returns":
        result = demoRedemptionReturns(url);
        break;
      case "/api/admin/program":
        result = { program_type: "SPEND", program_json: { points_per_q: 0.1 } };
        break;
      case "/api/admin/rewards":
        result = {
          rewards: [
            {
              id: "demo-coffee",
              name: "Café de la casa",
              active: true,
              stock: 100,
              points_cost: 100,
            },
            {
              id: "demo-bread",
              name: "Pan artesanal",
              active: true,
              stock: 50,
              points_cost: 80,
            },
          ],
        };
        break;
      case "/api/admin/campaign-rules":
        result = { rules, timezone: "America/Guatemala" };
        break;
      default:
        throw new Error("Esta acción no está disponible en la demostración.");
    }
  return structuredClone(result);
}
