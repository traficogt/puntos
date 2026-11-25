import { createHash, randomUUID } from "node:crypto";
import { dbQuery, withTransaction } from "../database.js";
import { AuditRepo } from "../repositories/audit-repository.js";
import { badRequest, conflict, notFound } from "../../utils/http-error.js";
import { withImpersonationMeta } from "../../utils/impersonation.js";
import { publicGrowthCampaign } from "./growth-campaign-service.js";
import { campaignMeasurement, returnDifference, wilsonInterval } from "./campaign-measurement.js";
import {
  campaignContribution,
  campaignDecision,
  planCampaignExperiment,
} from "./campaign-experiment-model.js";
import { MeasurementCostInput } from "./campaign-measurement-input.js";
import { campaignReportQuery } from "./campaign-report-query.js";

/** @typedef {import("../../types/db.js").DbQueryClient} TxClient */
/** @typedef {import("./growth-campaign-service.js").GrowthCampaignRow} GrowthCampaignRow */
/** @typedef {import("./merchant-data-readiness.js").MerchantProgramJson} MerchantProgramJson */
/**
 * Per-allocation aggregate of campaignReportQuery; metric columns are read by
 * computed name (`${period}_returned_customers`, ...), so they stay unknown.
 * @typedef {{ allocation: string, [column: string]: unknown }} CampaignReportGroupRow
 */
/**
 * One row of campaignReportQuery (see campaign-report-query.js).
 * @typedef {{
 *   campaign: GrowthCampaignRow,
 *   as_of: string | Date,
 *   groups: CampaignReportGroupRow[],
 *   receipt_coverage: { total: unknown, linked: unknown, unmatched: unknown, rejected: unknown } | null,
 *   unallocated_refunds: unknown,
 *   measurement_program: MerchantProgramJson | null,
 *   message_counts: Record<string, unknown>,
 *   cost_revision: { inputs: Record<string, number | null>, revision: number, created_at: string | Date } | null,
 *   last_report: {
 *     id: string,
 *     revision: number,
 *     created_at: string | Date,
 *     fingerprint: string,
 *     payload: { results?: { measurement?: { as_of?: unknown } } } | null,
 *   } | null,
 * }} CampaignReportRow
 */
/**
 * Owner request for a measurement write (costs or a saved report revision).
 * @typedef {{
 *   businessId: string,
 *   campaignId: string,
 *   requestId: string,
 *   staffId?: string | null,
 *   ip?: string | null,
 *   ua?: string | null,
 *   impersonated_by?: string | null,
 *   costs?: unknown,
 * }} MeasurementOptions
 */
/** @typedef {{ transaction?: typeof withTransaction, audit?: typeof AuditRepo.log }} MeasurementDeps */

/** @param {unknown} value */
const numeric = (value) => Number(value ?? 0);
const costKeys = [
  "gross_margin_pct",
  "fulfillment_cost_q",
  "messaging_cost_q",
  "other_cost_q",
  "outstanding_reward_cost_q",
];
/**
 * @param {CampaignReportGroupRow[]} rows
 * @param {"treatment" | "control"} allocation
 * @param {number | null | undefined} count assigned members (null before activation)
 * @param {"" | "followup" | "offer"} [period]
 */
function group(rows, allocation, count, period = "") {
  const r = rows.find((item) => item.allocation === allocation),
    returned = numeric(r?.[period ? `${period}_returned_customers` : "returned_customers"]);
  const sales = numeric(r?.[period ? `${period}_sales_q` : "recorded_sales_q"]);
  const baselineKnown =
    !!r && numeric(r.missing_preperiod_members) === 0 && numeric(r.observed_members) === count;
  return {
    members: count,
    observed_members: numeric(r?.observed_members),
    unavailable_members: numeric(r?.unavailable_members),
    returned_customers: returned,
    return_rate_pct: count ? (returned / count) * 100 : 0,
    return_rate_interval: wilsonInterval(returned, count),
    recorded_sales_q: sales,
    average_sales_per_member_q: count ? sales / count : 0,
    ...(!period
      ? {
          gross_sales_q: numeric(r?.gross_sales_q),
          refunds_q: numeric(r?.refunds_q),
          baseline_returned_customers: baselineKnown
            ? numeric(r?.baseline_returned_customers)
            : null,
          baseline_purchase_rate_pct:
            baselineKnown && count ? (numeric(r?.baseline_returned_customers) / count) * 100 : null,
          baseline_sales_q: baselineKnown ? numeric(r?.baseline_sales_q) : null,
        }
      : {}),
  };
}
/**
 * @param {unknown} value
 * @returns {unknown}
 */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical(/** @type {Record<string, unknown>} */ (value)[k])]),
    );
  return value;
}
/**
 * @param {{
 *   measurement: {
 *     as_of?: unknown,
 *     window: Record<string, unknown>,
 *     data_readiness: { state: unknown, reason?: unknown },
 *     [key: string]: unknown,
 *   },
 *   report_revision?: unknown,
 *   [key: string]: unknown,
 * }} results
 */
export function measurementFingerprint(results) {
  // Clock time alone never creates a revision; observed facts and phase do.
  const { measurement: m, ...rest } = results;
  const { as_of: _asOf, window: w, data_readiness, ...measurement } = m;
  const { observed_until: _observedUntil, ...window } = w;
  const { report_revision: _reportRevision, ...evidence } = rest;
  return createHash("sha256")
    .update(
      JSON.stringify(
        canonical({
          ...evidence,
          measurement: {
            ...measurement,
            window,
            data_readiness: { state: data_readiness.state, reason: data_readiness.reason ?? null },
          },
        }),
      ),
    )
    .digest("hex");
}
/**
 * @param {{ businessId: string, campaignId: string }} target
 * @param {{ query?: typeof dbQuery }} [deps]
 */
export async function readCampaignReport({ businessId, campaignId }, { query = dbQuery } = {}) {
  const { rows } = await query(campaignReportQuery, [businessId, campaignId]);
  if (!rows[0]) throw notFound("No se encontró esta campaña.");
  /** @type {CampaignReportRow} */
  const r = rows[0];
  const campaign = publicGrowthCampaign(r.campaign),
    asOf = new Date(r.as_of).toISOString(),
    quiet = campaign.offer_kind === "quiet";
  const treatment = group(r.groups, "treatment", campaign.treatment_count),
    control = group(r.groups, "control", campaign.control_count);
  const planning = planCampaignExperiment({
    plan: campaign.measurement_plan,
    holdoutPercent: campaign.holdout_percent,
    availableMembers: campaign.member_count,
  });
  /** @param {string} key */
  const sum = (key) => r.groups.reduce((n, row) => n + numeric(row[key]), 0);
  const coverage = r.receipt_coverage ?? { total: 0, linked: 0, unmatched: 0, rejected: 0 };
  const baselineDifference = returnDifference(
    { ...treatment, returned_customers: treatment.baseline_returned_customers },
    { ...control, returned_customers: control.baseline_returned_customers },
  );
  const diagnostics = {
    assignment_counts_match:
      treatment.members === treatment.observed_members &&
      control.members === control.observed_members,
    missing_purchase_dates: sum("missing_purchase_dates"),
    late_purchases: sum("late_purchases"),
    untrusted_time_purchases: sum("untrusted_time_purchases"),
    legacy_time_purchases: sum("legacy_time_purchases"),
    pending_refunds: sum("pending_refunds") + numeric(r.unallocated_refunds),
    unallocated_refunds: numeric(r.unallocated_refunds),
    overlap_members: sum("overlap_members"),
    missing_preperiod_members: sum("missing_preperiod_members"),
    baseline_imbalance: Boolean(
      baselineDifference && (baselineDifference.lower_pp > 0 || baselineDifference.upper_pp < 0),
    ),
    baseline_difference: baselineDifference,
    capture_state:
      numeric(coverage.unmatched) + numeric(coverage.rejected) > 0 ? "incomplete" : "unknown",
    receipt_coverage: { ...coverage, scope: "observed_ingestion_only", arm_matching_rates: null },
    notes: [
      "Los recibos identificados no prueban que el sistema de caja envió todas sus ventas. Los recibos sin cliente no pueden asignarse a un grupo.",
      "Una oferta simultánea indica elegibilidad, no lectura del mensaje ni uso del beneficio. No eliminamos esos clientes de los grupos.",
      "La comparación de actividad previa es un diagnóstico exploratorio; no cambia la asignación ni ajusta automáticamente los resultados.",
    ],
  };
  const measurement = campaignMeasurement({
    campaign,
    treatment,
    control,
    asOf,
    business: { program_json: r.measurement_program },
    messageCounts: r.message_counts,
    planning,
    diagnostics,
  });
  const end = campaign.observation_ends_at ?? campaign.expires_at,
    reconcile = campaign.reconciliation_ends_at ?? end;
  // Date.parse(null) is NaN; keep that for stamps the campaign does not have yet.
  /** @param {string | null | undefined} value */
  const parseTime = (value) => (value == null ? NaN : Date.parse(value));
  const postTreatment = group(r.groups, "treatment", campaign.treatment_count, "followup"),
    postControl = group(r.groups, "control", campaign.control_count, "followup");
  const followup = {
    state:
      !end || Date.parse(asOf) < Date.parse(end)
        ? "waiting"
        : Date.parse(asOf) < parseTime(reconcile)
          ? "reconciling"
          : "complete",
    starts_at: campaign.expires_at,
    ends_at: end,
    reconciliation_ends_at: reconcile,
    available: !!end && Date.parse(end) > parseTime(campaign.expires_at),
    treatment: postTreatment,
    control: postControl,
    return_difference:
      quiet || !end || Date.parse(end) <= parseTime(campaign.expires_at)
        ? null
        : returnDifference(postTreatment, postControl),
    interpretation:
      "Seguimiento exploratorio después de la oferta, con los grupos originales. No prueba por sí solo adelanto de compras ni persistencia causal.",
  };
  const costs = r.cost_revision?.inputs ?? null;
  const contribution = campaignContribution({
    treatment,
    control,
    costs: costs ? Object.fromEntries(costKeys.map((k) => [k, costs[k] ?? null])) : null,
  });
  const results = {
    treatment,
    control,
    measurement,
    planning,
    diagnostics,
    followup,
    offer_period: {
      starts_at: campaign.starts_at,
      ends_at: campaign.expires_at,
      treatment: group(r.groups, "treatment", campaign.treatment_count, "offer"),
      control: group(r.groups, "control", campaign.control_count, "offer"),
    },
    contribution,
    costs,
    cost_revision: r.cost_revision?.revision ?? null,
    cost_updated_at: r.cost_revision?.created_at ?? null,
    decision: campaignDecision({ measurement, planning, diagnostics, contribution, followup }),
    estimated_incremental_sales_q:
      treatment.members && control.members
        ? (treatment.average_sales_per_member_q - control.average_sales_per_member_q) *
          treatment.members
        : null,
    bonus_points_issued: sum("bonus_points"),
    estimated_incentive_cost_q:
      campaign.estimated_cost_per_point_q == null
        ? null
        : sum("bonus_points") * campaign.estimated_cost_per_point_q,
    measurement_kind: quiet ? "descriptive" : "randomized_comparison",
    small_sample: quiet
      ? false
      : planning
        ? !planning.feasible
        : Number(treatment.members) < 30 || Number(control.members) < 30,
  };
  const fingerprint = measurementFingerprint(results),
    last = r.last_report;
  // Same [[Set]] as a property assignment; keeps `results` typed from its literal.
  Object.assign(results, {
    report_revision: {
      latest: last
        ? {
            id: last.id,
            revision: last.revision,
            created_at: last.created_at,
            as_of: last.payload?.results?.measurement?.as_of,
          }
        : null,
      changed: !!last && last.fingerprint !== fingerprint,
      reason:
        last && last.fingerprint !== fingerprint
          ? "Los datos, los costos o la etapa de observación cambiaron desde el último corte guardado. Guarda una nueva revisión para conservar ambos."
          : null,
    },
  });
  return { campaign, results };
}
/**
 * @param {TxClient} client
 * @param {string} businessId
 * @param {string} campaignId
 */
async function lockedCampaign(client, businessId, campaignId) {
  const { rows } = await client.query(
    "SELECT id FROM growth_campaigns WHERE business_id=$1 AND id=$2 FOR UPDATE",
    [businessId, campaignId],
  );
  if (!rows[0]) throw notFound("No se encontró esta campaña.");
}
/**
 * @param {typeof AuditRepo.log} audit
 * @param {MeasurementOptions} options
 * @param {string} action
 * @param {number} revision
 */
async function auditEvidence(audit, options, action, revision) {
  await audit({
    id: randomUUID(),
    business_id: options.businessId,
    actor_type: "STAFF",
    actor_id: options.staffId,
    action,
    ip: options.ip ?? null,
    ua: options.ua ?? null,
    meta: withImpersonationMeta(
      { campaign_id: options.campaignId, revision },
      { impersonated_by: options.impersonated_by ?? null },
    ),
  });
}
/**
 * @param {MeasurementOptions} options
 * @param {MeasurementDeps} [deps]
 */
export async function saveMeasurementCosts(
  options,
  { transaction = withTransaction, audit = AuditRepo.log } = {},
) {
  const { businessId, campaignId, requestId, staffId } = options,
    parsed = MeasurementCostInput.safeParse(options.costs);
  if (!parsed.success)
    throw badRequest(
      "Revisa los costos. Deja vacío lo desconocido y usa cero solo para un costo confirmado.",
    );
  const costs = parsed.data;
  return transaction(async (/** @type {TxClient} */ client) => {
    await lockedCampaign(client, businessId, campaignId);
    const previous = (
      await client.query(
        "SELECT * FROM growth_measurement_costs WHERE business_id=$1 AND campaign_id=$2 AND request_id=$3",
        [businessId, campaignId, requestId],
      )
    ).rows[0];
    if (previous) {
      if (JSON.stringify(canonical(previous.inputs)) !== JSON.stringify(canonical(costs)))
        throw conflict("Esta solicitud ya se usó con otros costos.");
      return {
        costs: previous.inputs,
        revision: previous.revision,
        created_at: previous.created_at,
      };
    }
    const row = (
      await client.query(
        `INSERT INTO growth_measurement_costs(id,business_id,campaign_id,request_id,revision,inputs,created_by_staff_id)
   SELECT $1,$2,$3,$4,COALESCE(max(revision),0)+1,$5::jsonb,$6 FROM growth_measurement_costs WHERE business_id=$2 AND campaign_id=$3 RETURNING *`,
        [randomUUID(), businessId, campaignId, requestId, JSON.stringify(costs), staffId],
      )
    ).rows[0];
    await auditEvidence(audit, options, "growth.measurement.costs_recorded", row.revision);
    return { costs: row.inputs, revision: row.revision, created_at: row.created_at };
  });
}
/**
 * @param {MeasurementOptions} options
 * @param {MeasurementDeps} [deps]
 */
export async function saveMeasurementReport(
  options,
  { transaction = withTransaction, audit = AuditRepo.log } = {},
) {
  const { businessId, campaignId, requestId, staffId } = options;
  return transaction(async (/** @type {TxClient} */ client) => {
    await lockedCampaign(client, businessId, campaignId);
    const previous = (
      await client.query(
        "SELECT * FROM growth_measurement_reports WHERE business_id=$1 AND campaign_id=$2 AND request_id=$3",
        [businessId, campaignId, requestId],
      )
    ).rows[0];
    if (previous)
      return { id: previous.id, revision: previous.revision, created_at: previous.created_at };
    const payload = await readCampaignReport(
        { businessId, campaignId },
        { query: client.query.bind(client) },
      ),
      fingerprint = measurementFingerprint(payload.results);
    const row = (
      await client.query(
        `INSERT INTO growth_measurement_reports(id,business_id,campaign_id,request_id,revision,fingerprint,payload,created_by_staff_id)
   SELECT $1,$2,$3,$4,COALESCE(max(revision),0)+1,$5,$6::jsonb,$7 FROM growth_measurement_reports WHERE business_id=$2 AND campaign_id=$3 RETURNING id,revision,created_at`,
        [
          randomUUID(),
          businessId,
          campaignId,
          requestId,
          fingerprint,
          JSON.stringify(payload),
          staffId,
        ],
      )
    ).rows[0];
    await auditEvidence(audit, options, "growth.measurement.report_saved", row.revision);
    return row;
  });
}
/**
 * @param {{ businessId: string, campaignId: string }} target
 * @param {{ query?: typeof dbQuery }} [deps]
 */
export async function listMeasurementReports({ businessId, campaignId }, { query = dbQuery } = {}) {
  const { rows } = await query(
    `SELECT g.id,COALESCE((SELECT jsonb_agg(r ORDER BY r.revision DESC) FROM (
  SELECT id,revision,created_at,payload->'results'->'measurement'->>'as_of' AS as_of,payload->'results'->'decision' AS decision,
   payload->'results'->'treatment' AS treatment,payload->'results'->'control' AS control,payload->'results'->'contribution' AS contribution
  FROM growth_measurement_reports WHERE business_id=$1 AND campaign_id=$2 ORDER BY revision DESC LIMIT 50) r),'[]'::jsonb) AS reports
  FROM growth_campaigns g WHERE g.business_id=$1 AND g.id=$2`,
    [businessId, campaignId],
  );
  if (!rows[0]) throw notFound("No se encontró esta campaña.");
  return { reports: rows[0].reports, limit: 50 };
}
