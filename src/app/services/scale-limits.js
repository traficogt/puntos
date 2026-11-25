// Scale limits for owner bulk operations: campaign audiences and customer imports.
// Reference: docs/product/2026-11-11-competitive-position.md ("Current product limits").
//
// Why the old fixed limits existed (measured 2026-11-24): neither protected the wallet
// push caps (those are enforced per business per request in queueCampaignMessages and
// per recipient at delivery) nor the request body (a campaign request carries an
// integer; an import carries at most 200 KB of CSV inside the 1 MB JSON limit). Both
// bounded synchronous work inside one request transaction:
// - campaign creation inserted one member per statement while holding the business row
//   (FOR NO KEY UPDATE) and a FOR SHARE lock on every selected customer;
// - an import runs one advisory lock plus two inserts per row (the integration suite
//   pins <= 305 statements per 100 rows) under a tenant-wide advisory lock.
// The limits below keep that per-request budget and move anything larger to the
// background job queue, chunked and resumable.
import { normalizePlan, planLimits } from "../../utils/plan.js";
import { badRequest } from "../../utils/http-error.js";
import { PLAN_DISPLAY_NAMES } from "./public-plan-service.js";

/** Members a request snapshots synchronously; larger audiences are prepared by a job. */
export const SYNC_AUDIENCE_LIMIT = 200;
/** Members inserted per worker transaction while preparing a campaign. */
export const PREPARATION_CHUNK = 250;
/**
 * Technical ceiling per campaign: growth_campaign_preparations.customer_ids is checked
 * at 5,000 entries and activation allocates the whole audience in one statement.
 * Raising it needs a migration; it is not a plan limit.
 */
export const AUDIENCE_TECHNICAL_CEILING = 5000;
/**
 * Rows one import request commits synchronously, and rows per import-job chunk. The
 * customer_migration_batches count CHECKs were widened to this value by the migration
 * 2026-11-24-import-batch-200.sql; raising it again needs another migration.
 */
export const IMPORT_CHUNK_ROWS = 200;
/** Rows per import file: customer_import_jobs.total is checked at 5,000. */
export const IMPORT_FILE_ROWS = 5000;
/** PLAN_LIMITS.activeCustomers at or above this value means "no plan limit". */
const UNLIMITED_ACTIVE_CUSTOMERS = 999999;

/**
 * "2,000" (the thousands separator used in owner-facing copy).
 * @param {number | string} value
 */
export function formatCount(value) {
  return Number(value).toLocaleString("en-US");
}

/** @param {string | null | undefined} plan */
export function planDisplayName(plan) {
  const key = normalizePlan(plan);
  return /** @type {Record<string, string>} */ (PLAN_DISPLAY_NAMES)[key] ?? key;
}

/**
 * Plan limit for one campaign audience: the plan's active-customer soft cap
 * (Conecta 300, Impulsa 2,000) or null when the plan has no limit (Expande).
 * @param {string | null | undefined} plan
 */
export function planAudienceLimit(plan) {
  const cap = Number(planLimits(plan).activeCustomers);
  return Number.isFinite(cap) && cap < UNLIMITED_ACTIVE_CUSTOMERS ? cap : null;
}

/**
 * The largest audience one campaign on this plan may request.
 * @param {string | null | undefined} plan
 */
export function audienceCeiling(plan) {
  const cap = planAudienceLimit(plan);
  return cap === null ? AUDIENCE_TECHNICAL_CEILING : Math.min(cap, AUDIENCE_TECHNICAL_CEILING);
}

/** One row per plan, for tests and documentation. */
export function scaleLimitsTable() {
  return ["EMPRENDEDOR", "NEGOCIO", "EMPRESA"].map((plan) => ({
    plan,
    name: planDisplayName(plan),
    audience_limit: planAudienceLimit(plan),
    audience_ceiling: audienceCeiling(plan),
    import_rows_per_file: IMPORT_FILE_ROWS,
    import_chunk_rows: IMPORT_CHUNK_ROWS,
  }));
}

/**
 * Throws a 400 with owner-facing Spanish when the audience exceeds the plan or ceiling.
 * @param {string | null | undefined} plan
 * @param {number | string | null | undefined} audienceLimit the requested maximum, as validated by the route (`Number()`-coerced)
 */
export function assertAudienceWithinPlan(plan, audienceLimit) {
  const requested = Number(audienceLimit);
  if (requested > AUDIENCE_TECHNICAL_CEILING)
    throw badRequest(
      `Una campaña admite hasta ${formatCount(AUDIENCE_TECHNICAL_CEILING)} clientes. Divide la audiencia en varias campañas.`,
      "AUDIENCE_CEILING",
    );
  const cap = planAudienceLimit(plan);
  if (cap !== null && requested > cap)
    throw badRequest(
      `Tu plan ${planDisplayName(plan)} permite hasta ${formatCount(cap)} clientes por campaña. Reduce el máximo de clientes o amplía tu plan.`,
      "PLAN_AUDIENCE_LIMIT",
    );
}

/**
 * The next import chunk for a job cursor: rows [start, end) of `total`, its 1-based
 * label index and the total number of chunks. Pure, so restarts recompute the same
 * chunk from the persisted `processed` cursor.
 * @param {number | null | undefined} processed
 * @param {number | null | undefined} total
 * @param {number} [size]
 */
export function importChunk(processed, total, size = IMPORT_CHUNK_ROWS) {
  const start = Math.max(0, Math.min(Number(processed) || 0, Number(total) || 0));
  return {
    start,
    end: Math.min(Number(total) || 0, start + size),
    index: Math.floor(start / size) + 1,
    chunks: Math.ceil((Number(total) || 0) / size),
  };
}
