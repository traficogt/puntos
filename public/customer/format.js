// Wallet text follows the business region; Guatemala is the platform default.
const DEFAULT_LOCALE = "es-GT";
const DEFAULT_TIMEZONE = "America/Guatemala";

export function fmtDT(s, region = undefined) {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(region?.locale || DEFAULT_LOCALE, { timeZone: region?.timezone || DEFAULT_TIMEZONE });
}

/**
 * @param {number} value
 * @param {{locale?: string} | undefined} [region]
 * @param {Intl.NumberFormatOptions} [options]
 */
export function formatNumber(value, region = undefined, options = undefined) {
  return new Intl.NumberFormat(region?.locale || DEFAULT_LOCALE, options).format(value);
}

/**
 * @param {Date | string | number} value
 * @param {{locale?: string, timezone?: string} | undefined} [region]
 * @param {Intl.DateTimeFormatOptions} [options]
 */
export function formatDate(value, region = undefined, options = { dateStyle: "medium" }) {
  return new Intl.DateTimeFormat(region?.locale || DEFAULT_LOCALE, { ...options, timeZone: region?.timezone || DEFAULT_TIMEZONE }).format(new Date(value));
}

/**
 * Spanish agreement for a point count: "1 punto", "12,345 puntos".
 * @param {number} value
 * @param {{locale?: string} | undefined} [region]
 */
export function formatPoints(value, region = undefined) {
  return `${formatNumber(value, region)} ${Math.abs(Number(value)) === 1 ? "punto" : "puntos"}`;
}

/**
 * "Te falta 1 punto", "Te faltan 20 puntos".
 * @param {number} value
 * @param {{locale?: string} | undefined} [region]
 */
export function missingPointsText(value, region = undefined) {
  return `Te ${Math.abs(Number(value)) === 1 ? "falta" : "faltan"} ${formatPoints(value, region)}`;
}

/**
 * The business region rendered into the wallet shell, for controls outside the
 * section renderers.
 * @param {(selector: string) => Element | null} $
 */
export function walletRegion($) {
  const data = /** @type {HTMLElement | null} */ ($("#main"))?.dataset;
  return data?.locale ? { locale: data.locale, timezone: data.timezone || undefined } : undefined;
}
