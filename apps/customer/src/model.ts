export type Business = {
  id: string;
  name: string;
  slug: string;
  features?: Record<string, boolean>;
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
) {
  if (r.stock !== undefined && r.stock !== null && Number(r.stock) <= 0)
    return { available: false, label: "Agotada" };
  if (r.valid_until && Date.parse(r.valid_until) <= now)
    return { available: false, label: "Finalizada" };
  const missing = Math.max(0, Number(r.points_cost) - Number(points));
  if (missing)
    return {
      available: false,
      label: `Te faltan ${missing.toLocaleString("es-GT")} puntos`,
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
