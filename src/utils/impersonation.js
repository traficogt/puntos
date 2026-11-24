/**
 * A staff actor as the request or a session carries it: `impersonated_by` on
 * `req.staff` and session rows, `imp` on legacy token claims.
 * @typedef {{ impersonated_by?: string | null, imp?: string | null }} ImpersonationActor
 */

/** @param {ImpersonationActor | null | undefined} actor */
export function getImpersonatorEmail(actor) {
  const email = actor?.impersonated_by ?? actor?.imp ?? null;
  if (!email) return null;
  return String(email);
}

/**
 * Audit metadata with the impersonating operator recorded when there is one.
 * @param {Record<string, unknown> | null | undefined} [meta]
 * @param {ImpersonationActor | null | undefined} [actor]
 */
export function withImpersonationMeta(meta = {}, actor) {
  const impersonatedBy = getImpersonatorEmail(actor);
  if (!impersonatedBy) return meta ?? {};
  return {
    ...(meta ?? {}),
    impersonated_by_super_admin_email: impersonatedBy,
  };
}
