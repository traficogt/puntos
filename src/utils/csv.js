import { stringify } from "csv-stringify/sync";

/** @param {unknown} value a cell value; null/undefined stay empty */
function sanitizeForSpreadsheet(value) {
  if (value === null || value === undefined) return value;
  const s = String(value);
  // Prevent CSV / formula injection in Excel/Sheets.
  // If the cell starts with whitespace followed by one of these characters,
  // spreadsheet apps may treat it as a formula.
  if (/^[\s\u0000]*[=+\-@]/.test(s)) {
    return "'" + s;
  }
  return s;
}

/**
 * Serializes rows as CSV with a header, neutralizing formula injection.
 * @param {ReadonlyArray<Record<string, unknown>> | null | undefined} rows
 * @param {string[]} [columns] column order; defaults to each row's own keys
 */
export function toCSV(rows, columns) {
  const safeRows = (rows || []).map((r) => {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const k of Array.isArray(columns) ? columns : Object.keys(r || {})) {
      out[k] = sanitizeForSpreadsheet(r?.[k]);
    }
    return out;
  });

  return stringify(safeRows, { header: true, columns });
}
