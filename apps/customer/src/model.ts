import type { ApiError } from "./api.ts";
export type Business = {
  id: string;
  name: string;
  slug: string;
  features?: Record<string, boolean>;
  member_discount?: { percent_off: number; min_purchase_q?: number } | null;
  customer_branding?: {
    customer_program_name?: string;
    primary_color?: string;
    accent_color?: string;
    powered_by_visible?: boolean;
    customer_logo_url?: string;
  };
};
export type Customer = {
  id: string;
  name?: string | null;
  phone?: string;
  points: number;
  pending_points?: number;
  lifetime_points?: number;
};
export type Reward = {
  id: string;
  name: string;
  description?: string;
  points_cost: number;
  stock?: number | null;
  valid_until?: string | null;
  branch_labels?: string[];
};
export type Transaction = {
  id: string;
  points_delta: number;
  amount_q?: string | number;
  source?: string;
  created_at: string;
  reward_name?: string | null;
};
// Server shapes from GET /api/mobile/customer (src/app/routes/mobile-routes.js).
// `cashback` and `program_wallet` mirror `/api/customer/me` `cashback`/`wallet`;
// `wallet_history` rows come from the stored-value ledger (cashback_transactions).
export type Cashback = { balance_q: number; percent: number };
export type ProgramWallet = {
  kind: "CASHBACK" | "GIFT_CARD" | string;
  balance_q: number;
  percent?: number | null;
  bonus_percent?: number | null;
};
export type WalletMovement = {
  id: string;
  /** EARN | SPEND | LOAD | TRANSFER_IN | TRANSFER_OUT | REVERSE | ADJUST */
  tx_type: string;
  amount_q: number;
  balance_after_q: number;
  created_at: string;
  base_q?: number | null;
  bonus_q?: number | null;
  note?: string | null;
};
export type Tier = {
  tier_level?: number | null;
  name?: string | null;
  points_multiplier?: number | null;
  current_points?: number | null;
  next_tier_name?: string | null;
  next_tier_points?: number | null;
  points_to_next_tier?: number | null;
  perks?: string[];
  color?: string | null;
};
export type ReferralCode = { code: string };
export type ReferralStats = {
  total_referrals: number;
  completed_referrals: number;
  total_points_earned: number;
};
export type GiftCardTransferResult = {
  ok?: boolean;
  recipient: { id: string; name?: string | null };
  transferred_q: number;
  balance_after_q: number;
  replay?: boolean;
};
export type Snapshot = {
  business: Business;
  customer: Customer;
  rewards: Reward[];
  transactions: Transaction[];
  redemptions: unknown[];
  wallet: {
    providers: { apple: boolean; google: boolean };
    passes: { provider: string }[];
  };
  stamp_card?: {
    stamps_required: number;
    head_start: number;
    filled: number;
    remaining: number;
    reward_label: string;
    complete: boolean;
  } | null;
  // Optional: servers before 0.1.1 omit them and the card renders as before.
  cashback?: Cashback | null;
  program_wallet?: ProgramWallet | null;
  wallet_history?: WalletMovement[] | null;
  tier?: Tier | null;
  referral_code?: ReferralCode | null;
  referral_stats?: ReferralStats | null;
};
export type Session = {
  token: string;
  expiresAt: string;
  customerId: string;
  businessId: string;
  slug: string;
};
export type Qr = { token: string; exp: number };
export function businessSlug(input: string): string {
  const text = input.trim();
  if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(text) && text.length <= 100)
    return text;
  try {
    const u = new URL(text);
    if (u.username || u.password || u.port) throw new Error();
    let path = u.pathname;
    if (u.protocol === "puntosfieles:" && u.hostname === "negocio")
      path = "/registro" + path;
    else if (
      u.protocol !== "https:" ||
      !["puntosfieles.com", "app.puntosfieles.com"].includes(u.hostname)
    )
      throw new Error();
    const match =
      /^\/(?:registro|ingresar)\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/.exec(path);
    if (match && match[1].length <= 100) return match[1];
  } catch {}
  throw new Error(
    "Usa el enlace de registro de PuntosFieles o el código del negocio.",
  );
}
export function apiOrigin(input: string) {
  const u = new URL(input);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    !["", "/"].includes(u.pathname) ||
    u.search ||
    u.hash
  )
    throw new Error("La dirección de PF no es válida.");
  return u.origin;
}
export function validQr(qr: Qr | null, now = Date.now()) {
  return !!qr?.token && Number.isFinite(qr.exp) && qr.exp * 1000 > now;
}
export function safeGoogleUrl(value: string) {
  const u = new URL(value);
  if (
    u.origin !== "https://pay.google.com" ||
    !u.pathname.startsWith("/gp/v/save/") ||
    u.username ||
    u.password
  )
    throw new Error("No se pudo abrir la tarjeta. Intenta de nuevo.");
  return u.href;
}
export function rewardState(
  r: Reward,
  points: number,
  offline: boolean,
  now = Date.now(),
  unit: Unit = "puntos",
) {
  if (r.stock !== undefined && r.stock !== null && Number(r.stock) <= 0)
    return { available: false, label: "Agotada" };
  if (r.valid_until && Date.parse(r.valid_until) <= now)
    return { available: false, label: "Finalizada" };
  const missing = Math.max(0, Number(r.points_cost) - Number(points));
  if (missing)
    return {
      available: false,
      label: `Te faltan ${missing.toLocaleString("es-GT")} ${unit}`,
    };
  if (offline)
    return { available: false, label: "Confirma disponibilidad al conectarte" };
  return { available: true, label: "Disponible para ti" };
}
export function matches(snapshot: Snapshot, session: Session) {
  return (
    snapshot?.business?.id === session.businessId &&
    snapshot?.customer?.id === session.customerId &&
    Array.isArray(snapshot.rewards) &&
    Array.isArray(snapshot.transactions)
  );
}
export function validSession(s: Session | null): s is Session {
  return (
    !!s &&
    typeof s.token === "string" &&
    s.token.length > 0 &&
    typeof s.businessId === "string" &&
    typeof s.customerId === "string" &&
    Date.parse(s.expiresAt) > Date.now()
  );
}

// ----- Program kinds and program-aware copy -----
// One card component serves five program types. Everything that names the unit
// a member collects (points, stamps, Q of balance, a discount) goes through here
// so a cashback or gift-card card never says "puntos".
export type ProgramKind = "points" | "stamp" | "discount" | "cashback" | "gift_card";
export type Unit = "puntos" | "sellos";
type ProgramSource = Partial<Snapshot>;
function money(value: unknown): number {
  const n = typeof value === "string" ? Number(value.replace(",", ".")) : Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}
export function programWallet(snapshot: ProgramSource | null | undefined): ProgramWallet | null {
  const raw = snapshot?.program_wallet;
  if (raw && (raw.kind === "CASHBACK" || raw.kind === "GIFT_CARD")) {
    return {
      kind: raw.kind,
      balance_q: Math.max(0, money(raw.balance_q)),
      percent: raw.kind === "CASHBACK" ? money(raw.percent) : null,
      bonus_percent: raw.kind === "GIFT_CARD" ? money(raw.bonus_percent) : null,
    };
  }
  const cashback = snapshot?.cashback;
  if (cashback && money(cashback.percent) > 0)
    return {
      kind: "CASHBACK",
      balance_q: Math.max(0, money(cashback.balance_q)),
      percent: money(cashback.percent),
      bonus_percent: null,
    };
  return null;
}
export function programKind(snapshot: ProgramSource | null | undefined): ProgramKind {
  if (snapshot?.stamp_card) return "stamp";
  const wallet = programWallet(snapshot);
  if (wallet?.kind === "GIFT_CARD") return "gift_card";
  if (wallet?.kind === "CASHBACK") return "cashback";
  const discount = snapshot?.business?.member_discount;
  if (discount && Number(discount.percent_off) > 0) return "discount";
  return "points";
}
export function walletHistory(
  snapshot: Pick<Partial<Snapshot>, "wallet_history"> | null | undefined,
): WalletMovement[] {
  const rows = Array.isArray(snapshot?.wallet_history) ? snapshot.wallet_history : [];
  return rows
    .filter(
      (row): row is WalletMovement =>
        !!row &&
        typeof row.id === "string" &&
        typeof row.tx_type === "string" &&
        Number.isFinite(Number(row.amount_q)),
    )
    .map((row) => ({
      ...row,
      amount_q: money(row.amount_q),
      balance_after_q: money(row.balance_after_q),
      base_q: row.base_q == null ? null : money(row.base_q),
      bonus_q: row.bonus_q == null ? null : money(row.bonus_q),
      note: typeof row.note === "string" && row.note.trim() ? row.note.trim() : null,
    }))
    .sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0));
}
export function formatQ(value: number) {
  const n = money(value);
  const text = Math.abs(n).toLocaleString("es-GT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${n < 0 ? "-" : ""}Q${text}`;
}
export function formatPercent(value: number) {
  return `${money(value).toLocaleString("es-GT", { maximumFractionDigits: 2 })}%`;
}
export function movementLabel(txType: string) {
  switch (txType) {
    case "LOAD":
      return "Recarga de saldo";
    case "TRANSFER_IN":
      return "Saldo recibido";
    case "TRANSFER_OUT":
      return "Saldo regalado";
    case "SPEND":
      return "Saldo utilizado";
    case "EARN":
      return "Cashback ganado";
    case "REVERSE":
      return "Cashback revertido";
    case "ADJUST":
      return "Ajuste de saldo";
    default:
      return "Movimiento";
  }
}
export function movementDetail(row: WalletMovement) {
  if (row.tx_type === "LOAD" && row.bonus_q && row.bonus_q > 0 && row.base_q != null)
    return `${formatQ(row.base_q)} recargados + ${formatQ(row.bonus_q)} de bono`;
  return row.note || null;
}
export type ProgramCopy = {
  kind: ProgramKind;
  unit: Unit;
  /** Second line under the big number on the card. */
  balanceLabel: (mode: "live" | "cached" | "demo") => string;
  /** Rate or bonus sentence for stored-value programs; null otherwise. */
  rateLine: (wallet: ProgramWallet | null) => string | null;
  /** Pending-balance notice, when the program counts points or stamps. */
  pendingNotice: (pending: number) => string | null;
  scopeNotice: string;
  qrPurpose: string;
  activityEmpty: string;
  transactionLabel: (negative: boolean) => string;
  /** Heading above the balance on the rewards tab; null hides it. */
  rewardsHeading: string | null;
};
export function programCopy(kind: ProgramKind): ProgramCopy {
  const unit: Unit = kind === "stamp" ? "sellos" : "puntos";
  const countable = kind === "points" || kind === "stamp";
  const scope: Record<ProgramKind, string> = {
    points: "Tus puntos y recompensas corresponden a este negocio.",
    stamp: "Tus sellos y recompensas corresponden a este negocio.",
    discount: "Tu descuento de miembro corresponde a este negocio.",
    cashback: "Tu saldo de cashback y tus recompensas corresponden a este negocio.",
    gift_card: "El saldo de tu tarjeta corresponde a este negocio.",
  };
  const qr: Record<ProgramKind, string> = {
    points:
      "El equipo del negocio lo escanea para sumar puntos o canjear una recompensa.",
    stamp:
      "El equipo del negocio lo escanea para sumar sellos o canjear tu recompensa.",
    discount:
      "El equipo del negocio lo escanea para aplicar tu descuento de miembro.",
    cashback:
      "El equipo del negocio lo escanea para sumar cashback a tu saldo o usarlo en tu compra.",
    gift_card:
      "El equipo del negocio lo escanea para usar el saldo de tu tarjeta o recargarla.",
  };
  const empty: Record<ProgramKind, string> = {
    points: "Tu primer movimiento aparecerá después de una compra o un canje.",
    stamp: "Tu primer movimiento aparecerá después de una visita o un canje.",
    discount: "Tu primer movimiento aparecerá después de una compra.",
    cashback: "Tu primer movimiento aparecerá después de una compra.",
    gift_card: "Tu primer movimiento aparecerá después de una recarga o un regalo.",
  };
  return {
    kind,
    unit,
    balanceLabel: (mode) => {
      if (kind === "discount") return "de descuento en cada compra";
      if (kind === "cashback")
        return mode === "live" ? "saldo de cashback" : "saldo de cashback guardado";
      if (kind === "gift_card")
        return mode === "live" ? "saldo de tu tarjeta" : "saldo guardado de tu tarjeta";
      if (mode === "demo") return `${unit} de ejemplo`;
      return mode === "live" ? `${unit} disponibles` : `${unit} guardados`;
    },
    rateLine: (wallet) => {
      if (!wallet) return null;
      if (wallet.kind === "CASHBACK" && Number(wallet.percent) > 0)
        return `Ganas ${formatPercent(Number(wallet.percent))} de cada compra como saldo.`;
      if (wallet.kind === "GIFT_CARD" && Number(wallet.bonus_percent) > 0)
        return `Cada recarga suma ${formatPercent(Number(wallet.bonus_percent))} extra de saldo.`;
      return null;
    },
    pendingNotice: (pending) =>
      countable && pending > 0
        ? `${pending.toLocaleString("es-GT")} ${unit} pendientes de confirmación.`
        : null,
    scopeNotice: scope[kind],
    qrPurpose: qr[kind],
    activityEmpty: empty[kind],
    transactionLabel: (negative) => {
      if (kind === "points") return negative ? "Puntos utilizados" : "Puntos recibidos";
      if (kind === "stamp") return negative ? "Sellos utilizados" : "Sellos recibidos";
      return negative ? "Canje" : "Compra registrada";
    },
    rewardsHeading: kind === "points" ? "Tus puntos" : kind === "stamp" ? "Tus sellos" : null,
  };
}
export function tierSummary(tier: Tier | null | undefined, unit: Unit = "puntos") {
  if (!tier || typeof tier.name !== "string" || !tier.name.trim()) return null;
  const multiplier = Number(tier.points_multiplier);
  const toNext = Number(tier.points_to_next_tier);
  const nextName = typeof tier.next_tier_name === "string" ? tier.next_tier_name.trim() : "";
  const current = Math.max(0, Number(tier.current_points) || 0);
  const nextPoints = Number(tier.next_tier_points);
  return {
    name: tier.name.trim(),
    multiplierLabel:
      Number.isFinite(multiplier) && multiplier > 0 && multiplier !== 1
        ? `${multiplier.toLocaleString("es-GT", { maximumFractionDigits: 2 })}× ${unit}`
        : null,
    progressLabel:
      nextName && Number.isFinite(toNext) && toNext > 0
        ? `${toNext.toLocaleString("es-GT")} ${unit} más para ${nextName}`
        : nextName
          ? `Ya alcanzaste lo necesario para ${nextName}.`
          : "Estás en el nivel más alto.",
    progress:
      nextName && Number.isFinite(nextPoints) && nextPoints > 0
        ? Math.min(1, Math.max(0, current / nextPoints))
        : null,
    perks: Array.isArray(tier.perks)
      ? tier.perks.filter((perk): perk is string => typeof perk === "string" && !!perk.trim())
      : [],
  };
}
export function referralShareMessage({
  code,
  business,
  slug,
}: {
  code: string;
  business: string;
  slug: string;
}) {
  const link = `https://app.puntosfieles.com/registro/${businessSlug(slug)}`;
  return `Únete a ${business} con mi código de referido ${code.trim().toUpperCase()}. Regístrate en ${link}`;
}

// ----- Gift-card transfer request -----
// Mirrors the browser card (public/customer/index.js): POST
// /api/customer/giftcard/transfer { recipient_phone, amount_q, requestId }.
// `requestId` is the server's idempotency key; the screen creates one per
// confirmed attempt and reuses it when it retries the same attempt.
export const GIFT_TRANSFER_PATH = "/customer/giftcard/transfer";
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseAmountQ(input: string): number {
  const text = String(input ?? "")
    .trim()
    .replace(/^q\s*/i, "")
    .replace(/\s+/g, "");
  if (!/^\d+(?:[.,]\d*)?$/.test(text)) throw new Error("Ingresa un monto válido.");
  const normalized = text.replace(",", ".");
  const decimals = normalized.split(".")[1] || "";
  if (decimals.length > 2) throw new Error("Usa como máximo dos decimales.");
  const amount = Number(normalized);
  if (!(amount > 0)) throw new Error("Ingresa un monto mayor que cero.");
  if (amount > 1000000) throw new Error("El monto es demasiado alto.");
  return Math.round(amount * 100) / 100;
}
export type GiftTransferRequest = {
  path: typeof GIFT_TRANSFER_PATH;
  method: "POST";
  body: { recipient_phone: string; amount_q: number; requestId: string; note?: string };
};
export function buildGiftTransfer({
  recipientPhone,
  amount,
  requestId,
  available,
  note,
}: {
  recipientPhone: string;
  amount: string | number;
  requestId: string;
  available?: number;
  note?: string;
}): GiftTransferRequest {
  const phone = String(recipientPhone ?? "").trim();
  if (!phone || !/^\+?[\d\s()-]{4,40}$/.test(phone) || !/\d{4}/.test(phone.replace(/\D/g, "")))
    throw new Error("Ingresa el teléfono de quien recibe el saldo.");
  const amount_q = typeof amount === "number" ? parseAmountQ(amount.toFixed(2)) : parseAmountQ(amount);
  if (available !== undefined && amount_q > money(available))
    throw new Error("Saldo insuficiente para regalar.");
  if (!GUID.test(String(requestId || "")))
    throw new Error("No se pudo preparar el regalo. Intenta de nuevo.");
  const trimmedNote = typeof note === "string" ? note.trim().slice(0, 200) : "";
  return {
    path: GIFT_TRANSFER_PATH,
    method: "POST",
    body: {
      recipient_phone: phone,
      amount_q,
      requestId,
      ...(trimmedNote ? { note: trimmedNote } : {}),
    },
  };
}
// The server's own Spanish message when it rejected the request as a client
// error (insufficient balance, unknown recipient...); the generic client text
// for everything else, so a 5xx or network failure never echoes server internals.
export function transferErrorMessage(error: unknown) {
  if (error && typeof error === "object" && "status" in error && "detail" in error) {
    const e = error as ApiError;
    if ([400, 403, 409].includes(e.status) && e.detail) return e.detail;
    return e.message;
  }
  if (error instanceof Error && error.message) return error.message;
  return "No se pudo regalar el saldo. Intenta de nuevo.";
}
export function transferSuccessMessage(result: GiftCardTransferResult, phone: string) {
  const who = result.recipient?.name?.trim() || phone;
  return `Regalaste ${formatQ(Number(result.transferred_q))} a ${who}. Tu nuevo saldo: ${formatQ(Number(result.balance_after_q))}.`;
}
