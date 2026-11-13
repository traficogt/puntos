export { migrationTemplate, migrationLimits } from '../../../src/app/services/customer-migration-csv.js';

export function suggestMigrationColumns(headers) {
  const normalized = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  const choices = { phone: ['telefono', 'phone', 'celular', 'movil'], name: ['nombre', 'name', 'cliente'], points: ['saldo', 'puntos', 'points', 'balance', 'saldo inicial','progreso','sellos','visitas','stamps'] };
  const result = { phone: '', name: '', points: '' };
  for (const key of Object.keys(result)) result[key] = headers.find(header => choices[key].includes(normalized(header)) && !Object.values(result).includes(header)) || '';
  return result;
}

export function migrationPayload({ csv, columns, existingPolicy, label, confirmed, source }, requestId = null) {
  if (!columns?.phone) throw new Error('Selecciona la columna de teléfono.');
  const mapping = { phone: columns.phone };
  for (const key of ['name', 'points']) if (columns[key]) mapping[key] = columns[key];
  const payload = { csv, columns: mapping, existing_policy: existingPolicy,...(source?{source}:{}) };
  if (requestId) {
    if (!label?.trim() || label.trim().length > 100) throw new Error('Escribe un nombre de lote de hasta 100 caracteres.');
    if (confirmed !== true) throw new Error('Confirma que revisaste los clientes y el saldo inicial.');
    return { ...payload, request_id: requestId, label: label.trim(), confirmed: true };
  }
  return payload;
}
