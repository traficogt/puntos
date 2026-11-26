// Subscription billing for the owner app (docs/product/2026-11-25-self-serve-trial.md §4.4,
// §4.5, §6, §7.3; wave 2, Recurrente). Pure helpers over the server contract:
//   GET  /api/admin/billing                → { ok, billing, catalog, branches, trial }
//   POST /api/admin/billing/checkout       → 201 { ok, checkout: { id, url, expires_at } }
//   GET  /api/admin/billing/checkout/:id   → { ok, status, subscription | null }
//   POST /api/admin/billing/change         → { ok, subscription }
//   POST /api/admin/billing/cancel         → { ok, subscription }
//   GET  /api/admin/billing/invoices       → { ok, invoices }
// A 404 (not deployed) or a 503 BILLING_UNAVAILABLE (provider unconfigured) leaves the page
// working with the wave-1 upgrade request form. Money travels in minor units (cents).

import { PLAN_DISPLAY_NAMES, PLAN_ORDER, planDisplayName } from "./trial-model.ts";

export type PlanCode = "EMPRENDEDOR" | "NEGOCIO" | "EMPRESA";
export type BillingCurrency = "USD" | "GTQ";
export type SubscriptionStatus = "none" | "trial" | "active" | "past_due" | "canceled" | "manual";
export type BillingProvider = "recurrente" | "manual" | null;
export type CheckoutStatus = "pending" | "completed" | "expired" | "canceled";
export type BillingTrialStatus = "none" | "active" | "expiring" | "locked" | "converted";
export type CheckoutResult = "exito" | "cancelado";

export interface CheckoutPending {
  id: string;
  url: string;
  expires_at: string | null;
}
export interface BillingSubscription {
  status: SubscriptionStatus;
  provider: BillingProvider;
  currency: BillingCurrency;
  plan: PlanCode | null;
  plan_name: string | null;
  quantity: number;
  unit_amount_minor: number | null;
  monthly_total_minor: number | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at: string | null;
  past_due_since: string | null;
  next_payment_attempt_at: string | null;
  latest_tax_invoice_url: string | null;
  upgrade_available: boolean;
  checkout_pending: CheckoutPending | null;
}
export interface CatalogPlan {
  id: PlanCode;
  name: string;
  unit_amount_minor: number;
  monthly: number;
}
export interface BillingCatalog {
  /** GTQ for Guatemalan businesses, USD outside Guatemala (server rule); the quotes follow it. */
  currency: BillingCurrency;
  /** Published amounts include IVA (owner decision 2026-11-26); the server says so explicitly. */
  iva_included: boolean;
  plans: CatalogPlan[];
}
export interface BillingTrial {
  status: BillingTrialStatus;
  days_left: number | null;
  ends_at: string | null;
}
export interface BillingView {
  billing: BillingSubscription;
  catalog: BillingCatalog;
  branches: number;
  trial: BillingTrial;
}
export interface PlanQuote {
  plan: PlanCode;
  name: string;
  currency: BillingCurrency;
  unit_amount_minor: number;
  quantity: number;
  total_minor: number;
  /** Conecta allows one branch; the quote says so instead of multiplying. */
  single_branch: boolean;
}
export interface Invoice {
  occurred_at: string | null;
  amount_minor: number;
  currency: BillingCurrency;
  status: string;
  tax_invoice_url: string | null;
}
export interface BillingReturn {
  checkoutId: string;
  result: CheckoutResult | null;
}
export type PollPhase =
  "polling" | "completed" | "expired" | "canceled" | "timeout" | "unavailable";
export interface PollState {
  checkoutId: string;
  phase: PollPhase;
  attempts: number;
  startedAt: number;
}
export type PollEvent =
  { kind: "response"; status: CheckoutStatus } | { kind: "error"; error: unknown };
export type PlanChangeKind = "upgrade" | "downgrade" | "same";
export type BillingTone = "blue" | "teal" | "orange" | "gray" | "red";
export interface StatusCopy {
  badge: string;
  color: BillingTone;
  title: string;
  body: string;
}
export interface ChangeCopy {
  kind: PlanChangeKind;
  title: string;
  body: string;
  confirm: string;
}

export const BILLING_UNAVAILABLE_MESSAGE = "El pago con tarjeta estará disponible pronto";
export const FEL_NOTE =
  "Por ahora no se emite factura electrónica (FEL); cada cobro queda registrado aquí.";
export const IVA_NOTE = "Precios con IVA incluido.";
export const CHECKOUT_RETURN_PAGE = "plan";
export const POLL_INTERVAL_MS = 3_000;
export const POLL_TIMEOUT_MS = 120_000;
/** Recurrente's initial-quantity limit (design §6). */
export const MAX_ONLINE_BRANCHES = 9;
const STATUSES: readonly SubscriptionStatus[] = [
  "none",
  "trial",
  "active",
  "past_due",
  "canceled",
  "manual",
];
const TRIAL_STATUSES: readonly BillingTrialStatus[] = [
  "none",
  "active",
  "expiring",
  "locked",
  "converted",
];
const CHECKOUT_STATUSES: readonly CheckoutStatus[] = [
  "pending",
  "completed",
  "expired",
  "canceled",
];
const CURRENCIES: readonly BillingCurrency[] = ["USD", "GTQ"];
const PLAN_CODES: readonly PlanCode[] = ["EMPRENDEDOR", "NEGOCIO", "EMPRESA"];
const CURRENCY_PREFIX: Readonly<Record<BillingCurrency, string>> = { USD: "USD ", GTQ: "Q" };
const BILLING_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  BILLING_UNAVAILABLE: `${BILLING_UNAVAILABLE_MESSAGE}. Mientras tanto, envíanos la solicitud y te contactamos para activar el plan.`,
  BILLING_PLAN_INVALID: "Ese plan no está disponible para pago en línea. Elige otro o escríbenos.",
  BILLING_QUANTITY_LIMIT: `El pago en línea cubre hasta ${MAX_ONLINE_BRANCHES} sucursales. Escríbenos para activar un plan con más sucursales.`,
  BILLING_ALREADY_ACTIVE:
    "Tu negocio ya tiene un plan activo. Vuelve a cargar la página para ver el estado actual.",
  BILLING_CURRENCY_UNAVAILABLE:
    "Esa moneda aún no está habilitada para pago en línea. Elige USD o escríbenos.",
  BILLING_CHECKOUT_NOT_FOUND:
    "No encontramos ese intento de pago. Vuelve a elegir el plan para generar uno nuevo.",
  BILLING_NO_SUBSCRIPTION:
    "Tu negocio no tiene una suscripción en línea. Elige un plan para empezar.",
  BILLING_PROVIDER_MISMATCH:
    "Tu plan se activó de forma manual. Escríbenos para cambiarlo o cancelarlo.",
  BILLING_PLAN_LIMITS:
    "Tu negocio supera los límites de ese plan (por ejemplo, sucursales). Ajusta primero o elige otro plan.",
  BILLING_PROVIDER_ERROR: "El procesador de pagos no respondió. Intenta de nuevo en unos minutos.",
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
function asInteger(value: unknown): number | null {
  const number = typeof value === "string" && value.trim() ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) ? Math.round(number) : null;
}
function asOneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  const text = typeof value === "string" ? value.trim() : "";
  const lower = text.toLowerCase();
  const upper = text.toUpperCase();
  const list = allowed as readonly string[];
  return list.includes(lower) ? (lower as T) : list.includes(upper) ? (upper as T) : null;
}
function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function planCode(value: unknown): PlanCode | null {
  return asOneOf(value, PLAN_CODES);
}

/**
 * The six wave-2 endpoints, and nothing else under /api/admin/billing (the merchant IVA export
 * `/api/admin/billing/iva.csv` predates them and belongs to analytics).
 */
export function isSubscriptionBillingPath(pathname: string): boolean {
  return /^\/api\/admin\/billing(?:\/(?:checkout(?:\/[^/]+)?|change|cancel|invoices))?$/.test(
    pathname,
  );
}

/**
 * "USD 79.00" / "USD 1,290.00" / "Q600.00". Minor units are cents for both currencies; the
 * grouping is fixed (en-US digits) so tests and screenshots do not depend on the ICU build.
 */
export function formatMinor(
  minor: number | null | undefined,
  currency: BillingCurrency | string | null | undefined,
): string {
  if (minor === null || minor === undefined || !Number.isFinite(minor)) return "—";
  const code = asOneOf(currency, CURRENCIES) ?? "USD";
  const sign = minor < 0 ? "−" : "";
  const units = Math.abs(Math.round(minor)) / 100;
  const text = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(units);
  return `${sign}${CURRENCY_PREFIX[code]}${text}`;
}

export function currencyLabel(currency: BillingCurrency | string | null | undefined): string {
  return asOneOf(currency, CURRENCIES) === "GTQ" ? "quetzales (GTQ)" : "dólares (USD)";
}

/**
 * Intro line of the plan picker: "Precio al mes por sucursal en quetzales (GTQ), con IVA
 * incluido; tu negocio tiene 2 sucursales." The tax clause follows the catalog flag.
 */
export function catalogPricingNote(view: Pick<BillingView, "catalog" | "branches">): string {
  const tax = view.catalog.iva_included ? "con IVA incluido" : "más IVA";
  const branches = `${view.branches} ${view.branches === 1 ? "sucursal" : "sucursales"}`;
  return `Precio al mes por sucursal en ${currencyLabel(view.catalog.currency)}, ${tax}; tu negocio tiene ${branches}.`;
}

function normalizeCatalog(raw: unknown, fallbackCurrency: BillingCurrency): BillingCatalog {
  const root = asRecord(raw);
  const currency = asOneOf(root?.currency, CURRENCIES) ?? fallbackCurrency;
  // Servers before 2026-11-26 did not send the flag; the published amounts were already
  // IVA-inclusive by then, so the default is true.
  const ivaIncluded = asBoolean(root?.iva_included) ?? true;
  const plans: CatalogPlan[] = [];
  const list = Array.isArray(root?.plans) ? root.plans : [];
  for (const entry of list) {
    const item = asRecord(entry);
    const id = planCode(item?.id ?? item?.plan);
    if (!item || !id || plans.some((plan) => plan.id === id)) continue;
    const monthly = asInteger(item.monthly);
    const unit = asInteger(item.unit_amount_minor) ?? (monthly !== null ? monthly * 100 : null);
    if (unit === null || unit <= 0) continue;
    plans.push({
      id,
      name: asString(item.name) ?? PLAN_DISPLAY_NAMES[id] ?? id,
      unit_amount_minor: unit,
      monthly: monthly ?? Math.round(unit / 100),
    });
  }
  plans.sort((a, b) => PLAN_ORDER.indexOf(a.id) - PLAN_ORDER.indexOf(b.id));
  return { currency, iva_included: ivaIncluded, plans };
}

/**
 * Accepts the GET /api/admin/billing body. Returns null when the payload carries no billing
 * block at all (a 404 body, a legacy response, garbage), which the view treats as "not deployed".
 */
export function normalizeBilling(payload: unknown): BillingView | null {
  const root = asRecord(payload);
  const node = asRecord(root?.billing);
  if (!root || !node) return null;
  const status = asOneOf(node.status, STATUSES);
  if (status === null) return null;
  const currency =
    asOneOf(node.currency, CURRENCIES) ??
    asOneOf(asRecord(root.catalog)?.currency, CURRENCIES) ??
    "USD";
  const plan = planCode(node.plan);
  const quantity = Math.max(1, asInteger(node.quantity) ?? 1);
  const unit = asInteger(node.unit_amount_minor);
  const providerText = asString(node.provider)?.toLowerCase() ?? null;
  const pendingNode = asRecord(node.checkout_pending);
  const pendingId = asString(pendingNode?.id);
  const pendingUrl = asString(pendingNode?.url);
  const trialNode = asRecord(root.trial);
  return {
    billing: {
      status,
      provider: providerText === "recurrente" || providerText === "manual" ? providerText : null,
      currency,
      plan,
      plan_name: asString(node.plan_name) ?? planDisplayName(plan),
      quantity,
      unit_amount_minor: unit,
      monthly_total_minor:
        asInteger(node.monthly_total_minor) ?? (unit !== null ? unit * quantity : null),
      current_period_start: asString(node.current_period_start),
      current_period_end: asString(node.current_period_end),
      cancel_at: asString(node.cancel_at),
      past_due_since: asString(node.past_due_since),
      next_payment_attempt_at: asString(node.next_payment_attempt_at),
      latest_tax_invoice_url: asString(node.latest_tax_invoice_url),
      upgrade_available: asBoolean(node.upgrade_available) ?? false,
      checkout_pending:
        pendingId && pendingUrl
          ? { id: pendingId, url: pendingUrl, expires_at: asString(pendingNode?.expires_at) }
          : null,
    },
    catalog: normalizeCatalog(root.catalog, currency),
    branches: Math.max(1, asInteger(root.branches) ?? 1),
    trial: {
      status: asOneOf(trialNode?.status, TRIAL_STATUSES) ?? "none",
      days_left: asInteger(trialNode?.days_left),
      ends_at: asString(trialNode?.ends_at),
    },
  };
}

export function normalizeInvoices(payload: unknown): Invoice[] {
  const root = asRecord(payload);
  const list = Array.isArray(root?.invoices) ? root.invoices : [];
  const out: Invoice[] = [];
  for (const entry of list) {
    const item = asRecord(entry);
    const amount = asInteger(item?.amount_minor);
    if (!item || amount === null) continue;
    out.push({
      occurred_at: asString(item.occurred_at),
      amount_minor: amount,
      currency: asOneOf(item.currency, CURRENCIES) ?? "USD",
      status: asString(item.status) ?? "paid",
      tax_invoice_url: asString(item.tax_invoice_url),
    });
  }
  return out.sort(
    (a, b) => (Date.parse(b.occurred_at ?? "") || 0) - (Date.parse(a.occurred_at ?? "") || 0),
  );
}

export function normalizeCheckoutStatus(payload: unknown): CheckoutStatus | null {
  return asOneOf(asRecord(payload)?.status, CHECKOUT_STATUSES);
}

/** The hosted payment page from POST /api/admin/billing/checkout; null when the body is not a checkout. */
export function checkoutUrl(payload: unknown): string | null {
  const checkout = asRecord(asRecord(payload)?.checkout);
  const url = asString(checkout?.url);
  return url && /^(https:\/\/|\/)/.test(url) ? url : null;
}

/** Display name of the plan a completed checkout or a change/cancel response carries. */
export function responsePlanName(payload: unknown): string | null {
  const subscription = asRecord(asRecord(payload)?.subscription);
  return asString(subscription?.plan_name) ?? planDisplayName(planCode(subscription?.plan));
}

/** Per-branch math (design §6): unit × branches, minimum one branch, Conecta fixed at one. */
export function quotePlans(view: Pick<BillingView, "catalog" | "branches">): PlanQuote[] {
  const quantity = Math.max(1, view.branches);
  return view.catalog.plans.map((plan) => {
    const single = plan.id === "EMPRENDEDOR";
    const units = single ? 1 : quantity;
    return {
      plan: plan.id,
      name: plan.name,
      currency: view.catalog.currency,
      unit_amount_minor: plan.unit_amount_minor,
      quantity: units,
      total_minor: plan.unit_amount_minor * units,
      single_branch: single,
    };
  });
}

export function quoteLine(quote: PlanQuote): string {
  const unit = formatMinor(quote.unit_amount_minor, quote.currency);
  if (quote.quantity === 1) return `${unit} al mes · 1 sucursal`;
  return `${unit} × ${quote.quantity} sucursales = ${formatMinor(quote.total_minor, quote.currency)} al mes`;
}

export function planChangeKind(current: PlanCode | null, next: PlanCode): PlanChangeKind {
  const from = current ? PLAN_ORDER.indexOf(current) : -1;
  const to = PLAN_ORDER.indexOf(next);
  if (from === to) return "same";
  return to > from ? "upgrade" : "downgrade";
}

export function invoiceStatusLabel(status: string): string {
  switch (status.toLowerCase()) {
    case "paid":
    case "succeeded":
      return "Pagado";
    case "failed":
      return "Rechazado";
    case "refunded":
      return "Reembolsado";
    case "pending":
      return "Pendiente";
    default:
      return status;
  }
}

export function formatBillingDate(
  value: string | null | undefined,
  locale = "es-GT",
  timeZone = "America/Guatemala",
): string {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone }).format(date);
}

/** Status card copy: what the owner pays, when, and what happens next, in plain Spanish. */
export function billingStatusCopy(view: BillingView): StatusCopy {
  const { billing, trial } = view;
  const name = billing.plan_name ?? "Conecta";
  const total = formatMinor(billing.monthly_total_minor, billing.currency);
  const periodEnd = formatBillingDate(billing.current_period_end);
  switch (billing.status) {
    case "active":
      return {
        badge: "Activo",
        color: "teal",
        title: `Plan ${name} activo`,
        body: `${periodEnd ? `Próximo cobro el ${periodEnd}: ` : "Cobro mensual: "}${total} (${billing.quantity} ${billing.quantity === 1 ? "sucursal" : "sucursales"} × ${formatMinor(billing.unit_amount_minor, billing.currency)}). Se cobra a la tarjeta registrada en Recurrente.`,
      };
    case "past_due": {
      const since = formatBillingDate(billing.past_due_since);
      const next = formatBillingDate(billing.next_payment_attempt_at);
      return {
        badge: "Pago pendiente",
        color: "orange",
        title: "El último cobro no se completó",
        body: `${since ? `El cobro del ${since} fue rechazado. ` : ""}Recurrente volverá a intentar con la misma tarjeta${next ? ` el ${next}` : " en los próximos días"}. Tu panel sigue operando; si el pago no se completa en 7 días, pasa a modo de lectura hasta que el cobro se complete.`,
      };
    }
    case "canceled": {
      const ends = formatBillingDate(billing.cancel_at ?? billing.current_period_end);
      return {
        badge: "Cancelado",
        color: "gray",
        title: `Plan ${name} cancelado`,
        body: `${ends ? `Sigue activo hasta el ${ends}. ` : ""}Después el panel pasa a modo de lectura y tus clientes siguen viendo su tarjeta. No hay más cobros.`,
      };
    }
    case "manual":
      return {
        badge: "Acuerdo directo",
        color: "blue",
        title: `Plan ${name} por acuerdo directo`,
        body: "Tu plan se activó por transferencia o factura, sin cobro con tarjeta. Para cambios o comprobantes, escríbenos a soporte.",
      };
    case "trial":
    case "none":
    default: {
      if (trial.status === "locked")
        return {
          badge: "Prueba terminada",
          color: "red",
          title: "Tu prueba terminó",
          body: "El panel está en modo de lectura. Elige un plan y paga con tarjeta para volver a operar con la misma información.",
        };
      const left = trial.days_left;
      const ends = formatBillingDate(trial.ends_at);
      const days =
        left === null
          ? ""
          : left <= 0
            ? "Termina hoy. "
            : left === 1
              ? "Te queda 1 día. "
              : `Te quedan ${left} días. `;
      return {
        badge: "En prueba",
        color: "blue",
        title: `Prueba gratis de ${name}`,
        body: `${days}${ends ? `La prueba termina el ${ends}. ` : ""}Sin cobro hasta que elijas un plan y pagues con tarjeta.`,
      };
    }
  }
}

/** Confirm dialog for POST /api/admin/billing/change, explaining now_and_charge vs next cycle. */
export function planChangeCopy(view: BillingView, next: PlanQuote): ChangeCopy {
  const kind = planChangeKind(view.billing.plan, next.plan);
  const current = view.billing.plan_name ?? "tu plan actual";
  const total = formatMinor(next.total_minor, next.currency);
  const periodEnd = formatBillingDate(view.billing.current_period_end);
  if (kind === "upgrade")
    return {
      kind,
      title: `Cambiar a ${next.name} ahora`,
      body: `Hoy se cobra solo la diferencia proporcional por los días que faltan de tu período actual, y desde el próximo cobro pagas ${total} al mes. Las funciones de ${next.name} se activan en cuanto Recurrente confirma el cobro.`,
      confirm: `Cambiar a ${next.name} y pagar la diferencia`,
    };
  if (kind === "downgrade")
    return {
      kind,
      title: `Cambiar a ${next.name} al final del período`,
      body: `Sigues con ${current}${periodEnd ? ` hasta el ${periodEnd}` : " hasta que termine el período pagado"}; no hay reembolso por los días ya pagados. El próximo cobro será de ${total} al mes. Antes del cambio, tu negocio debe estar dentro de los límites de ${next.name} (sucursales, clientes activos y recompensas).`,
      confirm: `Cambiar a ${next.name} al final del período`,
    };
  return {
    kind,
    title: `Ya tienes ${next.name}`,
    body: `Tu negocio ya está en ${next.name}. No hay nada que cambiar.`,
    confirm: "Entendido",
  };
}

export function cancelCopy(view: BillingView): { title: string; body: string; confirm: string } {
  const ends = formatBillingDate(view.billing.current_period_end);
  const name = view.billing.plan_name ? `Tu plan ${view.billing.plan_name}` : "Tu plan";
  return {
    title: "Cancelar al final del período",
    body: `${name} sigue activo${ends ? ` hasta el ${ends}` : " hasta que termine el período pagado"}. Después el panel pasa a modo de lectura, tus clientes siguen viendo su tarjeta con su saldo y no hay más cobros. No se reembolsan los días ya pagados.`,
    confirm: "Cancelar al final del período",
  };
}

/**
 * Recurrente sends the owner back to `/negocio/#plan?checkout=<id>&resultado=exito|cancelado`.
 * The hash query is read here before the shell normalises the hash to `#plan`.
 */
export function parseBillingReturn(hash: string | null | undefined): BillingReturn | null {
  const raw = String(hash ?? "").replace(/^#/, "");
  const index = raw.indexOf("?");
  if (index < 0) return null;
  const page = raw.slice(0, index);
  if (page !== CHECKOUT_RETURN_PAGE) return null;
  const params = new URLSearchParams(raw.slice(index + 1));
  const checkoutId = (params.get("checkout") ?? "").trim();
  if (!checkoutId || checkoutId.length > 120 || !/^[A-Za-z0-9_.:-]+$/.test(checkoutId)) return null;
  const result = params.get("resultado");
  return { checkoutId, result: result === "exito" || result === "cancelado" ? result : null };
}

export function startPolling(checkoutId: string, now: number = Date.now()): PollState {
  return { checkoutId, phase: "polling", attempts: 0, startedAt: now };
}

export function isBillingUnavailable(error: unknown): boolean {
  const record = asRecord(error);
  if (!record) return false;
  return record.status === 404 || record.status === 503 || record.code === "BILLING_UNAVAILABLE";
}

/**
 * Poll GET /api/admin/billing/checkout/:id every 3 s for up to 2 minutes after the return.
 * Transient errors keep polling until the deadline; a 404/503 means the API is not serving
 * billing and the poller stops with `unavailable`.
 */
export function advancePolling(
  state: PollState,
  event: PollEvent,
  now: number = Date.now(),
): PollState {
  if (state.phase !== "polling") return state;
  const attempts = state.attempts + 1;
  if (event.kind === "response") {
    if (event.status === "completed" || event.status === "expired" || event.status === "canceled")
      return { ...state, attempts, phase: event.status };
  } else if (isBillingUnavailable(event.error)) return { ...state, attempts, phase: "unavailable" };
  if (now - state.startedAt + POLL_INTERVAL_MS >= POLL_TIMEOUT_MS)
    return { ...state, attempts, phase: "timeout" };
  return { ...state, attempts, phase: "polling" };
}

export function nextPollDelay(state: PollState): number | null {
  return state.phase === "polling" ? POLL_INTERVAL_MS : null;
}

export function pollingCopy(
  state: PollState,
  planName: string | null,
): { title: string; body: string; tone: BillingTone } {
  switch (state.phase) {
    case "completed":
      return {
        title: planName ? `Tu plan ${planName} está activo` : "Tu plan está activo",
        body: "El pago se confirmó y el panel ya opera con el nuevo plan. Cada cobro aparece abajo cuando Recurrente lo confirma.",
        tone: "teal",
      };
    case "expired":
      return {
        title: "El pago no se completó",
        body: 'La página de pago venció antes de terminar. Vuelve a pulsar "Pagar con tarjeta" para intentarlo de nuevo; no se hizo ningún cobro.',
        tone: "orange",
      };
    case "canceled":
      return {
        title: "Pago cancelado",
        body: "Cancelaste el pago en la página de Recurrente. Puedes intentarlo de nuevo cuando quieras; no se hizo ningún cobro.",
        tone: "orange",
      };
    case "timeout":
      return {
        title: "Seguimos esperando la confirmación",
        body: "Recurrente todavía no nos confirmó el pago. Suele tardar menos de un minuto; vuelve a cargar esta página en unos minutos. Si tu tarjeta ya muestra el cargo, el plan se activará solo.",
        tone: "orange",
      };
    case "unavailable":
      return {
        title: "No pudimos consultar el pago",
        body: `${BILLING_UNAVAILABLE_MESSAGE}. Si ya pagaste, escríbenos y activamos el plan manualmente.`,
        tone: "red",
      };
    default:
      return {
        title: "Confirmando tu pago…",
        body: "Estamos esperando la confirmación de Recurrente. No cierres esta página; tarda unos segundos.",
        tone: "blue",
      };
  }
}

/** Spanish copy for the checkout, change and cancel error codes; null for unknown errors. */
export function billingErrorMessage(error: unknown): string | null {
  const record = asRecord(error);
  if (!record) return null;
  const code = typeof record.code === "string" ? record.code : "";
  if (code && BILLING_ERROR_MESSAGES[code]) return BILLING_ERROR_MESSAGES[code];
  if (record.status === 503 || record.status === 404)
    return BILLING_ERROR_MESSAGES.BILLING_UNAVAILABLE;
  return null;
}

/** Whether the picker may start a new checkout for this state. */
export function canStartCheckout(view: BillingView): boolean {
  return (
    view.billing.upgrade_available &&
    (view.billing.status === "trial" || view.billing.status === "none")
  );
}

export function canChangePlan(view: BillingView): boolean {
  return (
    view.billing.upgrade_available &&
    view.billing.status === "active" &&
    view.billing.provider === "recurrente"
  );
}

export function canCancel(view: BillingView): boolean {
  return (
    view.billing.upgrade_available &&
    (view.billing.status === "active" || view.billing.status === "past_due") &&
    view.billing.provider === "recurrente"
  );
}

export function showsInvoices(view: BillingView): boolean {
  return (
    view.billing.status === "active" ||
    view.billing.status === "past_due" ||
    view.billing.status === "canceled"
  );
}
