import { DateTime, IANAZone } from 'luxon';

import {REGIONAL_COUNTRIES, REGIONAL_CURRENCY_CODES} from '../../../public/regional-catalog.js';
export {REGIONAL_COUNTRIES} from '../../../public/regional-catalog.js';
const currencies = new Set(REGIONAL_CURRENCY_CODES);
function bad(message) { return Object.assign(new Error(message), { statusCode: 400, code: 'INVALID_REGION' }); }
export function validateRegionalInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['country', 'currency', 'timezone'].includes(k))) throw bad('Configuración regional inválida.');
  const { country, currency, timezone } = input;
  if (!Object.hasOwn(REGIONAL_COUNTRIES, country) || !currencies.has(currency)) throw bad('País o moneda no admitidos.');
  if (typeof timezone !== 'string' || !timezone.includes('/') || !IANAZone.isValidZone(timezone)) throw bad('Selecciona una zona horaria IANA válida.');
  return { country, currency, timezone };
}
export function businessRegion(business = {}) {
  const raw = business?.program_json?.region || {};
  const country = Object.hasOwn(REGIONAL_COUNTRIES, raw.country) ? raw.country : 'GT';
  const defaults = REGIONAL_COUNTRIES[country];
  const currency = currencies.has(raw.currency) ? raw.currency : defaults.currency;
  const timezone = typeof raw.timezone === 'string' && IANAZone.isValidZone(raw.timezone) ? raw.timezone : defaults.timezone;
  return { country, currency, timezone, locale: defaults.locale, minorUnits: currency === 'CLP' ? 0 : 2 };
}
export const regionCurrency = business => businessRegion(business).currency;
export const regionTimezone = business => businessRegion(business).timezone;
export function assertRegionAmount(amount, currency, business) {
  const region = businessRegion(business);
  if (currency !== region.currency) throw Object.assign(bad(`La moneda debe ser ${region.currency}. PF no realiza conversiones.`), { code: 'CURRENCY_MISMATCH' });
  const scale = 10 ** region.minorUnits;
  if (!Number.isFinite(amount) || amount < 0 || Math.abs(amount * scale - Math.round(amount * scale)) > 1e-7) throw bad(`El importe admite ${region.minorUnits} decimales en ${region.currency}.`);
  return amount;
}
export function regionalLocalDate(now, business) {
  return DateTime.fromJSDate(new Date(now), { zone: regionTimezone(business) }).toISODate();
}
export function regionalWindow(now = new Date(), business = {}, { startHour = 9, endHour = 18 } = {}) {
  const local = DateTime.fromJSDate(new Date(now), { zone: regionTimezone(business) });
  if (!local.isValid) throw bad('Fecha inválida.');
  if (local.hour >= startHour && local.hour < endHour) return { allowed: true, nextAt: null };
  let next = local.startOf('day').set({ hour: startHour });
  if (local.hour >= endHour) next = next.plus({ days: 1 });
  return { allowed: false, nextAt: next.toJSDate() };
}
