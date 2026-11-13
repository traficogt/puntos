import { parsePosCsv } from './pos/csv.js';
import { normalizePhone } from '../../utils/phone.js';
import { badRequest } from '../../utils/http-error.js';
import { MAX_LEDGER_INTEGER } from '../../utils/ledger-limits.js';

export const migrationTemplate = 'Teléfono,Nombre,Saldo\r\n55550001,Ana de ejemplo,100\r\n55550002,Luis de ejemplo,0\r\n';
export const migrationLimits = { rows: 100, bytes: 200 * 1024, points: MAX_LEDGER_INTEGER };

/** Pure, bounded normalization shared by the server and the isolated demonstration. */
export function normalizeCustomerMigration({ csv = undefined, columns = undefined, limits = undefined, country = 'GT', source = undefined }) {
  if(source&&(!['csv_balance','paper_card','progress'].includes(source.type)||!source.label?.trim()||!source.evidence?.trim()))throw badRequest('Registra el origen y la evidencia de la conversión.');
  if(source?.evidence_type==='photo')throw badRequest('Una foto no prueba el saldo. Usa un registro verificado por el dueño.');
  const converted=source&&source.type!=='csv_balance';
  if(converted&&(!source.conversion?.approved||!Number.isSafeInteger(source.conversion.points_per_unit)||source.conversion.points_per_unit<1||source.conversion.points_per_unit>100000))throw badRequest('La conversión requiere aprobación del dueño y puntos enteros por unidad.');
  const document = parsePosCsv(csv, limits);
  if (!document.rows.length) throw badRequest('Incluye al menos un cliente debajo del encabezado.');
  if (columns === undefined) return { headers: document.headers, rows: [] };
  if (!columns || typeof columns !== 'object' || Array.isArray(columns)) throw badRequest('Selecciona las columnas del archivo.');
  const mapping = {};
  for (const [key, header] of Object.entries(columns)) {
    if (!['phone', 'name', 'points'].includes(key)) throw badRequest('El archivo solo admite teléfono, nombre y saldo inicial.');
    if (key !== 'phone' && (header === '' || header == null)) continue;
    if (typeof header !== 'string' || !document.headers.includes(header)) throw badRequest('Selecciona un encabezado válido para cada campo.');
    const index = document.headers.indexOf(header);
    if (Object.values(mapping).includes(index)) throw badRequest('Cada campo debe usar una columna diferente.');
    mapping[key] = index;
  }
  if (mapping.phone === undefined) throw badRequest('Selecciona la columna de teléfono.');
  const rows = document.rows.map(({ row, values }) => {
    const rawPhone = values[mapping.phone].trim();
    const phone = normalizePhone(rawPhone, country);
    const name = mapping.name === undefined ? null : values[mapping.name].trim() || null;
    const rawPoints = mapping.points === undefined ? '0' : values[mapping.points].trim();
    const units = Number(rawPoints), points = units*(converted?source.conversion.points_per_unit:1);
    const issues = [];
    if ((country !== 'GT' && !rawPhone.startsWith('+')) || !/^[+\d() .-]+$/.test(rawPhone) || !/^\d{8,15}$/.test(phone)) issues.push({ code: 'INVALID_PHONE', message: country === 'GT' ? 'Usa un teléfono de 8 a 15 dígitos; los números locales se completan con 502.' : 'Usa + y el número internacional completo, con código de país.' });
    if (name && (name.length > 120 || /[\p{Cc}\p{Cf}]/u.test(name))) issues.push({ code: 'INVALID_NAME', message: 'El nombre admite hasta 120 caracteres sin saltos de línea ni caracteres de control.' });
    if (!/^\d+$/.test(rawPoints) || !Number.isInteger(points) || points > MAX_LEDGER_INTEGER) issues.push({ code: 'INVALID_POINTS', message: 'El saldo debe ser un entero entre 0 y 2,147,483,647, sin separadores.' });
    return { row, phone, name, points: Number.isSafeInteger(points) ? points : null, ...(converted?{source_units:units}:{}), issues };
  });
  const counts = new Map();
  for (const row of rows) counts.set(row.phone, (counts.get(row.phone) || 0) + 1);
  for (const row of rows) if (row.phone && counts.get(row.phone) > 1) row.issues.unshift({ code: 'DUPLICATE_PHONE', message: 'Este teléfono aparece varias veces en el archivo. Conserva una sola fila.' });
  return { headers: document.headers, rows };
}

export function summarizeCustomerMigration(normalized, existingPhones, existingPolicy = 'skip') {
  if (!['skip', 'reject'].includes(existingPolicy)) throw badRequest('Selecciona si se omiten los clientes existentes o se rechaza el lote.');
  const existing = new Set(existingPhones);
  const rows = normalized.rows.map(row => ({ ...row, status: row.issues.length ? 'error' : existing.has(row.phone) ? 'existing' : 'new' }));
  const summary = { total: rows.length, new_customers: 0, existing_customers: 0, errors: 0, opening_points: 0 };
  for (const row of rows) {
    if (row.status === 'new') { summary.new_customers += 1; summary.opening_points += row.points; }
    else if (row.status === 'existing') summary.existing_customers += 1;
    else summary.errors += 1;
  }
  return { headers: normalized.headers, rows, summary, can_commit: rows.length > 0 && !summary.errors && (existingPolicy === 'skip' || !summary.existing_customers) };
}
