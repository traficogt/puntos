// Read all activity in one database snapshot. This is an activity statement,
// not an opening/closing balance reconstruction: settlement changes a ledger
// row's status without recording the time it moved out of pending.
const STATEMENT_SQL = `WITH bounds AS (
  SELECT COALESCE($3::timestamptz,statement_timestamp()) AS end_at
), entries AS (
  SELECT t.points, CASE
    WHEN t.source IN ('reversal','migration') OR t.type='OPENING_BALANCE' THEN 'adjustments'
    WHEN t.source='redeem' AND t.points<0 THEN 'redeemed'
    WHEN t.source='expire' AND t.points<0 THEN 'expired'
    WHEN t.points>0 THEN 'earned'
    ELSE 'adjustments' END AS category
  FROM transactions t CROSS JOIN bounds b
  WHERE t.business_id=$1 AND t.customer_id=$2
    AND t.created_at>=b.end_at-interval '720 hours' AND t.created_at<b.end_at
    AND COALESCE(t.status,'POSTED') IN ('POSTED','EXPIRED','REVERSED')
    -- Pending order cancellation creates no reversal row. A reversed original
    -- counts as gross activity only with evidence it once affected available
    -- points. Legacy posted reversals without status metadata have nonzero delta.
    AND (COALESCE(t.status,'POSTED')<>'REVERSED' OR EXISTS (
      SELECT 1 FROM transactions reversal
      WHERE reversal.business_id=$1 AND reversal.customer_id=$2
        AND reversal.original_transaction_id=t.id AND reversal.source='reversal'
        AND (reversal.meta->>'original_status' IN ('POSTED','EXPIRED')
          OR (reversal.meta->>'original_status' IS NULL AND reversal.points<>0))))
  UNION ALL
  SELECT a.delta_points,'adjustments' FROM ledger_balance_adjustments a CROSS JOIN bounds b
  WHERE a.business_id=$1 AND a.customer_id=$2
    AND a.created_at>=b.end_at-interval '720 hours' AND a.created_at<b.end_at
), totals AS (
  SELECT COALESCE(sum(points) FILTER(WHERE category='earned'),0) AS earned,
    COALESCE(-sum(points) FILTER(WHERE category='redeemed'),0) AS redeemed,
    COALESCE(-sum(points) FILTER(WHERE category='expired'),0) AS expired,
    COALESCE(sum(points) FILTER(WHERE category='adjustments'),0) AS adjustments
  FROM entries
), completed AS (
  SELECT count(*) AS rewards FROM redemptions r CROSS JOIN bounds b
  LEFT JOIN pos_checkout_intents i ON i.business_id=$1 AND i.redemption_id=r.id
  WHERE r.business_id=$1 AND r.customer_id=$2 AND r.status='REDEEMED'
    AND COALESCE(i.recorded_at,r.redeemed_at,r.created_at)>=b.end_at-interval '720 hours'
    AND COALESCE(i.recorded_at,r.redeemed_at,r.created_at)<b.end_at
    AND (i.redemption_id IS NULL OR (i.status='recorded' AND i.recorded_at IS NOT NULL))
    AND NOT EXISTS (SELECT 1 FROM service_redemption_restorations s
      WHERE s.business_id=$1 AND s.redemption_id=r.id)
    AND NOT EXISTS (SELECT 1 FROM transactions t
      WHERE t.business_id=$1 AND t.customer_id=$2 AND t.source='redeem'
        AND t.meta->>'redemption_id'=r.id::text
        AND (t.status='REVERSED' OR t.reversed_transaction_id IS NOT NULL))
    AND NOT EXISTS (SELECT 1 FROM redemption_pos_records f
      WHERE f.business_id=$1 AND f.redemption_id=r.id AND f.returned_quantity>0)
)
SELECT b.end_at,b.end_at-interval '720 hours' AS start_at,
  COALESCE(cb.points,0) AS available,COALESCE(cb.pending_points,0) AS pending,
  t.earned,t.redeemed,t.expired,t.adjustments,r.rewards
FROM customers c LEFT JOIN customer_balances cb ON cb.customer_id=c.id
CROSS JOIN bounds b CROSS JOIN totals t CROSS JOIN completed r
WHERE c.business_id=$1 AND c.id=$2 AND c.deleted_at IS NULL`;

/** Public customer fields only. No merchant cost, cash conversion or staff notes. */
export async function getCustomerStatement(client, { businessId, customerId, now = null }) {
  const row = (await client.query(STATEMENT_SQL, [businessId, customerId, now])).rows[0];
  if (!row) return null;
  return {
    as_of: new Date(row.end_at).toISOString(),
    period: { days: 30, start: new Date(row.start_at).toISOString(), end: new Date(row.end_at).toISOString() },
    balance: { available: Number(row.available), pending: Number(row.pending) },
    points: { earned: Number(row.earned), redeemed: Number(row.redeemed), expired: Number(row.expired), adjustments: Number(row.adjustments) },
    rewards: { completed: Number(row.rewards) }
  };
}
