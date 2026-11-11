export function fmtDT(s, region = undefined) {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(region?.locale, region?.timezone ? {timeZone: region.timezone} : undefined);
}

