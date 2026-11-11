import { badRequest } from "../../utils/http-error.js";
export const sourceCodePattern = /^[A-Za-z0-9_-]{16}$/;
export function acquisitionSourceUrl(business, appOrigin, source) {
  if (!source || String(source.business_id) !== String(business.id) || !sourceCodePattern.test(source.code)) throw badRequest('El origen no pertenece a este negocio.');
  const url = new URL(`/registro/${encodeURIComponent(business.slug)}`, new URL(appOrigin).origin);
  url.searchParams.set('origen', source.code);
  return url.href;
}
