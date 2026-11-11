import { config } from "../../config/index.js";
import { dbQuery } from "../database.js";
import { reportingPurchase } from './reporting-purchase.js';

// This is an observed purchase report, not a replay of the legacy reward
// eligibility engine. Keep the two definitions explicit in the response/UI.
const GROWTH_SQL = `
WITH bounds AS (
  SELECT (($7::timestamptz AT TIME ZONE $6)::date - ($2::int - 1))::timestamp AT TIME ZONE $6 AS start_at,
    $7::timestamptz AS end_at
), cohort AS (
  SELECT r.id, r.created_at, r.status,
    CASE WHEN invited.deleted_at IS NULL THEN invited.name END AS referred_name,
    CASE WHEN inviter.deleted_at IS NULL THEN inviter.name END AS referrer_name,
    r.referred_customer_id,
    CASE WHEN r.referrer_rewarded_at IS NOT NULL THEN COALESCE(r.referrer_reward_points, 0) ELSE 0 END
      + CASE WHEN r.referred_rewarded_at IS NOT NULL THEN COALESCE(r.referred_reward_points, 0) ELSE 0 END AS recorded_reward_points
  FROM referrals r
  JOIN customers invited ON invited.id = r.referred_customer_id AND invited.business_id = $1::uuid
  JOIN customers inviter ON inviter.id = r.referrer_customer_id AND inviter.business_id = $1::uuid
  CROSS JOIN bounds b
  WHERE r.business_id = $1::uuid AND r.created_at >= b.start_at AND r.created_at < b.end_at
), activity AS (
  SELECT c.*, p.first_purchase_at
  FROM cohort c
  LEFT JOIN LATERAL (
    SELECT MIN(t.created_at) AS first_purchase_at
    FROM transactions t
    WHERE t.business_id = $1::uuid AND t.customer_id = c.referred_customer_id
      AND t.created_at >= c.created_at AND t.created_at < $7::timestamptz
      AND ${reportingPurchase('t')}
  ) p ON true
), summary AS (
  SELECT jsonb_build_object(
    'registered', COUNT(*),
    'purchased', COUNT(*) FILTER (WHERE first_purchase_at IS NOT NULL),
    'purchased_and_rewarded', COUNT(*) FILTER (WHERE first_purchase_at IS NOT NULL AND status = 'rewarded'),
    'awaiting_purchase', COUNT(*) FILTER (WHERE first_purchase_at IS NULL),
    'purchase_rate_pct', ROUND(100.0 * COUNT(*) FILTER (WHERE first_purchase_at IS NOT NULL) / NULLIF(COUNT(*), 0), 2),
    'reward_status', jsonb_build_object(
      'pending', COUNT(*) FILTER (WHERE status = 'pending'),
      'completed', COUNT(*) FILTER (WHERE status = 'completed'),
      'rewarded', COUNT(*) FILTER (WHERE status = 'rewarded'),
      'other', COUNT(*) FILTER (WHERE status IS NULL OR status NOT IN ('pending', 'completed', 'rewarded'))
    ),
    'recorded_reward_points', COALESCE(SUM(recorded_reward_points), 0)
  ) AS value FROM activity
), filtered AS (
  SELECT * FROM activity
  WHERE $3::text = 'all'
    OR ($3::text = 'awaiting_purchase' AND first_purchase_at IS NULL)
    OR ($3::text = 'purchased' AND first_purchase_at IS NOT NULL)
), page AS (
  SELECT id, created_at, referred_name, referrer_name, first_purchase_at, status, recorded_reward_points
  FROM filtered ORDER BY created_at DESC, id DESC LIMIT $4::int OFFSET $5::int
)
SELECT b.start_at, b.end_at, s.value AS summary,
  COALESCE((SELECT jsonb_agg(p ORDER BY p.created_at DESC, p.id DESC) FROM page p), '[]'::jsonb) AS referrals,
  (SELECT COUNT(*)::int FROM filtered) AS total
FROM bounds b CROSS JOIN summary s`;

export async function getReferralGrowth(
  {
    businessId,
    days = 30,
    phase = "all",
    limit = 25,
    offset = 0,
    timezone = config.CRON_TZ || "America/Guatemala",
    now = new Date(),
  },
  query = dbQuery,
) {
  const { rows } = await query(GROWTH_SQL, [
    businessId,
    days,
    phase,
    limit,
    offset,
    timezone,
    now.toISOString(),
  ]);
  const row = rows[0];
  return {
    ok: true,
    generated_at: now.toISOString(),
    timezone,
    period: {
      days,
      start: new Date(row.start_at).toISOString(),
      end: new Date(row.end_at).toISOString(),
    },
    summary: row.summary,
    referrals: row.referrals,
    pagination: {
      total: Number(row.total),
      limit,
      offset,
      has_more: offset + limit < Number(row.total),
    },
    notes: [
      "El grupo incluye códigos de recomendación aplicados en el período; las compras se observan desde la recomendación hasta ahora.",
      "Compra registrada significa una venta, visita o artículo con actividad válida. Incluye puntos pendientes o vencidos y excluye premios, ajustes, anulaciones y devoluciones.",
      "El estado del premio se muestra por separado: puede entregarse al registro. Este informe no recalcula elegibilidad ni demuestra ventas incrementales.",
      "Los totales conservan la historia de clientes eliminados; sus nombres no se muestran. Los puntos reflejan abonos registrados, no su saldo actual.",
    ],
  };
}
