/**
 * Only owner application paths are accepted; no queries, URLs, encoded paths or control characters.
 * @param {unknown} value
 */
export function ownerReturnPath(value) {
  return typeof value === "string" &&
    /^\/negocio\/(?:#[a-z][a-z0-9_-]{0,63})?$/.test(value) &&
    !/[\r\n]/.test(value)
    ? value
    : "/negocio/";
}
/** @param {unknown} value */
export function staffLoginHref(value) {
  return `/equipo/ingresar/?return_to=${encodeURIComponent(ownerReturnPath(value))}`;
}
/**
 * @param {unknown} role
 * @param {unknown} value
 */
export function staffLoginDestination(role, value) {
  if (String(role).toUpperCase() === "OWNER") return ownerReturnPath(value);
  return String(role).toUpperCase() === "MANAGER" ? "/administracion/" : "/equipo/escaner/";
}
