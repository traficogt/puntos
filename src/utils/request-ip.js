/**
 * The client IP Express derived (honouring `trust proxy`), or null when unknown.
 *
 * The result is typed `any` for now: routes pass it to account-security
 * services whose destructured `ip = null` defaults currently infer `ip?: null`
 * and would reject a string (src/app/routes/super-routes.js, five call sites).
 * Declare it `string | null` once those services annotate `ip?: string | null`.
 * @param {{ ip?: string } | null | undefined} req
 * @returns {any}
 */
export function getRequestIp(req) {
  const ip = typeof req?.ip === "string" ? req.ip.trim() : "";
  return ip || null;
}
