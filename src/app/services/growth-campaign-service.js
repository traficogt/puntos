import { campaignMeasurement, wilsonInterval } from './campaign-measurement.js';
import { reportingPurchase } from './reporting-purchase.js';
import { randomInt, randomUUID } from "node:crypto";
import { dbQuery, withTransaction } from "../database.js";
import { AuditRepo } from "../repositories/audit-repository.js";
import { PlanConfigService } from "./plan-config-service.js";
import { hasPlanFeature } from "../../utils/plan.js";
import { validateCampaignPreflight } from "./campaign-preflight-service.js";
import { snapshotCustomerAudience } from "./customer-audience-service.js";
import { withImpersonationMeta } from "../../utils/impersonation.js";
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
} from "../../utils/http-error.js";

export function publicGrowthCampaign(row) {
  return {
    id: row.id,
    recovery_run_id: row.recovery_run_id,
    audience_snapshot: row.audience_snapshot ?? null,
    name: row.name,
    status: row.status,
    offer_kind: row.offer_kind ?? "experiment",
    duration_minutes: row.duration_minutes ?? null,
    preparation_status: row.preparation_status ?? "ready",
    prepared_count: Number(row.prepared_count ?? row.member_count ?? 0),
    bonus_points: row.bonus_points,
    points_budget: row.points_budget ?? null,
    points_committed: Number(row.points_committed ?? 0),
    points_remaining: row.points_budget == null ? null : Math.max(0, row.points_budget - Number(row.points_committed ?? 0)),
    budget_exhausted: row.points_budget != null && row.points_budget - Number(row.points_committed ?? 0) < row.bonus_points,
    minimum_purchase_q: Number(row.minimum_purchase_q),
    duration_days: row.duration_days,
    holdout_percent: row.holdout_percent,
    estimated_cost_per_point_q:
      row.estimated_cost_per_point_q == null
        ? null
        : Number(row.estimated_cost_per_point_q),
    member_count: row.member_count,
    treatment_count: row.treatment_count,
    control_count: row.control_count,
    starts_at: row.starts_at ? new Date(row.starts_at).toISOString() : null,
    expires_at: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    paused_at: row.paused_at ? new Date(row.paused_at).toISOString() : null,
    created_at: new Date(row.created_at).toISOString(),
  };
}

export async function lockEntitledBusiness(
  client,
  businessId,
  overrides,
) {
  const { rows } = await client.query(
    // Keep owner operations serialized while permitting child-row FK checks.
    // FOR UPDATE can deadlock against a consent write holding a customer row.
    "SELECT id,plan FROM businesses WHERE id=$1::uuid FOR NO KEY UPDATE",
    [businessId],
  );
  if (!rows[0]) throw notFound("No se encontró el negocio.");
  if (
    !hasPlanFeature(rows[0].plan, "campaign_rules", overrides) ||
    !hasPlanFeature(rows[0].plan, "analytics", overrides)
  ) {
    throw forbidden("Tu plan no incluye campañas con medición.");
  }
}
export async function auditChange(
  audit,
  action,
  { businessId, staffId, ip = null, ua = null, impersonated_by = null },
  campaign,
) {
  await audit({
    id: randomUUID(),
    business_id: businessId,
    actor_type: "STAFF",
    actor_id: staffId,
    action,
    ip,
    ua,
    meta: withImpersonationMeta({
      campaign_id: campaign.id,
      status: campaign.status,
      member_count: campaign.member_count,
    }, { impersonated_by }),
  });
}

export function validateCampaignTerms({ name, bonusPoints, pointsBudget = null, minimumPurchaseQ = 0, durationDays, offerKind = "experiment", durationMinutes = null, holdoutPercent = 20, estimatedCostPerPointQ = null }) {
  if (typeof name !== "string" || !name.trim() || name.trim().length > 100 || /[\u0000-\u001f\u007f]/u.test(name) || !Number.isInteger(bonusPoints) || bonusPoints < 1 || bonusPoints > 10000 || !Number.isFinite(minimumPurchaseQ) || minimumPurchaseQ < 0 || minimumPurchaseQ > 999999.99 || Math.abs(minimumPurchaseQ * 100 - Math.round(minimumPurchaseQ * 100)) > 0.00001) throw badRequest("Revisa el nombre, los puntos y la compra mínima.");
  if (pointsBudget !== null && (!Number.isInteger(pointsBudget) || pointsBudget < bonusPoints || pointsBudget > 2000000)) throw badRequest("El límite debe cubrir al menos un bono y no superar 2,000,000 puntos.");
  if (estimatedCostPerPointQ !== null && (!Number.isFinite(estimatedCostPerPointQ) || estimatedCostPerPointQ < 0 || estimatedCostPerPointQ > 100)) throw badRequest("Revisa el costo estimado de cada punto.");
  if (offerKind === "quiet") {
    if (durationDays !== null || !Number.isInteger(durationMinutes) || durationMinutes < 30 || durationMinutes > 240 || holdoutPercent !== 0 || pointsBudget === null) throw badRequest("La oferta breve necesita 30 a 240 minutos, un límite de puntos y ningún grupo de comparación.");
  } else if (offerKind !== "experiment" || ![7,14,30].includes(durationDays) || durationMinutes !== null || ![10,20,30].includes(holdoutPercent)) throw badRequest("Revisa la vigencia y el grupo de comparación de la campaña.");
}

export async function createGrowthCampaign(
  options,
  {
    transaction = withTransaction,
    audit = AuditRepo.log,
    getPlanFeatureOverrides = () => PlanConfigService.getPlanFeatureOverrides(),
  } = {},
) {
  const {
    businessId,
    staffId,
    requestId,
    recoveryRunId = null,
    audienceSegmentId = null,
    audienceSegmentVersion = null,
    audienceLimit = null,
    now = new Date(),
    name,
    bonusPoints,
    pointsBudget = null,
    minimumPurchaseQ = 0,
    durationDays,
    offerKind = "experiment",
    durationMinutes = null,
    holdoutPercent = 20,
    estimatedCostPerPointQ = null,
  } = options;
  validateCampaignTerms({ name, bonusPoints, pointsBudget, minimumPurchaseQ, durationDays, offerKind, durationMinutes, holdoutPercent, estimatedCostPerPointQ });
  if (Boolean(recoveryRunId) === Boolean(audienceSegmentId)) throw badRequest("Elige una lista de recuperación o una audiencia guardada.");
  if (audienceSegmentId && (!Number.isInteger(audienceSegmentVersion) || audienceSegmentVersion < 1 || audienceSegmentVersion > 2147483647 || !Number.isInteger(audienceLimit) || audienceLimit < (offerKind === "quiet" ? 1 : 10) || audienceLimit > 200))
    throw badRequest("Indica la versión de la audiencia y un límite de 10 a 200 clientes.");
  if (recoveryRunId && (audienceSegmentVersion !== null || audienceLimit !== null)) throw badRequest("Los ajustes de audiencia no corresponden a una lista de recuperación.");
  if (pointsBudget !== null && (!Number.isInteger(pointsBudget) || pointsBudget < bonusPoints || pointsBudget < 1 || pointsBudget > 2000000))
    throw badRequest("El límite debe cubrir al menos un bono y no superar 2,000,000 puntos.");
  const normalizedName = name.trim();
  // Shared plan settings use their own database transaction. Resolve them before
  // holding a purchase/campaign transaction so a busy pool cannot wait on itself.
  const overrides = await getPlanFeatureOverrides();
  return transaction(async (client) => {
    await lockEntitledBusiness(client, businessId, overrides);
    const existing = await client.query(
      "SELECT * FROM growth_campaigns WHERE business_id=$1::uuid AND request_id=$2::uuid",
      [businessId, requestId],
    );
    if (existing.rows[0]) {
      const c = existing.rows[0];
      if (
        (c.recovery_run_id ?? null) !== recoveryRunId ||
        (c.audience_snapshot?.segment_id ?? null) !== audienceSegmentId ||
        (c.audience_snapshot?.segment_version ?? null) !== audienceSegmentVersion ||
        (c.audience_snapshot?.limit ?? null) !== audienceLimit ||
        (c.offer_kind ?? "experiment") !== offerKind ||
        (c.duration_minutes ?? null) !== durationMinutes ||
        c.name !== normalizedName ||
        c.bonus_points !== bonusPoints ||
        (c.points_budget ?? null) !== pointsBudget ||
        Number(c.minimum_purchase_q) !== minimumPurchaseQ ||
        c.duration_days !== durationDays ||
        c.holdout_percent !== holdoutPercent ||
        (c.estimated_cost_per_point_q == null
          ? null
          : Number(c.estimated_cost_per_point_q)) !== estimatedCostPerPointQ
      )
        throw conflict("Esta solicitud ya se usó con otros datos.");
      return { campaign: publicGrowthCampaign(c) };
    }
    let audience, audienceSnapshot = null;
    if (audienceSegmentId) {
      const result = await snapshotCustomerAudience({ businessId, segmentId: audienceSegmentId, version: audienceSegmentVersion, limit: audienceLimit, now }, client);
      audience = { rows: result.customers, rowCount: result.customers.length };
      audienceSnapshot = result.snapshot;
    } else {
      const run = await client.query(
        "SELECT id FROM recovery_runs WHERE business_id=$1::uuid AND id=$2::uuid FOR SHARE",
        [businessId, recoveryRunId],
      );
      if (!run.rowCount) throw notFound("No se encontró la lista de recuperación.");
      audience = await client.query(
        `SELECT c.id FROM recovery_members m JOIN customers c ON c.business_id=m.business_id AND c.id=m.customer_id
        WHERE m.business_id=$1::uuid AND m.run_id=$2::uuid AND c.deleted_at IS NULL ORDER BY c.id LIMIT 200 FOR SHARE OF c`,
        [businessId, recoveryRunId],
      );
    }
    if (!audience.rowCount)
      throw badRequest("No hay clientes activos en esta lista.");
    const campaignId = randomUUID();
    const inserted = await client.query(
      `INSERT INTO growth_campaigns(id,business_id,request_id,recovery_run_id,name,bonus_points,minimum_purchase_q,duration_days,holdout_percent,estimated_cost_per_point_q,member_count,created_by_staff_id,points_budget,audience_snapshot,offer_kind,duration_minutes)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16) RETURNING *`,
      [
        campaignId,
        businessId,
        requestId,
        recoveryRunId,
        normalizedName,
        bonusPoints,
        minimumPurchaseQ,
        durationDays,
        holdoutPercent,
        estimatedCostPerPointQ,
        audience.rowCount,
        staffId,
        pointsBudget,
        audienceSnapshot ? JSON.stringify(audienceSnapshot) : null,
        offerKind,
        durationMinutes,
      ],
    );
    for (const customer of audience.rows)
      await client.query(
        "INSERT INTO growth_campaign_members(id,business_id,campaign_id,customer_id) VALUES($1,$2,$3,$4)",
        [randomUUID(), businessId, campaignId, customer.id],
      );
    await auditChange(
      audit,
      "growth.campaign.created",
      options,
      inserted.rows[0],
    );
    return { campaign: publicGrowthCampaign(inserted.rows[0]) };
  });
}

export async function activateGrowthCampaign(
  options,
  {
    transaction = withTransaction,
    audit = AuditRepo.log,
    getPlanFeatureOverrides = () => PlanConfigService.getPlanFeatureOverrides(),
  } = {},
) {
  const { businessId, campaignId } = options;
  // Shared plan settings use their own database transaction. Resolve them before
  // holding a purchase/campaign transaction so a busy pool cannot wait on itself.
  const overrides = await getPlanFeatureOverrides();
  return transaction(async (client) => {
    await lockEntitledBusiness(client, businessId, overrides);
    const selected = await client.query(
      "SELECT * FROM growth_campaigns WHERE business_id=$1::uuid AND id=$2::uuid FOR UPDATE",
      [businessId, campaignId],
    );
    const campaign = selected.rows[0];
    if (!campaign) throw notFound("No se encontró esta campaña.");
    if (campaign.status === "active")
      return { campaign: publicGrowthCampaign(campaign) };
    if (campaign.status !== "draft")
      throw conflict(
        "Una campaña pausada no se puede reactivar. Crea otra campaña.",
      );
    await validateCampaignPreflight({ ...options, campaign }, client);
    const active = await client.query(
      `SELECT m.id FROM growth_campaign_members m JOIN customers c ON c.business_id=m.business_id AND c.id=m.customer_id
      WHERE m.business_id=$1::uuid AND m.campaign_id=$2::uuid AND c.deleted_at IS NULL ORDER BY m.id FOR UPDATE OF m FOR SHARE OF c`,
      [businessId, campaignId],
    );
    if (active.rowCount < (campaign.offer_kind === "quiet" ? 1 : 10))
      throw badRequest(
        "Se necesitan al menos 10 clientes activos para comparar la campaña.",
      );
    const ids = active.rows.map((row) => row.id);
    // Fisher–Yates uses Node's cryptographic integer sampler. Store assignments,
    // never rerandomize them on requests, purchases or measurement refreshes.
    for (let i = ids.length - 1; i > 0; i -= 1) {
      const j = randomInt(i + 1);
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    const controls = campaign.offer_kind === "quiet" ? 0 : Math.max(1, Math.round((ids.length * campaign.holdout_percent) / 100));
    await client.query(
      "UPDATE growth_campaign_members SET allocation=CASE WHEN id=ANY($3::uuid[]) THEN 'control' ELSE 'treatment' END WHERE business_id=$1::uuid AND campaign_id=$2::uuid AND id=ANY($4::uuid[])",
      [businessId, campaignId, ids.slice(0, controls), ids],
    );
    const updated = await client.query(
      `WITH activation AS MATERIALIZED (SELECT clock_timestamp() AS at)
      UPDATE growth_campaigns SET status='active',member_count=$3,control_count=$4,treatment_count=$3::int-$4::int,
      starts_at=activation.at,expires_at=activation.at+CASE WHEN offer_kind='quiet' THEN duration_minutes*interval '1 minute' ELSE duration_days*interval '24 hours' END FROM activation WHERE business_id=$1::uuid AND id=$2::uuid RETURNING growth_campaigns.*`,
      [businessId, campaignId, ids.length, controls],
    );
    await client.query(
      "UPDATE businesses SET program_json=jsonb_set(COALESCE(program_json,'{}'::jsonb),'{targeted_offers_enabled}','true'::jsonb,true) WHERE id=$1::uuid",
      [businessId],
    );
    await auditChange(
      audit,
      "growth.campaign.activated",
      options,
      updated.rows[0],
    );
    return { campaign: publicGrowthCampaign(updated.rows[0]) };
  });
}

export async function pauseGrowthCampaign(
  options,
  {
    transaction = withTransaction,
    audit = AuditRepo.log,
    getPlanFeatureOverrides = () => PlanConfigService.getPlanFeatureOverrides(),
  } = {},
) {
  const { businessId, campaignId } = options;
  // Shared plan settings use their own database transaction. Resolve them before
  // holding a purchase/campaign transaction so a busy pool cannot wait on itself.
  const overrides = await getPlanFeatureOverrides();
  return transaction(async (client) => {
    await lockEntitledBusiness(client, businessId, overrides);
    const selected = await client.query(
      "SELECT * FROM growth_campaigns WHERE business_id=$1::uuid AND id=$2::uuid FOR UPDATE",
      [businessId, campaignId],
    );
    const campaign = selected.rows[0];
    if (!campaign) throw notFound("No se encontró esta campaña.");
    if (campaign.status === "paused")
      return { campaign: publicGrowthCampaign(campaign) };
    if (campaign.status !== "active")
      throw conflict("Solo puedes pausar una campaña activada.");
    const updated = await client.query(
      "UPDATE growth_campaigns SET status='paused',paused_at=clock_timestamp() WHERE business_id=$1::uuid AND id=$2::uuid RETURNING *",
      [businessId, campaignId],
    );
    await auditChange(
      audit,
      "growth.campaign.paused",
      options,
      updated.rows[0],
    );
    return { campaign: publicGrowthCampaign(updated.rows[0]) };
  });
}

export async function listGrowthCampaigns(
  { businessId, limit = 20, offset = 0 },
  { query = dbQuery } = {},
) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 || !Number.isInteger(offset) || offset < 0 || offset > 100000) {
    throw badRequest("Revisa los límites de esta solicitud.");
  }
  // The count and page share one statement snapshot. An empty page still returns
  // the tenant's total so owners can navigate back after campaigns change.
  const { rows } = await query(
    `SELECT (SELECT COUNT(*)::int FROM growth_campaigns WHERE business_id=$1::uuid AND offer_kind<>'second_visit') AS total,
      COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY created_at DESC,id DESC) FROM (
        SELECT * FROM growth_campaigns WHERE business_id=$1::uuid AND offer_kind<>'second_visit'
        ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3
      ) page),'[]'::jsonb) AS campaigns`,
    [businessId, limit, offset],
  );
  return { campaigns: rows[0].campaigns.map(publicGrowthCampaign), total: rows[0].total, limit, offset };
}

// Recorded purchases survive point expiry. Bonus-point accounting below keeps
// its existing ledger statuses; it is separate from observed purchase activity.
export async function getGrowthCampaign(
  { businessId, campaignId },
  { query = dbQuery } = {},
) {
  const { rows } = await query(
    `WITH campaign AS (SELECT * FROM growth_campaigns WHERE business_id=$1::uuid AND id=$2::uuid),
    outcomes AS (
      SELECT m.allocation,m.id,(customer.id IS NULL OR customer.deleted_at IS NOT NULL) AS unavailable,COALESCE(s.sales,0) AS sales,COALESCE(s.purchases,0) AS purchases,
        CASE WHEN bonus.id IS NOT NULL THEN m.bonus_points_awarded ELSE 0 END AS bonus_points
      FROM growth_campaign_members m JOIN campaign g ON g.id=m.campaign_id AND g.business_id=m.business_id
      LEFT JOIN customers customer ON customer.id=m.customer_id AND customer.business_id=m.business_id
      LEFT JOIN LATERAL (SELECT SUM(t.amount_q) AS sales,COUNT(*) AS purchases FROM transactions t
        WHERE t.business_id=m.business_id AND t.customer_id=m.customer_id
        AND t.created_at>=g.starts_at AND t.created_at<g.expires_at AND t.created_at<=statement_timestamp() AND ${reportingPurchase('t')}) s ON true
      LEFT JOIN transactions bonus ON bonus.id=m.bonus_transaction_id AND bonus.business_id=m.business_id
        AND bonus.status IN ('POSTED','PENDING') AND bonus.original_transaction_id IS NULL AND bonus.reversed_transaction_id IS NULL
      WHERE m.business_id=$1::uuid AND m.allocation IS NOT NULL
    ) SELECT to_jsonb(g) AS campaign,statement_timestamp() AS as_of,b.program_json AS measurement_program,
      COALESCE((SELECT jsonb_object_agg(status,total) FROM (SELECT status,COUNT(*)::int AS total FROM growth_message_outbox WHERE business_id=$1::uuid AND campaign_id=$2::uuid GROUP BY status) delivery),'{}'::jsonb) AS message_counts,
      COALESCE((SELECT jsonb_agg(stats) FROM (
      SELECT allocation,COUNT(*)::int AS observed_members,COUNT(*) FILTER(WHERE unavailable)::int AS unavailable_members,COUNT(*) FILTER(WHERE purchases>0)::int AS returned_customers,SUM(sales) AS recorded_sales_q,SUM(bonus_points) AS bonus_points
      FROM outcomes GROUP BY allocation) stats),'[]'::jsonb) AS groups FROM campaign g JOIN businesses b ON b.id=g.business_id`,
    [businessId, campaignId],
  );
  if (!rows.length) throw notFound("No se encontró esta campaña.");
  const campaign = publicGrowthCampaign(rows[0].campaign);
  function group(allocation, count) {
    const row = rows[0].groups.find((item) => item.allocation === allocation);
    const sales = Number(row?.recorded_sales_q ?? 0),
      returned = Number(row?.returned_customers ?? 0);
    return {
      members: count,
      observed_members: Number(row?.observed_members ?? 0),
      unavailable_members: Number(row?.unavailable_members ?? 0),
      return_rate_interval: wilsonInterval(returned, count),
      returned_customers: returned,
      return_rate_pct: count ? (returned / count) * 100 : 0,
      recorded_sales_q: sales,
      average_sales_per_member_q: count ? sales / count : 0,
    };
  }
  const treatment = group("treatment", campaign.treatment_count),
    control = group("control", campaign.control_count);
  const bonusPoints = rows[0].groups.reduce(
    (sum, row) => sum + Number(row.bonus_points ?? 0),
    0,
  );
  return {
    campaign,
    results: {
      treatment,
      control,
      measurement: campaignMeasurement({ campaign, treatment, control, asOf: new Date(rows[0].as_of).toISOString(), business: {program_json:rows[0].measurement_program}, messageCounts:rows[0].message_counts }),
      estimated_incremental_sales_q:
        treatment.members && control.members
          ? (treatment.average_sales_per_member_q -
              control.average_sales_per_member_q) *
            treatment.members
          : null,
      bonus_points_issued: bonusPoints,
      estimated_incentive_cost_q:
        campaign.estimated_cost_per_point_q == null
          ? null
          : bonusPoints * campaign.estimated_cost_per_point_q,
      measurement_kind: campaign.offer_kind === "quiet" ? "descriptive" : "randomized_comparison",
      small_sample: campaign.offer_kind !== "quiet" && (treatment.members < 30 || control.members < 30),
    },
  };
}
