import { businessRegion } from "./regional-settings.js";
import { badRequest } from "../../utils/http-error.js";
import { dbQuery } from "../database.js";
import { reportingPurchase } from './reporting-purchase.js';

// Sources identify the sale writers; type alone is unsafe because redemption,
// expiration and lifecycle writers also inherit the PURCHASE column default.
// Require recorded sale/visit/item activity; an empty award is not a purchase.
// OPENING_BALANCE/migration is excluded by both source and type. Imported
// customers' subsequent genuine purchases must still contribute normally.
// A single statement gives every aggregate the same database snapshot.
const OVERVIEW_SQL = `
WITH clock AS (
  SELECT $5::timestamptz AS end_at, $5::timestamptz AT TIME ZONE $4 AS local_now
), bounds AS (
  SELECT end_at,
    (local_now::date - ($3::int - 1))::timestamp AT TIME ZONE $4 AS start_at,
    (local_now::date - ($3::int * 2 - 1))::timestamp AT TIME ZONE $4 AS previous_start_at,
    (local_now - make_interval(days => $3::int)) AT TIME ZONE $4 AS previous_end_at,
    local_now::date - ($3::int - 1) AS first_date
  FROM clock
), windows AS (
  SELECT 'current' AS period, start_at, end_at FROM bounds
  UNION ALL
  SELECT 'previous', previous_start_at, previous_end_at FROM bounds
), purchases AS (
  SELECT w.period, t.customer_id, t.amount_q, (t.created_at AT TIME ZONE $4)::date AS date
  FROM transactions t
  JOIN customers c ON c.id = t.customer_id AND c.business_id = $1::uuid
  JOIN windows w ON t.created_at >= w.start_at AND t.created_at < w.end_at
  WHERE t.business_id = $1::uuid
    AND ($2::uuid IS NULL OR t.branch_id = $2::uuid)
    AND ${reportingPurchase('t')}
), customer_counts AS (
  SELECT period, customer_id, COUNT(*) AS purchases
  FROM purchases GROUP BY period, customer_id
), redeemed AS (
  SELECT w.period, r.reward_id, rw.name, r.points_cost
  FROM redemptions r
  JOIN customers c ON c.id = r.customer_id AND c.business_id = $1::uuid
  JOIN rewards rw ON rw.id = r.reward_id AND rw.business_id = $1::uuid
  JOIN windows w ON COALESCE(r.redeemed_at, r.created_at) >= w.start_at
    AND COALESCE(r.redeemed_at, r.created_at) < w.end_at
  WHERE r.business_id = $1::uuid
    AND ($2::uuid IS NULL OR r.branch_id = $2::uuid)
    AND r.status = 'REDEEMED'
), sales_totals AS (
  SELECT period, SUM(amount_q) AS sales, COUNT(*) AS purchases
  FROM purchases GROUP BY period
), customer_totals AS (
  SELECT period, COUNT(*) AS active, COUNT(*) FILTER (WHERE purchases >= 2) AS repeat
  FROM customer_counts GROUP BY period
), redemption_totals AS (
  SELECT period, COUNT(*) AS redemptions FROM redeemed GROUP BY period
), metrics AS (
  SELECT w.period, jsonb_build_object(
    'recorded_sales_q', COALESCE(s.sales, 0),
    'purchases', COALESCE(s.purchases, 0),
    'active_customers', COALESCE(c.active, 0),
    'repeat_customers', COALESCE(c.repeat, 0),
    'repeat_rate_pct', ROUND(100.0 * c.repeat / NULLIF(c.active, 0), 2),
    'average_ticket_q', ROUND(s.sales / NULLIF(s.purchases, 0), 2),
    'redemptions', COALESCE(r.redemptions, 0)
  ) AS value
  FROM windows w
  LEFT JOIN sales_totals s USING (period)
  LEFT JOIN customer_totals c USING (period)
  LEFT JOIN redemption_totals r USING (period)
), daily_totals AS (
  SELECT date, SUM(amount_q) AS sales, COUNT(*) AS purchases
  FROM purchases WHERE period = 'current' GROUP BY date
), daily AS (
  SELECT b.first_date + day AS date, COALESCE(d.sales, 0) AS recorded_sales_q,
    COALESCE(d.purchases, 0) AS purchases
  FROM bounds b CROSS JOIN generate_series(0, $3::int - 1) AS day
  LEFT JOIN daily_totals d ON d.date = b.first_date + day
), top_rewards AS (
  SELECT reward_id, name, COUNT(*) AS redemptions, SUM(points_cost) AS points_redeemed
  FROM redeemed WHERE period = 'current'
  GROUP BY reward_id, name
  ORDER BY redemptions DESC, points_redeemed DESC, name, reward_id
  LIMIT 10
)
SELECT b.start_at, b.end_at, b.previous_start_at, b.previous_end_at,
  (SELECT value FROM metrics WHERE period = 'current') AS current,
  (SELECT value FROM metrics WHERE period = 'previous') AS previous,
  (SELECT jsonb_agg(jsonb_build_object('date', to_char(date, 'YYYY-MM-DD'),
    'recorded_sales_q', recorded_sales_q, 'purchases', purchases) ORDER BY date) FROM daily) AS daily,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('name', name, 'redemptions', redemptions,
    'points_redeemed', points_redeemed) ORDER BY redemptions DESC, points_redeemed DESC, name, reward_id)
    FROM top_rewards), '[]'::jsonb) AS rewards
FROM bounds b`;

/**
 * Windows are half-open [start,end), using the configured business calendar.
 * Today is partial; the previous window ends at the same local clock N dates
 * earlier, leaving the rest of that earlier day outside the comparison.
 * Local-clock comparisons retain calendar meaning across DST transitions.
 * Soft-deleted customers remain in historical, anonymous aggregates; no PII
 * is read. Pending loyalty points do not make a recorded sale disappear.
 *
 * @param {{businessId: string, branchId?: string | null, days?: number, now?: Date, timezone?: string}} options
 * @param {typeof dbQuery} query
 */
export async function getMerchantOverview({ businessId, branchId = null, days = 30, now = new Date(), timezone = undefined }, query = dbQuery) {
  if (![7, 30, 90].includes(days)) throw badRequest("El período debe ser de 7, 30 o 90 días.");
  const business = (await query("SELECT to_jsonb(b)->'program_json' AS program_json FROM businesses b WHERE id=$1", [businessId])).rows[0];
  const region = businessRegion(business); timezone ??= region.timezone;
  if (branchId) {
    const branch = await query("SELECT id FROM branches WHERE id = $1::uuid AND business_id = $2::uuid", [branchId, businessId]);
    if (!branch.rows.length) throw badRequest("La sucursal no pertenece a este negocio.");
  }
  const { rows } = await query(OVERVIEW_SQL, [businessId, branchId, days, timezone, now.toISOString()]);
  const row = rows[0];
  return {
    ok: true,
    generated_at: now.toISOString(),
    timezone,
    currency: region.currency,
    region,
    period: {
      days,
      start: new Date(row.start_at).toISOString(),
      end: new Date(row.end_at).toISOString(),
      previous_start: new Date(row.previous_start_at).toISOString(),
      previous_end: new Date(row.previous_end_at).toISOString()
    },
    scope: { branch_id: branchId },
    current: row.current,
    previous: row.previous,
    daily: row.daily,
    rewards: row.rewards,
    notes: [
      "Hoy es parcial. Se compara hasta la misma hora local del período anterior; el resto de ese día queda fuera de la comparación.",
      "Ventas registradas en el programa, incluidas las compras con puntos pendientes o vencidos. El vencimiento de puntos no anula una compra. No representan todas las ventas del negocio ni ingresos causados por el programa.",
      "Clientes que volvieron: clientes con al menos dos compras registradas dentro del período seleccionado.",
      "Los registros históricos de clientes eliminados se conservan en estos totales sin datos personales.",
      "Los saldos iniciales importados no cuentan como compras, visitas ni clientes activos. Sus compras posteriores sí se incluyen.",
      "Las compras sin sucursal asignada se incluyen únicamente al consultar todas las sucursales.",
      "Premios usados: solo canjes completados, según su fecha de uso; los registros antiguos sin esa fecha usan la fecha de registro."
    ]
  };
}
