/** @type {Array<[string, string[]]>} */
const browserRoutes = [
  ["/preferencias-de-mensajes/", ["/marketing-preferences.html"]],
  // The retired vanilla owner dashboard (/administracion/, /admin-dashboard) now opens the
  // merchant app; resolveSpanishWebRedirect maps its ?seccion= / ?configurar= query to a hash.
  [
    "/negocio/",
    [
      "/merchant",
      "/merchant/index.html",
      "/negocio/index.html",
      "/admin-dashboard",
      "/admin-dashboard.html",
      "/administracion",
      "/administracion/index.html",
    ],
  ],
  ["/demostracion/", ["/demostracion/index.html"]],
  ["/crear-negocio/", ["/admin", "/admin.html"]],
  ["/prueba/", ["/prueba", "/prueba.html"]],
  ["/equipo/ingresar/", ["/staff/login", "/staff-login", "/staff-login.html"]],
  ["/equipo/escaner/", ["/staff", "/staff.html"]],
  ["/mi-tarjeta/", ["/c", "/customer", "/customer.html"]],
  ["/plataforma/", ["/super", "/super.html"]],
  ["/vista-previa-app/", ["/app-preview"]],
  ["/registro/", ["/join", "/join.html", "/registro.html"]],
  ["/ingresar/", ["/ingresar.html"]],
];

/** @type {Map<string, string>} entry path (canonical without slash, or alias) -> canonical path */
const entryPaths = new Map();
for (const [canonical, aliases] of browserRoutes) {
  for (const entry of [canonical.slice(0, -1), ...aliases]) entryPaths.set(entry, canonical);
}

// Public landing aliases canonicalize without becoming application-host routes.
const publicEntryPaths = new Map([
  ["/credenciales", "/credenciales/"],
  ["/credenciales/index.html", "/credenciales/"],
]);

/** Entry paths of the retired vanilla owner dashboard (lowercase, no trailing slash). */
const legacyOwnerEntries = new Set([
  "/admin-dashboard",
  "/admin-dashboard.html",
  "/administracion",
  "/administracion/index.html",
]);

/**
 * Vanilla dashboard sections (English `tab` values and their Spanish `seccion` names) and the
 * merchant page that now holds each capability (`web/merchant/src/navigation.js` fragments).
 * @type {Map<string, string>}
 */
export const legacyOwnerSections = new Map(
  Object.entries({
    program: "preparar",
    programa: "preparar",
    puntos: "preparar",
    rewards: "recompensas",
    recompensas: "recompensas",
    branding: "identidad",
    marca: "identidad",
    tiers: "niveles",
    niveles: "niveles",
    branches: "sucursales",
    sucursales: "sucursales",
    staff: "personal",
    equipo: "personal",
    giftcards: "tarjetas-de-regalo",
    "tarjetas-regalo": "tarjetas-de-regalo",
    achievements: "logros-y-retos",
    logros: "logros-y-retos",
    challenges: "logros-y-retos",
    retos: "logros-y-retos",
    referrals: "referidos",
    referidos: "referidos",
    operations: "puesta-en-marcha",
    operaciones: "puesta-en-marcha",
    reportes: "reportes",
    analytics: "analitica",
    analisis: "analitica",
    plan: "reportes",
  }),
);
/** Vanilla `setup` / `configurar` values and their merchant pages. */
const legacyOwnerSetups = new Map(
  Object.entries({
    program: "limites",
    puntos: "limites",
    pos: "conectar-caja",
    "punto-de-venta": "conectar-caja",
  }),
);
/** Query keys of the vanilla dashboard view state; none has a merchant counterpart. */
const legacyOwnerQueryKeys = new Set([
  "tab",
  "seccion",
  "setup",
  "configurar",
  "branch_id",
  "sucursal",
]);

/** @param {string} pathname */
function entryPath(pathname) {
  return entryPaths.get(pathname.replace(/\/$/, "").toLowerCase()) || "";
}

/** Only document entry paths belong to the app host; assets and APIs stay put. */
/** @param {string | undefined} pathname */
export function isSpanishWebRoutePath(pathname) {
  return Boolean(entryPath(String(pathname || "")));
}

/**
 * Translate the vanilla owner dashboard view (`?seccion=` / `?tab=`, `?configurar=` / `?setup=`)
 * into the merchant app's hash, dropping the branch filter, and keep every other query
 * component with its original encoding, order and duplicate values.
 * @param {string} query the raw query string without `?`
 * @returns {{ query: string, hash: string }}
 */
export function merchantViewForLegacyOwnerQuery(query) {
  let section = "";
  let setup = "";
  /** @type {string[]} */
  const kept = [];
  for (const component of query.split("&")) {
    const [entry] = new URLSearchParams(component);
    if (!entry) {
      if (component) kept.push(component);
      continue;
    }
    const [key, value] = entry;
    if (!legacyOwnerQueryKeys.has(key)) {
      kept.push(component);
      continue;
    }
    if ((key === "tab" || key === "seccion") && !section)
      section = legacyOwnerSections.get(value.toLowerCase()) || "";
    if ((key === "setup" || key === "configurar") && !setup)
      setup = legacyOwnerSetups.get(value.toLowerCase()) || "";
  }
  const page = section || setup;
  return { query: kept.join("&"), hash: page ? `#${page}` : "" };
}

/** Return a same-origin canonical browser URL, or an empty string if unchanged. */
/** @param {string | undefined} originalUrl */
export function resolveSpanishWebRedirect(originalUrl) {
  const original = String(originalUrl || "");
  const queryStart = original.indexOf("?");
  const pathname = queryStart < 0 ? original : original.slice(0, queryStart);
  const query = queryStart < 0 ? "" : original.slice(queryStart + 1);
  let canonicalPath = publicEntryPaths.get(pathname) || entryPath(pathname);
  if (!canonicalPath) return "";
  let canonicalQuery = query;
  let hash = "";
  if (legacyOwnerEntries.has(pathname.replace(/\/$/, "").toLowerCase())) {
    ({ query: canonicalQuery, hash } = merchantViewForLegacyOwnerQuery(query));
  }
  if (canonicalPath === "/negocio/" && new URLSearchParams(canonicalQuery).get("demo") === "1") {
    canonicalPath = "/demostracion/";
    canonicalQuery = canonicalQuery
      .split("&")
      .filter((component) => !new URLSearchParams(component).has("demo"))
      .join("&");
  }
  const canonical = `${canonicalPath}${canonicalQuery ? `?${canonicalQuery}` : ""}${hash}`;
  return canonical === original ? "" : canonical;
}
