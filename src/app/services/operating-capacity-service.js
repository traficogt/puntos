/** Remaining bonus slots in active quiet offers, whether activated directly or from an approved template. No stock reservation is inferred. */
export async function occupiedOperatingCapacity(client,businessId,excludeCampaignId=null){
 const result=await client.query(`SELECT COALESCE(SUM(slots),0)::int AS units FROM (
  SELECT LEAST(count(m.id),GREATEST(0,(g.points_budget-g.points_committed)/g.bonus_points)) AS slots
  FROM growth_campaigns g
  LEFT JOIN growth_campaign_members m ON m.business_id=g.business_id AND m.campaign_id=g.id AND m.allocation='treatment' AND m.claimed_at IS NULL
  WHERE g.business_id=$1 AND g.offer_kind='quiet' AND ($2::uuid IS NULL OR g.id<>$2) AND g.status='active' AND g.starts_at<=clock_timestamp() AND g.expires_at>clock_timestamp() GROUP BY g.id
 ) active`,[businessId,excludeCampaignId]);return result.rows[0].units;
}
