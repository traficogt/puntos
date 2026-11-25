import { normalizeMeasurementPlan } from "./campaign-experiment-model.js";
import { readCampaignReport } from "./campaign-report-service.js";
import { reportingPurchase } from "./reporting-purchase.js";
import { randomInt, randomUUID } from "node:crypto";
import { dbQuery, withTransaction } from "../database.js";
import { AuditRepo } from "../repositories/audit-repository.js";
import { PlanConfigService } from "./plan-config-service.js";
import { hasPlanFeature } from "../../utils/plan.js";
import { validateCampaignPreflight } from "./campaign-preflight-service.js";
import { snapshotCustomerAudience } from "./customer-audience-service.js";
import { withImpersonationMeta } from "../../utils/impersonation.js";
import { badRequest, conflict, forbidden, notFound } from "../../utils/http-error.js";
import { hasMaxScale } from "../../utils/money.js";
import { SYNC_AUDIENCE_LIMIT, assertAudienceWithinPlan } from "./scale-limits.js";

/** @typedef {import("./merchant-data-readiness.js").MerchantProgramJson} MerchantProgramJson */
/** @typedef {import("./merchant-data-readiness.js").MerchantAudienceSnapshot} MerchantAudienceSnapshot */
/**
 * growth_campaigns row (SELECT *), optionally joined with its business
 * (business_name, plan, program_json) or member counts. Timestamps are Date
 * objects from PostgreSQL and ISO strings when they come from JSON snapshots;
 * NUMERIC columns arrive as strings.
 * @typedef {{
 *   id: string,
 *   business_id: string,
 *   request_id?: string | null,
 *   recovery_run_id?: string | null,
 *   name: string,
 *   status: string,
 *   offer_kind: string,
 *   preparation_status: string,
 *   prepared_count: number,
 *   bonus_points: number,
 *   minimum_purchase_q: string | number,
 *   duration_days?: number | null,
 *   duration_minutes?: number | null,
 *   holdout_percent: number,
 *   points_budget: number | null,
 *   points_committed: number,
 *   estimated_cost_per_point_q?: string | number | null,
 *   measurement_plan?: unknown,
 *   audience_snapshot?: MerchantAudienceSnapshot | null,
 *   starts_at: string | Date | null,
 *   expires_at: string | Date | null,
 *   observation_ends_at?: string | Date | null,
 *   reconciliation_ends_at?: string | Date | null,
 *   paused_at?: string | Date | null,
 *   created_at: string | Date,
 *   created_by_staff_id?: string | null,
 *   member_count: number | null,
 *   treatment_count: number | null,
 *   control_count: number | null,
 *   business_name?: string,
 *   plan?: string,
 *   program_json?: MerchantProgramJson | null,
 * }} GrowthCampaignRow
 */
/** @typedef {import("../../types/db.js").DbQueryClient} TxClient */
/**
 * Owner request to create a campaign (route-validated).
 * @typedef {{
 *   businessId: string,
 *   staffId?: string | null,
 *   requestId: string,
 *   recoveryRunId?: string | null,
 *   audienceSegmentId?: string | null,
 *   audienceSegmentVersion?: number | null,
 *   audienceLimit?: number | null,
 *   now?: Date,
 *   name: string,
 *   bonusPoints: number,
 *   pointsBudget?: number | null,
 *   minimumPurchaseQ?: number,
 *   durationDays?: number | null,
 *   offerKind?: string,
 *   durationMinutes?: number | null,
 *   holdoutPercent?: number,
 *   estimatedCostPerPointQ?: number | null,
 *   measurementPlan?: unknown,
 *   ip?: string | null,
 *   ua?: string | null,
 *   impersonated_by?: string | null,
 * }} GrowthCampaignCreateRequest
 */
/**
 * Owner action on an existing campaign.
 * @typedef {{
 *   businessId: string,
 *   campaignId: string,
 *   staffId?: string | null,
 *   preflightId?: string | null,
 *   ip?: string | null,
 *   ua?: string | null,
 *   impersonated_by?: string | null,
 * }} GrowthCampaignTarget
 */
/**
 * Audit context shared by the campaign writers.
 * @typedef {{
 *   businessId: string,
 *   staffId?: string | null,
 *   ip?: string | null,
 *   ua?: string | null,
 *   impersonated_by?: string | null,
 * }} GrowthCampaignAuditContext
 */
/**
 * @typedef {{
 *   transaction?: typeof withTransaction,
 *   audit?: typeof AuditRepo.log,
 *   getPlanFeatureOverrides?: () => ReturnType<typeof PlanConfigService.getPlanFeatureOverrides>,
 * }} GrowthCampaignDeps
 */
/**
 * Campaign terms as validated before persisting.
 * @typedef {{
 *   name: unknown,
 *   bonusPoints: number,
 *   pointsBudget?: number | null,
 *   minimumPurchaseQ?: number,
 *   durationDays?: number | null,
 *   offerKind?: string,
 *   durationMinutes?: number | null,
 *   holdoutPercent?: number,
 *   estimatedCostPerPointQ?: number | null,
 * }} GrowthCampaignTerms
 */

/** @param {GrowthCampaignRow} row */
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
    points_remaining:
      row.points_budget == null
        ? null
        : Math.max(0, row.points_budget - Number(row.points_committed ?? 0)),
    budget_exhausted:
      row.points_budget != null &&
      row.points_budget - Number(row.points_committed ?? 0) < row.bonus_points,
    minimum_purchase_q: Number(row.minimum_purchase_q),
    duration_days: row.duration_days,
    holdout_percent: row.holdout_percent,
    estimated_cost_per_point_q:
      row.estimated_cost_per_point_q == null ? null : Number(row.estimated_cost_per_point_q),
    member_count: row.member_count,
    treatment_count: row.treatment_count,
    control_count: row.control_count,
    starts_at: row.starts_at ? new Date(row.starts_at).toISOString() : null,
    expires_at: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    paused_at: row.paused_at ? new Date(row.paused_at).toISOString() : null,
    measurement_plan: row.measurement_plan ?? null,
    observation_ends_at: row.observation_ends_at
      ? new Date(row.observation_ends_at).toISOString()
      : null,
    reconciliation_ends_at: row.reconciliation_ends_at
      ? new Date(row.reconciliation_ends_at).toISOString()
      : null,
    created_at: new Date(row.created_at).toISOString(),
  };
}

/**
 * @param {TxClient} client
 * @param {string} businessId
 * @param {Awaited<ReturnType<typeof PlanConfigService.getPlanFeatureOverrides>>} overrides
 * @returns {Promise<{ id: string, plan: string }>}
 */
export async function lockEntitledBusiness(client, businessId, overrides) {
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
  return rows[0];
}
/**
 * @param {typeof AuditRepo.log} audit
 * @param {string} action
 * @param {GrowthCampaignAuditContext} context
 * @param {Pick<GrowthCampaignRow, "id" | "status" | "member_count">} campaign
 */
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
    meta: withImpersonationMeta(
      {
        campaign_id: campaign.id,
        status: campaign.status,
        member_count: campaign.member_count,
      },
      { impersonated_by },
    ),
  });
}

/** @param {GrowthCampaignTerms} terms */
export function validateCampaignTerms({
  name,
  bonusPoints,
  pointsBudget = null,
  minimumPurchaseQ = 0,
  durationDays,
  offerKind = "experiment",
  durationMinutes = null,
  holdoutPercent = 20,
  estimatedCostPerPointQ = null,
}) {
  if (
    typeof name !== "string" ||
    !name.trim() ||
    name.trim().length > 100 ||
    /[\u0000-\u001f\u007f]/u.test(name) ||
    !Number.isInteger(bonusPoints) ||
    bonusPoints < 1 ||
    bonusPoints > 10000 ||
    !Number.isFinite(minimumPurchaseQ) ||
    minimumPurchaseQ < 0 ||
    minimumPurchaseQ > 999999.99 ||
    !hasMaxScale(minimumPurchaseQ, 2)
  )
    throw badRequest("Revisa el nombre, los puntos y la compra mínima.");
  if (
    pointsBudget !== null &&
    (!Number.isInteger(pointsBudget) || pointsBudget < bonusPoints || pointsBudget > 2000000)
  )
    throw badRequest("El límite debe cubrir al menos un bono y no superar 2,000,000 puntos.");
  if (
    estimatedCostPerPointQ !== null &&
    (!Number.isFinite(estimatedCostPerPointQ) ||
      estimatedCostPerPointQ < 0 ||
      estimatedCostPerPointQ > 100)
  )
    throw badRequest("Revisa el costo estimado de cada punto.");
  if (offerKind === "quiet") {
    if (
      durationDays !== null ||
      durationMinutes === null ||
      !Number.isInteger(durationMinutes) ||
      durationMinutes < 30 ||
      durationMinutes > 240 ||
      holdoutPercent !== 0 ||
      pointsBudget === null
    )
      throw badRequest(
        "La oferta breve necesita 30 a 240 minutos, un límite de puntos y ningún grupo de comparación.",
      );
  } else if (
    offerKind !== "experiment" ||
    !(/** @type {unknown[]} */ ([7, 14, 30]).includes(durationDays)) ||
    durationMinutes !== null ||
    ![10, 20, 30, 50].includes(holdoutPercent)
  )
    throw badRequest("Revisa la vigencia y el grupo de comparación de la campaña.");
}

/**
 * @param {GrowthCampaignCreateRequest} options
 * @param {GrowthCampaignDeps} [deps]
 */
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
    measurementPlan: requestedPlan = null,
  } = options;
  validateCampaignTerms({
    name,
    bonusPoints,
    pointsBudget,
    minimumPurchaseQ,
    durationDays,
    offerKind,
    durationMinutes,
    holdoutPercent,
    estimatedCostPerPointQ,
  });
  if (Boolean(recoveryRunId) === Boolean(audienceSegmentId))
    throw badRequest("Elige una lista de recuperación o una audiencia guardada.");
  if (
    audienceSegmentId &&
    (typeof audienceSegmentVersion !== "number" ||
      !Number.isInteger(audienceSegmentVersion) ||
      audienceSegmentVersion < 1 ||
      audienceSegmentVersion > 2147483647 ||
      typeof audienceLimit !== "number" ||
      !Number.isInteger(audienceLimit) ||
      audienceLimit < (offerKind === "quiet" ? 1 : 10) ||
      audienceLimit > SYNC_AUDIENCE_LIMIT)
  )
    // Synchronous creation is bounded (see scale-limits.js); the route sends larger
    // audiences, up to the plan limit, through the background preparation job.
    throw badRequest(
      `Indica la versión de la audiencia y un límite de ${offerKind === "quiet" ? 1 : 10} a ${SYNC_AUDIENCE_LIMIT} clientes. Las audiencias mayores se preparan en segundo plano.`,
    );
  if (recoveryRunId && (audienceSegmentVersion !== null || audienceLimit !== null))
    throw badRequest("Los ajustes de audiencia no corresponden a una lista de recuperación.");
  if (
    pointsBudget !== null &&
    (!Number.isInteger(pointsBudget) ||
      pointsBudget < bonusPoints ||
      pointsBudget < 1 ||
      pointsBudget > 2000000)
  )
    throw badRequest("El límite debe cubrir al menos un bono y no superar 2,000,000 puntos.");
  if (offerKind === "quiet" && requestedPlan != null)
    throw badRequest("Una oferta breve no admite un plan experimental.");
  const measurementPlan = normalizeMeasurementPlan(requestedPlan, { durationDays, holdoutPercent });
  const normalizedName = name.trim();
  // Shared plan settings use their own database transaction. Resolve them before
  // holding a purchase/campaign transaction so a busy pool cannot wait on itself.
  const overrides = await getPlanFeatureOverrides();
  return transaction(async (/** @type {TxClient} */ client) => {
    const business = await lockEntitledBusiness(client, businessId, overrides);
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
        JSON.stringify(
          normalizeMeasurementPlan(c.measurement_plan ?? null, {
            durationDays: c.duration_days,
            holdoutPercent: c.holdout_percent,
          }),
        ) !== JSON.stringify(measurementPlan) ||
        (c.estimated_cost_per_point_q == null ? null : Number(c.estimated_cost_per_point_q)) !==
          estimatedCostPerPointQ
      )
        throw conflict("Esta solicitud ya se usó con otros datos.");
      return { campaign: publicGrowthCampaign(c) };
    }
    if (audienceSegmentId) assertAudienceWithinPlan(business.plan, audienceLimit);
    let audience;
    /** @type {Awaited<ReturnType<typeof snapshotCustomerAudience>>["snapshot"] | null} */
    let audienceSnapshot = null;
    if (audienceSegmentId) {
      // Both are integers here: validated above whenever audienceSegmentId is set.
      const result = await snapshotCustomerAudience(
        {
          businessId,
          segmentId: audienceSegmentId,
          version: /** @type {number} */ (audienceSegmentVersion),
          limit: /** @type {number} */ (audienceLimit),
          now,
        },
        client,
      );
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
        WHERE m.business_id=$1::uuid AND m.run_id=$2::uuid AND c.deleted_at IS NULL ORDER BY c.id LIMIT $3::int FOR SHARE OF c`,
        // Recovery runs hold at most 200 members (analytics/recovery.js), so this bound
        // never truncates a run; it keeps the synchronous insert loop within budget.
        [businessId, recoveryRunId, SYNC_AUDIENCE_LIMIT],
      );
    }
    if (!audience.rowCount) throw badRequest("No hay clientes activos en esta lista.");
    const campaignId = randomUUID();
    const inserted = await client.query(
      `INSERT INTO growth_campaigns(id,business_id,request_id,recovery_run_id,name,bonus_points,minimum_purchase_q,duration_days,holdout_percent,estimated_cost_per_point_q,member_count,created_by_staff_id,points_budget,audience_snapshot,offer_kind,duration_minutes,measurement_plan)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17::jsonb) RETURNING *`,
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
        measurementPlan ? JSON.stringify(measurementPlan) : null,
      ],
    );
    for (const customer of audience.rows)
      await client.query(
        "INSERT INTO growth_campaign_members(id,business_id,campaign_id,customer_id) VALUES($1,$2,$3,$4)",
        [randomUUID(), businessId, campaignId, customer.id],
      );
    await auditChange(audit, "growth.campaign.created", options, inserted.rows[0]);
    return { campaign: publicGrowthCampaign(inserted.rows[0]) };
  });
}

/**
 * @param {GrowthCampaignTarget} options
 * @param {GrowthCampaignDeps} [deps]
 */
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
  return transaction(async (/** @type {TxClient} */ client) => {
    await lockEntitledBusiness(client, businessId, overrides);
    const selected = await client.query(
      "SELECT * FROM growth_campaigns WHERE business_id=$1::uuid AND id=$2::uuid FOR UPDATE",
      [businessId, campaignId],
    );
    const campaign = selected.rows[0];
    if (!campaign) throw notFound("No se encontró esta campaña.");
    if (campaign.status === "active") return { campaign: publicGrowthCampaign(campaign) };
    if (campaign.status !== "draft")
      throw conflict("Una campaña pausada no se puede reactivar. Crea otra campaña.");
    await validateCampaignPreflight({ ...options, campaign }, client);
    const active = await client.query(
      `SELECT m.id FROM growth_campaign_members m JOIN customers c ON c.business_id=m.business_id AND c.id=m.customer_id
      WHERE m.business_id=$1::uuid AND m.campaign_id=$2::uuid AND c.deleted_at IS NULL ORDER BY m.id FOR UPDATE OF m FOR SHARE OF c`,
      [businessId, campaignId],
    );
    if (Number(active.rowCount) < (campaign.offer_kind === "quiet" ? 1 : 10))
      throw badRequest("Se necesitan al menos 10 clientes activos para comparar la campaña.");
    const ids = active.rows.map((/** @type {{ id: string }} */ row) => row.id);
    // Fisher–Yates uses Node's cryptographic integer sampler. Store assignments,
    // never rerandomize them on requests, purchases or measurement refreshes.
    for (let i = ids.length - 1; i > 0; i -= 1) {
      const j = randomInt(i + 1);
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    const controls =
      campaign.offer_kind === "quiet"
        ? 0
        : Math.max(1, Math.round((ids.length * campaign.holdout_percent) / 100));
    await client.query(
      "UPDATE growth_campaign_members SET allocation=CASE WHEN id=ANY($3::uuid[]) THEN 'control' ELSE 'treatment' END WHERE business_id=$1::uuid AND campaign_id=$2::uuid AND id=ANY($4::uuid[])",
      [businessId, campaignId, ids.slice(0, controls), ids],
    );
    const updated = await client.query(
      `WITH activation AS MATERIALIZED (SELECT clock_timestamp() AS at)
      UPDATE growth_campaigns SET status='active',member_count=$3,control_count=$4,treatment_count=$3::int-$4::int,
      observation_ends_at=CASE WHEN measurement_plan IS NOT NULL THEN activation.at+(measurement_plan->>'observation_days')::int*interval '24 hours' END,
      reconciliation_ends_at=CASE WHEN measurement_plan IS NOT NULL THEN activation.at+((measurement_plan->>'observation_days')::int+(measurement_plan->>'reconciliation_days')::int)*interval '24 hours' END,
      starts_at=activation.at,expires_at=activation.at+CASE WHEN offer_kind='quiet' THEN duration_minutes*interval '1 minute' ELSE duration_days*interval '24 hours' END FROM activation WHERE business_id=$1::uuid AND id=$2::uuid RETURNING growth_campaigns.*`,
      [businessId, campaignId, ids.length, controls],
    );
    if (campaign.offer_kind !== "quiet")
      await client.query(
        `UPDATE growth_campaign_members m SET measurement_baseline=(
      SELECT jsonb_build_object('as_of',g.starts_at,'window_days',COALESCE((g.measurement_plan->>'observation_days')::int,g.duration_days),
        'purchases',count(t.id),'sales_q',COALESCE(sum(t.amount_q),0))
      FROM growth_campaigns g LEFT JOIN transactions t ON t.business_id=g.business_id AND t.customer_id=m.customer_id
        AND COALESCE(t.purchase_occurred_at,t.created_at)>=g.starts_at-COALESCE((g.measurement_plan->>'observation_days')::int,g.duration_days)*interval '24 hours'
        AND COALESCE(t.purchase_occurred_at,t.created_at)<g.starts_at AND t.created_at<=g.starts_at AND ${reportingPurchase("t")}
      WHERE g.business_id=m.business_id AND g.id=m.campaign_id GROUP BY g.starts_at,g.measurement_plan,g.duration_days)
      WHERE m.business_id=$1 AND m.campaign_id=$2 AND m.allocation IS NOT NULL AND m.measurement_baseline IS NULL`,
        [businessId, campaignId],
      );
    await client.query(
      "UPDATE businesses SET program_json=jsonb_set(COALESCE(program_json,'{}'::jsonb),'{targeted_offers_enabled}','true'::jsonb,true) WHERE id=$1::uuid",
      [businessId],
    );
    await auditChange(audit, "growth.campaign.activated", options, updated.rows[0]);
    return { campaign: publicGrowthCampaign(updated.rows[0]) };
  });
}

/**
 * @param {GrowthCampaignTarget} options
 * @param {GrowthCampaignDeps} [deps]
 */
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
  return transaction(async (/** @type {TxClient} */ client) => {
    await lockEntitledBusiness(client, businessId, overrides);
    const selected = await client.query(
      "SELECT * FROM growth_campaigns WHERE business_id=$1::uuid AND id=$2::uuid FOR UPDATE",
      [businessId, campaignId],
    );
    const campaign = selected.rows[0];
    if (!campaign) throw notFound("No se encontró esta campaña.");
    if (campaign.status === "paused") return { campaign: publicGrowthCampaign(campaign) };
    if (campaign.status !== "active") throw conflict("Solo puedes pausar una campaña activada.");
    const updated = await client.query(
      "UPDATE growth_campaigns SET status='paused',paused_at=clock_timestamp() WHERE business_id=$1::uuid AND id=$2::uuid RETURNING *",
      [businessId, campaignId],
    );
    await auditChange(audit, "growth.campaign.paused", options, updated.rows[0]);
    return { campaign: publicGrowthCampaign(updated.rows[0]) };
  });
}

/**
 * @param {{ businessId: string, limit?: number, offset?: number }} input
 * @param {{ query?: typeof dbQuery }} [deps]
 */
export async function listGrowthCampaigns(
  { businessId, limit = 20, offset = 0 },
  { query = dbQuery } = {},
) {
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 50 ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > 100000
  ) {
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
  return {
    campaigns: rows[0].campaigns.map(publicGrowthCampaign),
    total: rows[0].total,
    limit,
    offset,
  };
}

// Additive report contract preserves all existing result fields.
/**
 * @param {Parameters<typeof readCampaignReport>[0]} options
 * @param {Parameters<typeof readCampaignReport>[1]} [dependencies]
 */
export async function getGrowthCampaign(options, dependencies = {}) {
  return readCampaignReport(options, dependencies);
}
