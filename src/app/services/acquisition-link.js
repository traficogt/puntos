import { badRequest } from "../../utils/http-error.js";
export const sourceCodePattern = /^[A-Za-z0-9_-]{16}$/;

/** @typedef {{ id: string, slug: string }} AcquisitionBusiness */
/**
 * acquisition_sources row as the service selects it.
 * @typedef {{
 *   id: string,
 *   business_id: string,
 *   name: string,
 *   code: string,
 *   branch_id: string | null,
 *   created_at: string | Date,
 *   branch_name?: string | null,
 * }} AcquisitionSourceRow
 */

/**
 * @param {AcquisitionBusiness} business
 * @param {string} appOrigin
 * @param {Pick<AcquisitionSourceRow, "business_id" | "code"> | null | undefined} source
 */
export function acquisitionSourceUrl(business, appOrigin, source) {
  if (
    !source ||
    String(source.business_id) !== String(business.id) ||
    !sourceCodePattern.test(source.code)
  )
    throw badRequest("El origen no pertenece a este negocio.");
  const url = new URL(`/registro/${encodeURIComponent(business.slug)}`, new URL(appOrigin).origin);
  url.searchParams.set("origen", source.code);
  return url.href;
}
