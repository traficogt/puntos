export function getImpersonatorEmail(actor) {
  const email = actor?.impersonated_by ?? actor?.imp ?? null;
  if (!email) return null;
  return String(email);
}

export function withImpersonationMeta(meta = {}, actor) {
  const impersonatedBy = getImpersonatorEmail(actor);
  if (!impersonatedBy) return meta ?? {};
  return {
    ...(meta ?? {}),
    impersonated_by_super_admin_email: impersonatedBy
  };
}
