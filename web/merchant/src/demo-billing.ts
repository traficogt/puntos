// Synthetic, browser-only billing states for the public demo and the browser tests
// (docs/product/2026-11-25-self-serve-trial.md §4.4, §7.3). The scenario comes from `?plan=` on
// the demo URL, like `?prueba=` for the trial; without it GET /api/admin/billing answers 404 like
// a server that has not deployed the billing API, so the plan page shows the request form.
// Extension kept: demo-api.js is also loaded by Node tests, which cannot resolve extensionless imports.
import { isSubscriptionBillingPath, type CheckoutStatus, type PlanCode } from "./billing-model.ts";
import { PLAN_DISPLAY_NAMES, PLAN_PRICES_USD } from "./trial-model.ts";

export type DemoBillingScenario =
  "none" | "sin-cobro" | "pago-pendiente" | "activa" | "pago-fallido" | "cancelada";
export const DEMO_BILLING_PARAM = "plan";
export const DEMO_CHECKOUT_ID = "chk_demo_impulsa";
const SCENARIOS: readonly DemoBillingScenario[] = [
  "sin-cobro",
  "pago-pendiente",
  "activa",
  "pago-fallido",
  "cancelada",
];
/** Fixed clock so dates are stable in tests and screenshots (same instant as the trial demo). */
export const DEMO_BILLING_NOW = new Date("2026-11-25T15:00:00Z");
const DAY_MS = 86_400_000;
const PLAN_CODES: readonly PlanCode[] = ["EMPRENDEDOR", "NEGOCIO", "EMPRESA"];

export function demoBillingScenario(url: URL | null | undefined): DemoBillingScenario {
  const value = url?.searchParams.get(DEMO_BILLING_PARAM) ?? "";
  return (SCENARIOS as readonly string[]).includes(value) ? (value as DemoBillingScenario) : "none";
}

function iso(now: Date, offsetDays: number): string {
  return new Date(now.getTime() + offsetDays * DAY_MS).toISOString();
}

function catalog() {
  return {
    currency: "USD",
    plans: PLAN_CODES.map((id) => ({
      id,
      name: PLAN_DISPLAY_NAMES[id],
      unit_amount_minor: PLAN_PRICES_USD[id] * 100,
      monthly: PLAN_PRICES_USD[id],
    })),
  };
}

interface DemoSubscription {
  status: "trial" | "active" | "past_due" | "canceled";
  provider: "recurrente" | null;
  currency: "USD";
  plan: PlanCode;
  plan_name: string;
  quantity: number;
  unit_amount_minor: number;
  monthly_total_minor: number;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at: string | null;
  past_due_since: string | null;
  next_payment_attempt_at: string | null;
  latest_tax_invoice_url: string | null;
  upgrade_available: boolean;
  checkout_pending: { id: string; url: string; expires_at: string } | null;
}

function subscription(
  plan: PlanCode,
  quantity: number,
  now: Date,
  overrides: Partial<DemoSubscription>,
): DemoSubscription {
  const unit = PLAN_PRICES_USD[plan] * 100;
  return {
    status: "active",
    provider: "recurrente",
    currency: "USD",
    plan,
    plan_name: PLAN_DISPLAY_NAMES[plan],
    quantity,
    unit_amount_minor: unit,
    monthly_total_minor: unit * quantity,
    current_period_start: iso(now, -10),
    current_period_end: iso(now, 20),
    cancel_at: null,
    past_due_since: null,
    next_payment_attempt_at: null,
    latest_tax_invoice_url: "https://app.recurrente.com/demo/recibos/0002",
    upgrade_available: true,
    checkout_pending: null,
    ...overrides,
  };
}

/**
 * The hosted payment page of the demo is the demo itself: the "return URL" switches the
 * scenario to `activa` and carries the checkout id, so the owner app polls and confirms the
 * payment without leaving the page (no request reaches a PF API or Recurrente).
 */
export function demoCheckoutReturnUrl(href: string, checkoutId: string = DEMO_CHECKOUT_ID): string {
  const target = new URL(href);
  target.searchParams.set(DEMO_BILLING_PARAM, "activa");
  target.hash = `#plan?checkout=${encodeURIComponent(checkoutId)}&resultado=exito`;
  return target.pathname + target.search + target.hash;
}

export function createBillingDemoApi(
  scenario: DemoBillingScenario,
  now: Date = DEMO_BILLING_NOW,
  href: () => string = () =>
    typeof location !== "undefined" ? location.href : "https://preview.invalid/demostracion/",
) {
  const branches = 1;
  let current: DemoSubscription | null = null;
  let trialStatus: "active" | "converted" = "converted";
  let checkoutStatus: CheckoutStatus = "completed";
  switch (scenario) {
    case "sin-cobro":
      trialStatus = "active";
      current = subscription("EMPRENDEDOR", 1, now, {
        status: "trial",
        provider: null,
        unit_amount_minor: 0,
        monthly_total_minor: 0,
        current_period_start: null,
        current_period_end: null,
        latest_tax_invoice_url: null,
      });
      break;
    case "pago-pendiente":
      trialStatus = "active";
      checkoutStatus = "pending";
      current = subscription("EMPRENDEDOR", 1, now, {
        status: "trial",
        provider: null,
        unit_amount_minor: 0,
        monthly_total_minor: 0,
        current_period_start: null,
        current_period_end: null,
        latest_tax_invoice_url: null,
        checkout_pending: {
          id: DEMO_CHECKOUT_ID,
          url: demoCheckoutReturnUrl(href()),
          expires_at: iso(now, 1),
        },
      });
      break;
    case "activa":
      current = subscription("NEGOCIO", 1, now, {});
      break;
    case "pago-fallido":
      current = subscription("NEGOCIO", 1, now, {
        status: "past_due",
        past_due_since: iso(now, -2),
        next_payment_attempt_at: iso(now, 1),
        current_period_start: iso(now, -32),
        current_period_end: iso(now, -2),
      });
      break;
    case "cancelada":
      current = subscription("NEGOCIO", 1, now, { status: "canceled", cancel_at: iso(now, 20) });
      break;
    default:
      current = null;
  }
  const invoices =
    current && current.status !== "trial"
      ? [
          {
            occurred_at: iso(now, -10),
            amount_minor: 7900,
            currency: "USD",
            status: current.status === "past_due" ? "failed" : "paid",
            tax_invoice_url:
              current.status === "past_due" ? null : "https://app.recurrente.com/demo/recibos/0002",
          },
          {
            occurred_at: iso(now, -40),
            amount_minor: 7900,
            currency: "USD",
            status: "paid",
            tax_invoice_url: "https://app.recurrente.com/demo/recibos/0001",
          },
        ]
      : [];

  function trialResponse(): Record<string, unknown> {
    const sub = current as DemoSubscription;
    return {
      ok: true,
      plan: sub.plan,
      plan_name: sub.plan_name,
      trial:
        trialStatus === "active"
          ? {
              status: "active",
              started_at: iso(now, -5),
              ends_at: iso(now, 9),
              days_left: 9,
              upgrade_available: true,
              upgrade_url: "/negocio/#plan",
            }
          : {
              status: "converted",
              started_at: iso(now, -40),
              ends_at: iso(now, -26),
              days_left: 0,
              upgrade_available: true,
              upgrade_url: "/negocio/#plan",
            },
      billing: {
        status: sub.status === "trial" ? "trialing" : sub.status,
        currency: sub.provider ? sub.currency : null,
        provider: sub.provider,
        subscription: sub.provider
          ? {
              plan: sub.plan,
              quantity: sub.quantity,
              currency: sub.currency,
              unit_amount_minor: sub.unit_amount_minor,
              status: sub.status,
              current_period_end: sub.current_period_end,
              cancel_at: sub.cancel_at,
            }
          : null,
        purge_after: null,
        upgrade_available: true,
      },
    };
  }

  function body(options: RequestInit): Record<string, unknown> {
    return typeof options.body === "string" && options.body
      ? (JSON.parse(options.body) as Record<string, unknown>)
      : {};
  }

  return (url: URL, options: RequestInit = {}): unknown => {
    const method = String(options.method || "GET").toUpperCase();
    const path = url.pathname;
    if (!isSubscriptionBillingPath(path) && path !== "/api/admin/trial") return undefined;
    if (!current) {
      if (isSubscriptionBillingPath(path))
        throw Object.assign(new Error("No encontrado"), { status: 404 });
      return undefined;
    }
    if (path === "/api/admin/trial" && method === "GET") return trialResponse();
    if (path === "/api/admin/billing" && method === "GET")
      return {
        ok: true,
        billing: structuredClone(current),
        catalog: catalog(),
        branches,
        trial:
          trialStatus === "active"
            ? { status: "active", days_left: 9, ends_at: iso(now, 9) }
            : { status: "converted", days_left: 0, ends_at: iso(now, -26) },
      };
    if (path === "/api/admin/billing/checkout" && method === "POST") {
      const plan = String(body(options).plan ?? "").toUpperCase() as PlanCode;
      if (!PLAN_CODES.includes(plan))
        throw Object.assign(new Error("Plan inválido"), {
          status: 400,
          code: "BILLING_PLAN_INVALID",
        });
      if (current.status === "active")
        throw Object.assign(new Error("Ya tienes un plan activo"), {
          status: 409,
          code: "BILLING_ALREADY_ACTIVE",
        });
      const id = `${DEMO_CHECKOUT_ID}_${plan.toLowerCase()}`;
      return {
        ok: true,
        checkout: { id, url: demoCheckoutReturnUrl(href(), id), expires_at: iso(now, 1) },
      };
    }
    if (path.startsWith("/api/admin/billing/checkout/") && method === "GET") {
      const id = decodeURIComponent(path.slice("/api/admin/billing/checkout/".length));
      if (!id.startsWith(DEMO_CHECKOUT_ID))
        throw Object.assign(new Error("No encontramos ese pago."), { status: 404 });
      return {
        ok: true,
        status: checkoutStatus,
        subscription:
          checkoutStatus === "completed"
            ? {
                plan: current.plan,
                plan_name: current.plan_name,
                quantity: current.quantity,
                status: current.status,
                current_period_end: current.current_period_end,
              }
            : null,
      };
    }
    if (path === "/api/admin/billing/change" && method === "POST") {
      const plan = String(body(options).plan ?? "").toUpperCase() as PlanCode;
      if (!PLAN_CODES.includes(plan))
        throw Object.assign(new Error("Plan inválido"), {
          status: 400,
          code: "BILLING_PLAN_INVALID",
        });
      if (current.status !== "active")
        throw Object.assign(new Error("No hay una suscripción activa que cambiar."), {
          status: 409,
        });
      const upgrade = PLAN_CODES.indexOf(plan) > PLAN_CODES.indexOf(current.plan);
      if (upgrade)
        current = subscription(plan, current.quantity, now, {
          current_period_start: current.current_period_start,
          current_period_end: current.current_period_end,
        });
      return {
        ok: true,
        subscription: structuredClone({ ...current, plan, plan_name: PLAN_DISPLAY_NAMES[plan] }),
      };
    }
    if (path === "/api/admin/billing/cancel" && method === "POST") {
      if (current.status !== "active" && current.status !== "past_due")
        throw Object.assign(new Error("No hay una suscripción activa que cancelar."), {
          status: 409,
        });
      current = { ...current, status: "canceled", cancel_at: current.current_period_end };
      return { ok: true, subscription: structuredClone(current) };
    }
    if (path === "/api/admin/billing/invoices" && method === "GET")
      return { ok: true, invoices: structuredClone(invoices) };
    if (isSubscriptionBillingPath(path))
      throw Object.assign(new Error("Esta acción no está disponible en la demostración."), {
        status: 404,
      });
    return undefined;
  };
}

const pageScenario =
  typeof location !== "undefined" ? demoBillingScenario(new URL(location.href)) : "none";
const shared = createBillingDemoApi(pageScenario);
export function demoBilling(url: URL, options: RequestInit = {}): unknown {
  return shared(url, options);
}
