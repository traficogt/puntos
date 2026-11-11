import { badRequest, notFound } from '../../utils/http-error.js';
import { dbQuery } from '../database.js';
import { businessRegion } from './regional-settings.js';
import { reportingPurchase } from './reporting-purchase.js';

// All counts come from one database statement/snapshot. There is no history
// page limit and no customer-level data in the result. Eligibility uses current
// correction state: later refunds/restorations can change a historical cohort.
const RETURN_SQL = `
WITH bounds AS (
  SELECT (($5::timestamptz AT TIME ZONE $4)::date - ($3::int - 1))::timestamp AT TIME ZONE $4 AS start_at,
    $5::timestamptz AS end_at
), eligible AS (
  SELECT r.id, r.customer_id,
    COALESCE(p.recorded_at, r.redeemed_at, r.created_at) AS redeemed_at,
    p.recorded_at IS NULL AND r.redeemed_at IS NULL AS legacy_timestamp
  FROM redemptions r
  JOIN customers c ON c.id = r.customer_id AND c.business_id = $1::uuid
  JOIN rewards w ON w.id = r.reward_id AND w.business_id = $1::uuid
  LEFT JOIN pos_checkout_intents p ON p.business_id = $1::uuid AND p.redemption_id = r.id
  CROSS JOIN bounds b
  WHERE r.business_id = $1::uuid
    AND ($2::uuid IS NULL OR r.branch_id = $2::uuid)
    AND r.status = 'REDEEMED'
    AND (p.redemption_id IS NULL OR (p.status = 'recorded' AND p.recorded_at IS NOT NULL))
    AND COALESCE(p.recorded_at, r.redeemed_at, r.created_at) >= b.start_at
    AND COALESCE(p.recorded_at, r.redeemed_at, r.created_at) < b.end_at
    AND NOT EXISTS (
      SELECT 1 FROM service_redemption_restorations s
      WHERE s.business_id = $1::uuid AND s.redemption_id = r.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM transactions d
      WHERE d.business_id = $1::uuid AND d.source = 'redeem'
        AND d.meta->>'redemption_id' = r.id::text
        AND (d.reversed_transaction_id IS NOT NULL OR d.status <> 'POSTED')
    )
    AND NOT EXISTS (
      SELECT 1 FROM redemption_pos_records f
      WHERE f.business_id = $1::uuid AND f.redemption_id = r.id AND f.returned_quantity > 0
    )
), first_redemption AS (
  SELECT DISTINCT ON (customer_id) customer_id, redeemed_at, legacy_timestamp
  FROM eligible ORDER BY customer_id, redeemed_at, id
), followed AS (
  SELECT f.*, f.redeemed_at + interval '720 hours' <= b.end_at AS completed,
    EXISTS (
      SELECT 1 FROM transactions t
      WHERE t.business_id = $1::uuid AND t.customer_id = f.customer_id
        AND ($2::uuid IS NULL OR t.branch_id = $2::uuid)
        AND t.created_at > f.redeemed_at
        AND t.created_at < f.redeemed_at + interval '720 hours'
        AND t.created_at < b.end_at
        AND (t.created_at AT TIME ZONE $4)::date > (f.redeemed_at AT TIME ZONE $4)::date
        AND ${reportingPurchase('t')}
    ) AS returned
  FROM first_redemption f CROSS JOIN bounds b
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
 * The selected local-date window ends at the snapshot instant. Each customer
 * enters once on their first eligible redemption WITHIN that window (not their
 * lifetime first redemption). Follow-up is [redemption, redemption + 720 hours),
 * with returns restricted to later business-local dates. Completed cohorts use
 * every fully observed customer, including those with no return, as denominator.
 * Branch selection applies to both redemptions and subsequent purchases.
 *
 * @param {{ businessId: string, branchId?: string | null, days?: number, now?: Date }} options
 * @param {typeof dbQuery} query
 */
export async function getRedemptionReturns({ businessId, branchId = null, days = 90, now = new Date() }, query = dbQuery) {
  if (![7, 30, 90].includes(days)) throw badRequest('El período debe ser de 7, 30 o 90 días.');
  const business = (await query('SELECT program_json FROM businesses WHERE id = $1::uuid', [businessId])).rows[0];
  if (!business) throw notFound('Negocio no encontrado.');
  const { timezone } = businessRegion(business);
  if (branchId) {
    const branch = await query('SELECT id FROM branches WHERE id = $1::uuid AND business_id = $2::uuid', [branchId, businessId]);
    if (!branch.rows.length) throw badRequest('La sucursal no pertenece a este negocio.');
  }
  const { rows: [row] } = await query(RETURN_SQL, [businessId, branchId, days, timezone, now.toISOString()]);
  return {
    ok: true,
    generated_at: now.toISOString(),
    timezone,
    scope: { branch_id: branchId },
    cohort: {
      days,
      start: new Date(row.start_at).toISOString(),
      end: new Date(row.end_at).toISOString(),
      customers: Number(row.customers),
      legacy_timestamp_customers: Number(row.legacy_timestamp_customers)
    },
    follow_up: { days: 30, definition: 'later_local_day_within_720_hours' },
    completed: row.completed,
    ongoing: row.ongoing,
    notes: [
      'Cada cliente entra una vez, en su primer canje válido dentro del período elegido; no necesariamente es su primer canje histórico.',
      'Volver significa una compra registrada en una fecha local posterior al canje y antes de que transcurran 30 días exactos (720 horas).',
      'El porcentaje usa a todos los clientes que ya completaron los 30 días, incluso si no volvieron. Los clientes en seguimiento se muestran aparte.',
      'Se excluyen canjes cancelados, restituidos, corregidos o con devoluciones registradas. Las autorizaciones de caja pendientes no cuentan como entrega.',
      'Las compras incluyen puntos pendientes o posteriormente vencidos y excluyen devoluciones completas, ajustes, bonos y saldos iniciales importados. El vencimiento de puntos no anula una compra.',
      'La sucursal seleccionada se aplica al canje y a la compra posterior. Los registros sin sucursal solo cuentan al consultar todas las sucursales.',
      'Son visitas registradas en PF. Una compra fuera del programa no aparece; las sincronizaciones, devoluciones y correcciones posteriores pueden cambiar los resultados.',
      'Los registros antiguos sin fecha de entrega usan su fecha de creación. El historial de clientes eliminados permanece en estos totales sin datos personales.',
      'Muestra una asociación después del canje. No demuestra visitas causadas por la recompensa, ingresos incrementales ni retorno de inversión.'
    ]
  };
}
