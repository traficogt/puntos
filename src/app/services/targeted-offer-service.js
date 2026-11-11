import { secondVisitOfferEligible } from "./second-visit-eligibility.js";
import { dbQuery } from "../database.js";
import { PlanConfigService } from "./plan-config-service.js";
import { hasPlanFeature } from "../../utils/plan.js";
import { isLedgerInteger } from "../../utils/ledger-limits.js";
import { badRequest, forbidden } from "../../utils/http-error.js";

const noBonus = () => ({ bonusPoints: 0, campaignId: null });
const entitled = (business, overrides) =>
  hasPlanFeature(business.plan, "campaign_rules", overrides) &&
  hasPlanFeature(business.plan, "analytics", overrides);

/** Claim inside the purchase transaction, before its INSERT. The deferred FK
 * binds the claim to that INSERT; any ledger/guard/balance failure rolls back both.
 * A server-time window deliberately ignores offline client timestamps.
 */
export async function claimTargetedOffer(
  {
    client,
    business,
    customerId,
    transactionId,
    source,
    amountQ,
    visits = 0,
    items = 0,
    basePoints,
    planFeatureOverrides = undefined,
  },
  {
    getPlanFeatureOverrides = () => PlanConfigService.getPlanFeatureOverrides(),
  } = {},
) {
  if (
    business.program_json?.targeted_offers_enabled !== true ||
    !["online", "offline", "external", "order"].includes(source) ||
    !(amountQ > 0 || visits > 0 || items > 0)
  )
    return noBonus();
  const current = await client.query(
    "SELECT id,plan,program_json FROM businesses WHERE id=$1::uuid FOR SHARE",
    [business.id],
  );
  const live = current.rows[0];
  if (!live || !entitled(live, planFeatureOverrides ?? await getPlanFeatureOverrides()))
    return noBonus();
  // Shared across all purchase writers, preventing concurrent selection from
  // consuming different campaigns for the same receipt/customer.
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))",
    [String(business.id), `targeted-offer:${customerId}`],
  );
  for (;;) {
    // Lock campaigns before members, in the same expiry/id order for every
    // customer. PostgreSQL rechecks the updated budget after a lock wait and
    // advances to the next eligible row when another purchase used the last bonus.
    // NO KEY UPDATE permits FK reads without an avoidable key-share upgrade.
    const selected = await client.query(
      `SELECT g.id,g.bonus_points,to_jsonb(g)->'audience_snapshot' AS audience_snapshot FROM growth_campaigns g
      WHERE g.business_id=$1::uuid AND g.status='active'
        AND g.starts_at<=clock_timestamp() AND g.expires_at>clock_timestamp() AND g.minimum_purchase_q<=$3
        AND ${secondVisitOfferEligible}
        AND (g.points_budget IS NULL OR g.points_committed<=g.points_budget-g.bonus_points)
        AND EXISTS (SELECT 1 FROM growth_campaign_members m
          JOIN customers c ON c.business_id=m.business_id AND c.id=m.customer_id AND c.deleted_at IS NULL
          WHERE m.business_id=g.business_id AND m.campaign_id=g.id AND m.customer_id=$2::uuid
            AND m.allocation='treatment' AND m.claimed_at IS NULL)
      ORDER BY g.expires_at,g.id LIMIT 1 FOR NO KEY UPDATE OF g`,
      [business.id, customerId, amountQ],
    );
    const campaign = selected.rows[0];
    if (!campaign) return noBonus();
    if (campaign.audience_snapshot?.automation === 'second_visit') {
      // Serialize against a refund of the qualifying first receipt. A later
      // refund cannot revoke a bonus already granted on an eligible return.
      const first = await client.query(`SELECT id FROM transactions WHERE business_id=$1 AND id=$2
        AND status='POSTED' AND original_transaction_id IS NULL AND reversed_transaction_id IS NULL FOR SHARE`,
      [business.id, campaign.audience_snapshot.first_transaction_id]);
      if (!first.rowCount) continue;
    }
    const member = await client.query(
      `SELECT m.id FROM growth_campaign_members m
      JOIN customers c ON c.business_id=m.business_id AND c.id=m.customer_id AND c.deleted_at IS NULL
      WHERE m.business_id=$1::uuid AND m.campaign_id=$2::uuid AND m.customer_id=$3::uuid
        AND m.allocation='treatment' AND m.claimed_at IS NULL FOR UPDATE OF m FOR SHARE OF c`,
      [business.id, campaign.id, customerId],
    );
    if (!member.rows[0]) return noBonus();
    // LockRows can wait without a row version changing, so the selection's
    // time predicate is not sufficient. All campaign/member/customer locks are
    // now held: reserve with the current database clock, then retry the ordered
    // selection if this campaign expired during any of those waits.
    const committed = await client.query(
      `WITH evaluated AS MATERIALIZED (SELECT clock_timestamp() AS at)
      UPDATE growth_campaigns g SET points_committed=g.points_committed+$3
      FROM evaluated
      WHERE g.business_id=$1::uuid AND g.id=$2::uuid AND g.status='active'
        AND g.starts_at<=evaluated.at AND g.expires_at>evaluated.at
        AND (g.points_budget IS NULL OR g.points_committed<=g.points_budget-$3)
      RETURNING g.id,g.minimum_purchase_q,g.points_budget,g.points_committed,
        to_char(g.starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS starts_at,
        to_char(g.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS expires_at,
        to_char(evaluated.at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS evaluated_at`,
      [business.id, campaign.id, campaign.bonus_points],
    );
    if (!committed.rowCount) continue;
    // Guard rejection rolls back the reservation with the purchase transaction.
    const total = basePoints + campaign.bonus_points;
    if (!isLedgerInteger(total))
      throw badRequest("Los puntos calculados exceden el límite permitido.");
    const max = Number(live.program_json?.award_guard?.max_points_per_tx ?? 0);
    if (max > 0 && total > max)
      throw forbidden(`Points exceed max allowed (${max})`);
    await client.query(
      `UPDATE growth_campaign_members SET bonus_transaction_id=$3::uuid,bonus_points_awarded=$4,claimed_at=clock_timestamp()
      WHERE business_id=$1::uuid AND id=$2::uuid`,
      [business.id, member.rows[0].id, transactionId, campaign.bonus_points],
    );
    const terms = committed.rows[0];
    return { bonusPoints: campaign.bonus_points, campaignId: campaign.id, criteria: {
      schema_version: 1, clock: 'database', evaluated_at: terms.evaluated_at,
      minimum_purchase_q: Number(terms.minimum_purchase_q), starts_at: terms.starts_at, expires_at: terms.expires_at,
      points_budget: terms.points_budget == null ? null : Number(terms.points_budget),
      points_committed_before: Number(terms.points_committed) - campaign.bonus_points, points_committed_after: Number(terms.points_committed),
      // These predicates succeeded under the held campaign/member/customer locks.
      // Audience rules were not re-evaluated: the saved treatment membership was.
      eligibility: { campaign_active: true, saved_membership: 'treatment', unclaimed_before_award: true,
        customer_not_deleted: true, program_enabled_at_request: true, plan_features_allowed: true },
      purchase: { amount_q: Number(amountQ), visits: Number(visits), items: Number(items), source }
    } };
  }
}

export async function getCustomerGrowthOffers(
  { businessId, customerId },
  {
    query = dbQuery,
    getPlanFeatureOverrides = () => PlanConfigService.getPlanFeatureOverrides(),
  } = {},
) {
  const business = (
    await query("SELECT id,plan FROM businesses WHERE id=$1::uuid", [
      businessId,
    ])
  ).rows[0];
  if (!business || !entitled(business, await getPlanFeatureOverrides()))
    return { offers: [] };
  const { rows } = await query(
    `SELECT g.id,g.name,g.bonus_points,g.minimum_purchase_q,g.starts_at,g.expires_at,
      CASE WHEN g.points_budget IS NOT NULL THEN 'Sujeta a los puntos disponibles de la campaña.' ELSE NULL END AS availability_terms
    FROM growth_campaigns g JOIN growth_campaign_members m ON m.business_id=g.business_id AND m.campaign_id=g.id
    JOIN customers c ON c.business_id=m.business_id AND c.id=m.customer_id AND c.deleted_at IS NULL
    WHERE g.business_id=$1::uuid AND m.customer_id=$2::uuid AND g.status='active' AND m.allocation='treatment' AND m.claimed_at IS NULL
      AND (g.points_budget IS NULL OR g.points_committed<=g.points_budget-g.bonus_points)
      AND ${secondVisitOfferEligible}
      AND g.starts_at<=statement_timestamp() AND g.expires_at>statement_timestamp() ORDER BY g.expires_at,g.id`,
    [businessId, customerId],
  );
  return {
    offers: rows.map((row) => ({
      ...row,
      minimum_purchase_q: Number(row.minimum_purchase_q),
      starts_at: new Date(row.starts_at).toISOString(),
      expires_at: new Date(row.expires_at).toISOString(),
    })),
  };
}
