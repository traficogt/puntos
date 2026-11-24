/**
 * @param {string | number | Date | null | undefined} s
 * @param {{ locale?: string, timezone?: string }} [region]
 */
export function fmtDT(s, region = undefined) {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(
    region?.locale,
    region?.timezone ? { timeZone: region.timezone } : undefined,
  );
}
