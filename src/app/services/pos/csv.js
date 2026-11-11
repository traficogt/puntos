import { badRequest } from "../../../utils/http-error.js";
import { normalizePhone } from "../../../utils/phone.js";

const MAX_BYTES = 200 * 1024;
const MAX_ROWS = 100;
const PAID_STATUSES = new Set(["paid", "completed", "pagado", "pagada"]);
const REQUIRED_COLUMNS = ["saleId", "customerPhone", "amountQ"];
const COLUMN_NAMES = [...REQUIRED_COLUMNS, "status", "items"];

/** @typedef {{row: number, values: string[]}} CsvRow */

function detectDelimiter(csv) {
  let quoted = false;
  let commas = 0;
  let semicolons = 0;
  let content = false;
  for (let i = 0; i < csv.length; i += 1) {
    const char = csv[i];
    if (char === '"') {
      if (quoted && csv[i + 1] === '"') i += 1;
      else quoted = !quoted;
      content = true;
    } else if (!quoted && (char === "\r" || char === "\n")) {
      if (content) break;
    } else {
      if (char.trim()) content = true;
      if (!quoted && char === ",") commas += 1;
      if (!quoted && char === ";") semicolons += 1;
    }
  }
  if (commas && semicolons) throw badRequest("El encabezado CSV mezcla comas y punto y coma; usa un solo separador.");
  return semicolons ? ";" : ",";
}

/** @param {unknown} input */
function parseDocument(input, limits = {}) {
  const maxBytes = Math.min(750 * 1024, limits.bytes ?? MAX_BYTES);
  const maxRows = Math.min(5000, limits.rows ?? MAX_ROWS);
  if (typeof input !== "string") throw badRequest("El CSV debe ser texto.");
  if (new TextEncoder().encode(input).length > maxBytes) throw badRequest(`El CSV no puede superar ${maxBytes / 1024} KB.`);
  const csv = input.replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(csv);
  /** @type {CsvRow[]} */
  const records = [];
  let fields = [];
  let field = "";
  let state = "bare";
  let quotedRecord = false;
  let line = 1;
  let recordLine = 1;

  function finishRecord() {
    // Blank physical lines are not records. Delimiters and quoted empty cells are.
    if (fields.length || field.trim() || quotedRecord) {
      fields.push(field);
      records.push({ row: recordLine, values: fields });
      if (records.length > maxRows + 1) throw badRequest(`El CSV admite hasta ${maxRows} filas de datos; divide el archivo.`);
    }
    fields = [];
    field = "";
    state = "bare";
    quotedRecord = false;
  }

  for (let i = 0; i < csv.length; i += 1) {
    const char = csv[i];
    if (state === "quoted") {
      if (char === '"') {
        if (csv[i + 1] === '"') {
          field += '"';
          i += 1;
        } else state = "closed";
      } else {
        field += char;
        if (char === "\r" || char === "\n") {
          if (char === "\r" && csv[i + 1] === "\n") {
            field += "\n";
            i += 1;
          }
          line += 1;
        }
      }
      continue;
    }
    if (char === delimiter) {
      fields.push(field);
      field = "";
      state = "bare";
    } else if (char === "\r" || char === "\n") {
      finishRecord();
      if (char === "\r" && csv[i + 1] === "\n") i += 1;
      line += 1;
      recordLine = line;
    } else if (char === '"' && state === "bare" && field === "") {
      state = "quoted";
      quotedRecord = true;
    } else if (char === '"' || state === "closed") {
      throw badRequest(`CSV inválido en la fila ${recordLine}: revisa las comillas.`);
    } else field += char;
  }
  if (state === "quoted") throw badRequest(`CSV inválido en la fila ${recordLine}: falta cerrar las comillas.`);
  finishRecord();
  if (!records.length) throw badRequest("El CSV debe incluir encabezados.");
  const headers = records[0].values.map(value => value.trim());
  if (headers.some(value => !value) || new Set(headers).size !== headers.length) {
    throw badRequest("Los encabezados CSV deben ser únicos y no estar vacíos.");
  }
  const rows = records.slice(1);
  for (const { row, values } of rows) {
    if (values.length !== headers.length) throw badRequest(`La fila ${row} tiene ${values.length} columnas; se esperaban ${headers.length}.`);
  }
  return { headers, rows, delimiter };
}

/**
 * Parse without coercing cell values. `row` is the physical starting line (1-based),
 * including header/blank lines; rows.length counts data records, not quoted newlines.
 * Structural errors reject the whole document so no trailing data can be lost.
 * @param {unknown} csv
 */
export function parsePosCsv(csv, limits = {}) {
  const { headers, rows } = parseDocument(csv, limits);
  return { headers, rows };
}

function mapColumns(headers, columns) {
  if (!columns || typeof columns !== "object" || Array.isArray(columns)) throw badRequest("Selecciona las columnas del CSV.");
  /** @type {Record<string, number>} */
  const mapping = {};
  for (const [name, header] of Object.entries(columns)) {
    if (!COLUMN_NAMES.includes(name)) throw badRequest(`Columna de destino desconocida: ${name}.`);
    if (!REQUIRED_COLUMNS.includes(name) && (header === "" || header == null)) continue;
    if (typeof header !== "string" || !headers.includes(header)) throw badRequest(`Selecciona un encabezado válido para ${name}.`);
    const index = headers.indexOf(header);
    if (Object.values(mapping).includes(index)) throw badRequest("Cada campo debe usar una columna diferente.");
    mapping[name] = index;
  }
  for (const name of REQUIRED_COLUMNS) {
    if (mapping[name] === undefined) throw badRequest(`Falta seleccionar la columna ${name}.`);
  }
  return mapping;
}

function parseAmount(value, amountUnit, delimiter, minorUnits = 2) {
  const input = value.trim();
  const pattern = amountUnit === "minor" ? /^\d+$/ : delimiter === ";" ? /^\d+(?:[.,]\d{1,2})?$/ : /^\d+(?:\.\d{1,2})?$/;
  if (!pattern.test(input)) return null;
  const [whole, decimal = ""] = input.replace(",", ".").split(".");
  const centsText = amountUnit === "minor" ? whole : `${whole}${decimal.padEnd(2, "0")}`;
  const cents = Number(centsText);
  if (!Number.isSafeInteger(cents) || cents < 0) return null;
  return amountUnit === "minor" ? cents / (10 ** minorUnits) : cents / 100;
}

/**
 * An omitted mapping inspects headers. A supplied mapping must be complete.
 * This pure normalizer never looks up or enrolls customers and never awards points.
 * @param {{csv: unknown, source?: unknown, columns?: unknown, amountUnit?: unknown, assumePaid?: unknown}} args
 */
export function normalizePosCsv({ csv, source, columns, amountUnit = "major", assumePaid = false }, region = {currency:"GTQ",country:"GT",minorUnits:2}) {
  const { headers, rows, delimiter } = parseDocument(csv);
  if (columns === undefined) return { headers, sales: [], issues: [] };
  const mapping = mapColumns(headers, columns);
  if (mapping.status === undefined && assumePaid !== true) throw badRequest("Selecciona el estado de pago o confirma que todas las ventas están pagadas.");
  if (amountUnit !== "major" && amountUnit !== "minor") throw badRequest("La unidad del monto debe ser major o minor.");
  if (typeof source !== "string" || !/^[\p{L}\p{N}][\p{L}\p{N} ._:-]{0,59}$/u.test(source.trim())) {
    throw badRequest("La fuente debe tener entre 1 y 60 letras, números, espacios, puntos, guiones o dos puntos.");
  }
  const stableSource = source.trim();
  const counts = new Map();
  for (const { values } of rows) {
    const saleId = values[mapping.saleId].trim();
    counts.set(saleId, (counts.get(saleId) || 0) + 1);
  }
  const sales = [];
  const issues = [];
  for (const { row, values } of rows) {
    const saleId = values[mapping.saleId].trim();
    const issue = (code, message, status = "error") => issues.push({ row, saleId, code, message, status });
    if (saleId && counts.get(saleId) > 1) {
      issue("DUPLICATE_SALE_ID", "El ID de venta aparece varias veces en este CSV; revisa todas sus filas.");
      continue;
    }
    if (mapping.status !== undefined && !PAID_STATUSES.has(values[mapping.status].trim().toLowerCase())) {
      issue("UNPAID_STATUS", "Solo se importan ventas con estado paid, completed, pagado o pagada.", "ignored");
      continue;
    }
    if (!saleId || saleId.length > 200 || /[\p{Cc}\p{Cf}]/u.test(saleId)) {
      issue("INVALID_SALE_ID", "La venta necesita un ID estable de 1 a 200 caracteres sin caracteres de control.");
      continue;
    }
    const phone = values[mapping.customerPhone].trim();
    const customerPhone = normalizePhone(phone,region.country);
    if (!/^[+\d() .-]+$/.test(phone) || !/^\d{8,15}$/.test(customerPhone)) {
      issue("INVALID_CUSTOMER_PHONE", "La venta necesita un teléfono válido de un cliente ya inscrito.");
      continue;
    }
    const amountQ = parseAmount(values[mapping.amountQ], amountUnit, delimiter,region.minorUnits);
    if (amountQ === null || region.minorUnits===0 && !Number.isInteger(amountQ)) {
      issue("INVALID_AMOUNT", "Usa un monto no negativo sin separadores de miles, con hasta dos decimales; los centavos deben ser enteros.");
      continue;
    }
    const itemText = mapping.items === undefined ? "0" : values[mapping.items].trim();
    const items = Number(itemText);
    if (!/^\d+$/.test(itemText) || !Number.isSafeInteger(items)) {
      issue("INVALID_ITEMS", "La cantidad de artículos debe ser un entero no negativo.");
      continue;
    }
    sales.push({ row, saleId, source: stableSource, customerPhone, amountQ, currency: region.currency, visits: 1, items });
  }
  return { headers, sales, issues };
}
