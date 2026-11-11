import test from 'node:test';
import assert from 'node:assert/strict';

import * as migration from '../../src/app/services/customer-migration-csv.js';
const columns = { phone: 'Teléfono', name: 'Nombre', points: 'Saldo' };
const normalize = (csv, extra = {}) => {
  assert.equal(typeof migration.normalizeCustomerMigration, 'function', 'Customer migration normalizer must exist');
  return migration.normalizeCustomerMigration({ csv, columns, ...extra });
};

test('migration normalizes tenant identity, BOM, quoted names, CRLF and semicolon CSV', () => {
  const out = normalize('\uFEFFTeléfono;Nombre;Saldo\r\n5555-0001;"Ana; López";12\r\n+502 5555 0002;Beto;0');
  assert.deepEqual(out.rows, [{ row: 2, phone: '50255550001', name: 'Ana; López', points: 12, issues: [] }, { row: 3, phone: '50255550002', name: 'Beto', points: 0, issues: [] }]);
});

test('all normalized duplicate phones are errors; bad balances and names are never coerced', () => {
  const out = normalize('Teléfono,Nombre,Saldo\n55550001,Ana,10\n50255550001,Beto,20\n55550002,Carlos,-1\n55550003,Dora,1.5\n55550004,Eva,2147483648\n55550005,Fernanda,1e3\nwrong,Gina,1');
  assert.deepEqual(out.rows.map(row => row.issues[0]?.code), ['DUPLICATE_PHONE', 'DUPLICATE_PHONE', 'INVALID_POINTS', 'INVALID_POINTS', 'INVALID_POINTS', 'INVALID_POINTS', 'INVALID_PHONE']);
  assert.equal(normalize(`Teléfono,Nombre,Saldo\n55550001,${'A'.repeat(121)},0`).rows[0].issues[0].code, 'INVALID_NAME');
});

test('only phone is required; omitted balance means zero and names stay optional', () => {
  assert.deepEqual(normalize('Teléfono\n55550001', { columns: { phone: 'Teléfono' } }).rows[0], { row: 2, phone: '50255550001', name: null, points: 0, issues: [] });
});

test('mapping must use distinct real columns and never accepts extra sensitive fields', () => {
  for (const mapped of [{}, { phone: 'Missing' }, { phone: 'Teléfono', name: 'Teléfono' }, { ...columns, consent: 'Nombre' }]) {
    assert.throws(() => normalize('Teléfono,Nombre,Saldo\n55550001,Ana,1', { columns: mapped }), { statusCode: 400 });
  }
});

test('bounded parser rejects malformed/trailing rows and measures UTF-8 bytes', () => {
  for (const csv of ['Teléfono,Nombre,Saldo\n55550001,Ana,1\n55550002', 'Teléfono,Nombre,Saldo\n55550001,"Ana,1', `Teléfono\n${Array.from({ length: 101 }, (_, i) => 55550000 + i).join('\n')}`, `Teléfono\n${'é'.repeat(102400)}`]) {
    assert.throws(() => normalize(csv), { statusCode: 400 });
  }
  assert.throws(() => normalize('Teléfono,Nombre,Saldo'), /al menos/);
});

test('inspection returns headers without mapping and the CSV template is importable', () => {
  assert.equal(typeof migration.migrationTemplate, 'string');
  assert.deepEqual(normalize('Teléfono,Nombre,Saldo\n55550001,Ana,0', { columns: undefined }).headers, ['Teléfono', 'Nombre', 'Saldo']);
  assert.equal(normalize(migration.migrationTemplate).rows.length, 2);
});
