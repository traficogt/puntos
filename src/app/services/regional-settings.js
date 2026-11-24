import { DateTime, IANAZone } from "luxon";

import { REGIONAL_COUNTRIES, REGIONAL_CURRENCY_CODES } from "../../../public/regional-catalog.js";
import { hasMaxScale } from "../../utils/money.js";
export { REGIONAL_COUNTRIES } from "../../../public/regional-catalog.js";
const currencies = new Set(REGIONAL_CURRENCY_CODES);

/**
 * Resolved operating region of a business.
 * @typedef {{ country: string, currency: string, timezone: string, locale: string, minorUnits: number }} RegionalSettings
 *
 * Any business row (or partial fixture) whose program_json may carry a `region`
 * entry. The row itself belongs to the repositories owner; only that key is read.
 * @typedef {{ program_json?: Record<string, any> | null } | null | undefined} RegionalBusiness
 */

/** @param {string} message */
function bad(message) {
  return Object.assign(new Error(message), { statusCode: 400, code: "INVALID_REGION" });
}
/**
 * @param {Record<string, any> | null | undefined} input untrusted settings body
 * @returns {{ country: string, currency: string, timezone: string }}
 */
export function validateRegionalInput(input) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((k) => !["country", "currency", "timezone"].includes(k))
  )
    throw bad("Configuración regional inválida.");
  const { country, currency, timezone } = input;
  if (!Object.hasOwn(REGIONAL_COUNTRIES, country) || !currencies.has(currency))
    throw bad("País o moneda no admitidos.");
  if (typeof timezone !== "string" || !timezone.includes("/") || !IANAZone.isValidZone(timezone))
    throw bad("Selecciona una zona horaria IANA válida.");
  return { country, currency, timezone };
}
/**
 * @param {RegionalBusiness} [business]
 * @returns {RegionalSettings}
 */
export function businessRegion(business = {}) {
  const raw = business?.program_json?.region || {};
  const country = /** @type {keyof typeof REGIONAL_COUNTRIES} */ (
    Object.hasOwn(REGIONAL_COUNTRIES, raw.country) ? raw.country : "GT"
  );
  const defaults = REGIONAL_COUNTRIES[country];
  const currency = currencies.has(raw.currency) ? raw.currency : defaults.currency;
  const timezone =
    typeof raw.timezone === "string" && IANAZone.isValidZone(raw.timezone)
      ? raw.timezone
      : defaults.timezone;
  return {
    country,
    currency,
    timezone,
    locale: defaults.locale,
    minorUnits: currency === "CLP" ? 0 : 2,
  };
}
/** @param {RegionalBusiness} [business] */
export const regionCurrency = (business) => businessRegion(business).currency;
/** @param {RegionalBusiness} [business] */
export const regionTimezone = (business) => businessRegion(business).timezone;
/**
 * @param {number} amount
 * @param {string} currency
 * @param {RegionalBusiness} [business]
 */
export function assertRegionAmount(amount, currency, business) {
  const region = businessRegion(business);
  if (currency !== region.currency)
    throw Object.assign(bad(`La moneda debe ser ${region.currency}. PF no realiza conversiones.`), {
      code: "CURRENCY_MISMATCH",
    });
  if (!Number.isFinite(amount) || amount < 0 || !hasMaxScale(amount, region.minorUnits))
    throw bad(`El importe admite ${region.minorUnits} decimales en ${region.currency}.`);
  return amount;
}
/**
 * @param {Date | string | number} now
 * @param {RegionalBusiness} business
 */
export function regionalLocalDate(now, business) {
  const date = DateTime.fromJSDate(new Date(now), { zone: regionTimezone(business) }).toISODate();
  // An invalid instant or zone previously surfaced later as a TypeError on .slice().
  if (!date) throw new Error("Fecha local no válida para la región del negocio.");
  return date;
}
/**
 * @param {Date | string | number} [now]
 * @param {RegionalBusiness} [business]
 * @param {{ startHour?: number, endHour?: number }} [hours]
 */
export function regionalWindow(
  now = new Date(),
  business = {},
  { startHour = 9, endHour = 18 } = {},
) {
  const local = DateTime.fromJSDate(new Date(now), { zone: regionTimezone(business) });
  if (!local.isValid) throw bad("Fecha inválida.");
  if (local.hour >= startHour && local.hour < endHour) return { allowed: true, nextAt: null };
  let next = local.startOf("day").set({ hour: startHour });
  if (local.hour >= endHour) next = next.plus({ days: 1 });
  return { allowed: false, nextAt: next.toJSDate() };
}
