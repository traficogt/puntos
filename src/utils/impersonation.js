/**
 * A staff actor as the request or a session carries it: `impersonated_by` on
 * `req.staff` (src/types/auth.ts `StaffActor`) and session rows, `imp` on
 * legacy token claims (`StaffTokenPayload`). Any object qualifies (staff rows
 * without either field read as "not impersonated"); the `object` intersection
 * keeps the all-optional shape from being a weak type.
 * @typedef {object & Partial<Pick<import("../types/auth.js").StaffActor, "impersonated_by"> & Pick<import("../types/auth.js").StaffTokenPayload, "imp">>} ImpersonationActor
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
