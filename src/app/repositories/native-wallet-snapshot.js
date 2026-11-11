import {REGIONAL_COUNTRIES} from '../services/regional-settings.js';
// Country/timezone values are source-owned constants; customer input never becomes SQL.
export const walletTimezoneDefaults=JSON.stringify(Object.fromEntries(Object.entries(REGIONAL_COUNTRIES).map(([code,region])=>[code,region.timezone])));
const walletSeedSql=`
 SELECT p.*,CASE WHEN v.is_voided THEN NULL ELSE c.name END AS customer_name,
 c.deleted_at AS customer_deleted_at,
 CASE WHEN v.is_voided THEN 0 ELSE COALESCE(cb.points,0) END AS points,
 CASE WHEN v.is_voided THEN 0 ELSE COALESCE(cb.pending_points,0) END AS pending_points,
 CASE WHEN v.is_voided THEN 0 ELSE COALESCE(cb.lifetime_points,0) END AS lifetime_points,
 CASE WHEN v.is_voided THEN NULL ELSE cb.tier END AS tier,
 COALESCE(b.name,'PuntosFieles') AS business_name,b.slug AS business_slug,
 b.program_type,b.program_json,b.customer_branding_json,v.is_voided,statement_timestamp() AS snapshot_at,
 COALESCE((SELECT name FROM pg_timezone_names WHERE name=b.program_json->'region'->>'timezone'),
 '${walletTimezoneDefaults}'::jsonb->>(b.program_json->'region'->>'country'),'America/Guatemala') AS timezone
 FROM native_wallet_passes p
 LEFT JOIN customers c ON c.id=p.customer_id AND c.business_id=p.business_id
 LEFT JOIN customer_balances cb ON cb.customer_id=c.id
 LEFT JOIN businesses b ON b.id=p.business_id
 CROSS JOIN LATERAL(SELECT(p.revoked_at IS NOT NULL OR c.id IS NULL OR c.deleted_at IS NOT NULL OR b.id IS NULL) AS is_voided)v
 WHERE p.id=$1`;

// The seed is source-owned SQL. Share reward/guard selection without requiring a pass.
export const rewardSnapshotSql=seedSql=>`WITH snapshot AS (${seedSql}
), current_cycle AS (
 SELECT c.* FROM reward_promise_cycles c JOIN snapshot s ON s.business_id=c.business_id AND s.customer_id=c.customer_id
 WHERE c.completed_at IS NULL AND NOT s.is_voided
), redemption_stats AS (
 SELECT COALESCE(f.original_reward_id,r.reward_id) AS reward_id,max(r.created_at) AS last_redeemed_at,
 count(*) FILTER(WHERE r.created_at>=((s.snapshot_at AT TIME ZONE s.timezone)::date::timestamp AT TIME ZONE s.timezone))::int AS daily_count
 FROM redemptions r JOIN snapshot s ON s.business_id=r.business_id AND s.customer_id=r.customer_id
 LEFT JOIN reward_entitlement_fulfillments f ON f.redemption_id=r.id
 WHERE NOT s.is_voided AND r.status<>'CANCELLED' GROUP BY COALESCE(f.original_reward_id,r.reward_id)
)
SELECT s.*,(SELECT to_jsonb(c) FROM current_cycle c) AS wallet_cycle,
 ((s.snapshot_at AT TIME ZONE s.timezone)::date+1)::timestamp AT TIME ZONE s.timezone AS wallet_next_day,
 COALESCE((SELECT sum(daily_count) FROM redemption_stats),0)::int AS wallet_daily_redemptions,
 COALESCE((SELECT jsonb_agg(to_jsonb(br) ORDER BY br.id) FROM
 (SELECT b.id,b.name,b.wallet_location_enabled,b.wallet_latitude,b.wallet_longitude FROM branches b WHERE b.business_id=s.business_id AND NOT s.is_voided)br),'[]'::jsonb) AS wallet_branches,
 COALESCE((SELECT jsonb_agg(to_jsonb(rw) ORDER BY rw.points_cost,rw.id) FROM(
 SELECT r.id,r.name,r.description,r.active,r.stock,COALESCE(a.available,true) AS available,
 rp.id AS promise_id,rp.reward_name,rp.description AS protected_description,COALESCE(rp.points_cost,r.points_cost) AS points_cost,
 CASE WHEN rp.id IS NOT NULL THEN rp.valid_until ELSE r.valid_until END AS valid_until,
 CASE WHEN rp.id IS NOT NULL THEN rp.branch_ids ELSE ARRAY(SELECT rb.branch_id FROM reward_branches rb WHERE rb.reward_id=r.id ORDER BY rb.branch_id) END AS branch_ids,
 COALESCE(rs.daily_count,0) AS daily_count,rs.last_redeemed_at
 FROM rewards r LEFT JOIN current_cycle cc ON cc.business_id=r.business_id
 LEFT JOIN customer_reward_promises rp ON rp.cycle_id=cc.id AND rp.reward_id=r.id AND rp.business_id=r.business_id
 LEFT JOIN reward_availability a ON a.reward_id=r.id AND a.business_id=r.business_id
 LEFT JOIN redemption_stats rs ON rs.reward_id=r.id
 WHERE r.business_id=s.business_id AND NOT s.is_voided AND(r.active OR rp.id IS NOT NULL)
 )rw),'[]'::jsonb) AS wallet_rewards
FROM snapshot s`;

export const walletSnapshotSql=rewardSnapshotSql(walletSeedSql);
