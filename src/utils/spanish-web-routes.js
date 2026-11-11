/** @type {Array<[string, string[]]>} */
const browserRoutes = [
  ["/preferencias-de-mensajes/", ["/marketing-preferences.html"]],
  ["/negocio/", ["/merchant", "/merchant/index.html", "/negocio/index.html"]],
  ["/demostracion/", ["/demostracion/index.html"]],
  ["/administracion/", ["/admin-dashboard", "/admin-dashboard.html"]],
  ["/crear-negocio/", ["/admin", "/admin.html"]],
  ["/equipo/ingresar/", ["/staff/login", "/staff-login", "/staff-login.html"]],
  ["/equipo/escaner/", ["/staff", "/staff.html"]],
  ["/mi-tarjeta/", ["/c", "/customer", "/customer.html"]],
  ["/plataforma/", ["/super", "/super.html"]],
  ["/vista-previa-app/", ["/app-preview"]],
  ["/registro/", ["/join", "/join.html", "/registro.html"]],
  ["/ingresar/", ["/ingresar.html"]]
];

const entryPaths = new Map();
for (const [canonical, aliases] of browserRoutes) {
  for (const entry of [canonical.slice(0, -1), ...aliases]) entryPaths.set(entry, canonical);
}

const sections = new Map(Object.entries({
  rewards: "recompensas", branding: "marca", tiers: "niveles", branches: "sucursales",
  staff: "equipo", giftcards: "tarjetas-regalo", achievements: "logros", challenges: "retos",
  referrals: "referidos", operations: "operaciones", analytics: "analisis"
}));
const setupValues = new Map([["program", "puntos"], ["pos", "punto-de-venta"]]);
const queryKeys = new Map([["tab", "seccion"], ["branch_id", "sucursal"], ["setup", "configurar"]]);

function entryPath(pathname) {
  return entryPaths.get(pathname.replace(/\/$/, "").toLowerCase()) || "";
}

/** Only document entry paths belong to the app host; assets and APIs stay put. */
export function isSpanishWebRoutePath(pathname) {
  return Boolean(entryPath(String(pathname || "")));
}

// Rewrite only known query components so opaque tokens and future parameters keep
// their original encoding, order and duplicate values.
function canonicalAdminQuery(query) {
  const params = new URLSearchParams(query);
  return query.split("&").flatMap((component) => {
    const [entry] = new URLSearchParams(component);
    if (!entry) return [component];
    const [key, value] = entry;
    const canonicalKey = queryKeys.get(key) || key;
    if (key !== canonicalKey && params.has(canonicalKey)) return [];
    const canonicalValue = canonicalKey === "seccion"
      ? sections.get(value) || value
      : canonicalKey === "configurar" ? setupValues.get(value) || value : value;
    if (key === canonicalKey && value === canonicalValue) return [component];
    return [`${canonicalKey}=${encodeURIComponent(canonicalValue)}`];
  }).join("&");
}

/** Return a same-origin canonical browser URL, or an empty string if unchanged. */
export function resolveSpanishWebRedirect(originalUrl) {
  const original = String(originalUrl || "");
  const queryStart = original.indexOf("?");
  const pathname = queryStart < 0 ? original : original.slice(0, queryStart);
  const query = queryStart < 0 ? "" : original.slice(queryStart + 1);
  let canonicalPath = entryPath(pathname);
  if (!canonicalPath) return "";
  let canonicalQuery = query;
  if (canonicalPath === "/negocio/" && new URLSearchParams(query).get("demo") === "1") {
    canonicalPath = "/demostracion/";
    canonicalQuery = query.split("&").filter((component) => !new URLSearchParams(component).has("demo")).join("&");
  }
  if (canonicalPath === "/administracion/") canonicalQuery = canonicalAdminQuery(query);
  const canonical = `${canonicalPath}${canonicalQuery ? `?${canonicalQuery}` : ""}`;
  return canonical === original ? "" : canonical;
}
