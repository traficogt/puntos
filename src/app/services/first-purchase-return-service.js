import { DateTime } from 'luxon';
import { badRequest, notFound } from '../../utils/http-error.js';
import { dbQuery } from '../database.js';
import { readinessForBusiness } from './merchant-data-readiness.js';
import { businessRegion } from './regional-settings.js';
import { reportingPurchase } from './reporting-purchase.js';

// Find the business-wide first purchase before applying either cohort filter.
// All history and follow-up counts share a single statement snapshot. Inlining
// eligible lets PostgreSQL use transaction indexes for each return lookup.
const RETURN_SQL = `
WITH bounds AS (
  SELECT $3::date::timestamp AT TIME ZONE $4 AS start_at,
    ($3::date + 7)::timestamp AT TIME ZONE $4 AS end_at,
    $5::timestamptz AS snapshot_at
), eligible AS NOT MATERIALIZED (
  SELECT t.id, t.customer_id, t.branch_id, t.created_at,
    COALESCE(t.purchase_occurred_at, t.created_at) AS purchased_at,
    t.purchase_occurred_at IS NULL AS legacy_timestamp
  FROM transactions t
  JOIN customers c ON c.id = t.customer_id AND c.business_id = $1::uuid
  CROSS JOIN bounds b
  WHERE t.business_id = $1::uuid
    AND t.created_at < b.snapshot_at
    AND COALESCE(t.purchase_occurred_at, t.created_at) < b.snapshot_at
    AND ${reportingPurchase('t')}
), first_purchase AS (
  SELECT DISTINCT ON (customer_id) customer_id, branch_id, purchased_at, legacy_timestamp
  FROM eligible ORDER BY customer_id, purchased_at, created_at, id
), cohort AS (
  SELECT f.* FROM first_purchase f CROSS JOIN bounds b
  WHERE f.purchased_at >= b.start_at AND f.purchased_at < b.end_at
    AND ($2::uuid IS NULL OR f.branch_id = $2::uuid)
), followed AS (
  SELECT f.*, f.purchased_at + interval '720 hours' <= b.snapshot_at AS completed,
    EXISTS (
      SELECT 1 FROM eligible p
      WHERE p.customer_id = f.customer_id
        AND p.purchased_at > f.purchased_at
        AND p.purchased_at < f.purchased_at + interval '720 hours'
        AND (p.purchased_at AT TIME ZONE $4)::date > (f.purchased_at AT TIME ZONE $4)::date
    ) AS returned
  FROM cohort f CROSS JOIN bounds b
), totals AS (
  SELECT COUNT(*) AS customers,
    COUNT(*) FILTER (WHERE legacy_timestamp) AS legacy_timestamp_customers,
    COUNT(*) FILTER (WHERE completed) AS completed_customers,
    COUNT(*) FILTER (WHERE completed AND returned) AS completed_returned,
    COUNT(*) FILTER (WHERE NOT completed) AS ongoing_customers,
    COUNT(*) FILTER (WHERE NOT completed AND returned) AS ongoing_returned
  FROM followed
)
SELECT b.start_at, b.end_at, t.customers, t.legacy_timestamp_customers,
  jsonb_build_object(
    'customers', t.completed_customers,
    'returned_customers', t.completed_returned,
    'without_return_customers', t.completed_customers - t.completed_returned,
    'return_rate_pct', ROUND(100.0 * t.completed_returned / NULLIF(t.completed_customers, 0), 2)
  ) AS completed,
  jsonb_build_object('customers', t.ongoing_customers, 'returned_customers', t.ongoing_returned) AS ongoing
FROM bounds b CROSS JOIN totals t`;

/**
 * Read-only weekly cohorts of first genuine recorded purchases. First purchase
 * is established across the full business history available at the snapshot;
 * a branch filter selects only its branch, while returns may be at any branch.
 * A return requires a later local date and elapsed time strictly below 720h.
 * Current correction state applies, so late receipts and refunds can change
 * historical cohorts. No customer identities or point/ledger mutations occur.
 *
 * @param {{ businessId: string, branchId?: string | null, weekStart?: string, now?: Date }} options
 * @param {typeof dbQuery} query
 */
export async function getFirstPurchaseReturns({ businessId, branchId = null, weekStart, now = new Date() }, query = dbQuery) {
  const business = (await query('SELECT program_json FROM businesses WHERE id = $1::uuid', [businessId])).rows[0];
  if (!business) throw notFound('Negocio no encontrado.');
  const { timezone } = businessRegion(business);
  const monday = DateTime.fromJSDate(now, { zone: timezone }).startOf('week');
  const availableWeeks = Array.from({ length: 52 }, (_, index) => monday.minus({ weeks: index }).toISODate());
  const selectedWeek = weekStart === undefined ? availableWeeks[1] : weekStart;
  if (typeof selectedWeek !== 'string' || !availableWeeks.includes(selectedWeek)) {
    throw badRequest('Selecciona un lunes entre las 52 semanas disponibles.');
  }
  if (branchId) {
    const branch = await query('SELECT id FROM branches WHERE id = $1::uuid AND business_id = $2::uuid', [branchId, businessId]);
    if (!branch.rows.length) throw badRequest('La sucursal no pertenece a este negocio.');
  }
  const { rows: [row] } = await query(RETURN_SQL, [businessId, branchId, selectedWeek, timezone, now.toISOString()]);
  return {
    ok: true,
    generated_at: now.toISOString(),
    timezone,
    scope: { branch_id: branchId, first_purchase_scope: 'business', return_scope: 'business' },
    available_weeks: availableWeeks,
    cohort: {
      week_start: selectedWeek,
      week_end: DateTime.fromISO(selectedWeek, { zone: timezone }).plus({ days: 6 }).toISODate(),
      start: new Date(row.start_at).toISOString(),
      end: new Date(row.end_at).toISOString(),
      customers: Number(row.customers),
      legacy_timestamp_customers: Number(row.legacy_timestamp_customers)
    },
    follow_up: { days: 30, definition: 'later_local_day_within_720_hours' },
    completed: row.completed,
    ongoing: row.ongoing,
    data_readiness: readinessForBusiness(business, now),
    notes: [
      'Cada cliente entra una vez, en la semana de su primera compra válida registrada en todo el historial disponible del negocio. La semana empieza el lunes en la zona horaria del negocio.',
      'Volver significa otra compra registrada en una fecha local posterior a la primera y antes de que transcurran 30 días exactos (720 horas). Varias compras en la misma fecha local no cuentan como regreso.',
      'Se usa la fecha de compra cuando está disponible; si falta, se usa la fecha de registro en PF. Tanto la compra como su recepción en el servidor deben ser anteriores al momento de este informe.',
      'El porcentaje usa a todos los clientes que ya completaron los 30 días, incluso si no volvieron. Los clientes en seguimiento se muestran aparte, aunque ya hayan vuelto.',
      'La sucursal seleccionada corresponde a la primera compra del cliente en todo el negocio. Una compra posterior en cualquier sucursal del negocio cuenta como regreso. Las primeras compras sin sucursal solo aparecen al consultar todas.',
      'Las compras incluyen puntos pendientes o posteriormente vencidos y excluyen devoluciones completas, ajustes, bonos y saldos iniciales importados. El vencimiento de puntos no anula una compra.',
      'Son compras registradas en PF. Una compra fuera del programa no aparece; las sincronizaciones, devoluciones y correcciones posteriores pueden cambiar la primera compra y los resultados.',
      'El historial de clientes eliminados permanece en estos totales sin datos personales. Los indicadores de conexión no acreditan todas las ventas del negocio.',
      'Describe comportamiento registrado. No demuestra visitas causadas por el programa, ingresos incrementales ni retorno de inversión.'
    ]
  };
}
