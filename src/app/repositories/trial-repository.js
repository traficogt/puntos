import { dbQuery, getDbPlatformAdmin } from "../database.js";
import { one, many, exec } from "./base.js";

/**
 * Row of `trial_phone_grants` (a verified signup phone's short-lived token).
 * @typedef {{ id: string, token_hash: string, phone: string, created_at: Date, expires_at: Date, consumed_at: Date | null }} TrialPhoneGrantRow
 */
/**
 * A trialing business as the daily job and the super console list it.
 * @typedef {{
 *   id: string,
 *   name: string,
 *   slug: string,
 *   email: string,
 *   plan: string,
 *   program_json: Record<string, unknown> | null,
 *   signup_source: string,
 *   trial_status: string,
 *   billing_status: string,
 *   trial_phone: string | null,
 *   trial_started_at: Date | null,
 *   trial_ends_at: Date | null,
 *   locked_at: Date | null,
 *   purge_after: Date | null,
 *   created_at: Date,
 *   kinds_sent: string[]
 * }} TrialBusinessRow
 */
/**
 * @typedef {TrialBusinessRow & {
 *   customers: number,
 *   programa_en_marcha_at: Date | null,
 *   primer_cliente_at: Date | null
 * }} TrialListingRow
 */
/**
 * Row of `billing_subscriptions`.
 * @typedef {{
 *   id: string,
 *   business_id: string,
 *   provider: string,
 *   provider_subscription_id: string,
 *   plan: string,
 *   quantity: number,
 *   currency: string,
 *   unit_amount_minor: number,
 *   status: string,
 *   current_period_start: Date | null,
 *   current_period_end: Date | null,
 *   cancel_at: Date | null,
 *   canceled_at: Date | null,
 *   metadata: Record<string, unknown>,
 *   created_at: Date,
 *   updated_at: Date
 * }} BillingSubscriptionRow
 */
/** Row counts a purge would remove, per child table (dry-run report). */
/** @typedef {{ business_id: string, name: string, slug: string, purge_after: Date, locked_at: Date | null, counts: Record<string, number> }} PurgeCandidate */

const TRIAL_COLUMNS = `b.id, b.name, b.slug, b.email, b.plan, b.program_json, b.signup_source, b.trial_status,
  b.billing_status, b.trial_phone, b.trial_started_at, b.trial_ends_at, b.locked_at, b.purge_after, b.created_at,
  COALESCE((SELECT array_agg(n.kind ORDER BY n.kind) FROM trial_notifications n WHERE n.business_id=b.id), '{}') AS kinds_sent`;

/** Child tables counted by the purge dry run (every one references businesses(id)). */
export const PURGE_COUNT_TABLES = Object.freeze([
  "customers",
  "transactions",
  "redemptions",
  "staff_users",
  "branches",
  "rewards",
  "message_logs",
  "native_wallet_passes",
  "audit_logs",
  "billing_events",
]);

// Global phone grants and cross-tenant trial listings are internal platform operations.
/**
 * @param {string} sql
 * @param {unknown[]} [args]
 */
function platformQuery(sql, args = []) {
  if (!getDbPlatformAdmin())
    throw new Error("Trial platform data requires trusted platform context");
  return dbQuery(sql, args);
}

export const TrialRepo = {
  // --- phone grants (platform context) -----------------------------------------------
  /** @param {{ id: string, token_hash: string, phone: string, expires_at: Date | string }} grant */
  async createGrant({ id, token_hash, phone, expires_at }) {
    await platformQuery(
      "INSERT INTO trial_phone_grants(id,token_hash,phone,expires_at) VALUES($1,$2,$3,$4)",
      [id, token_hash, phone, expires_at],
    );
  },
  /**
   * Resolves to `Pick<TrialPhoneGrantRow, "id" | "phone"> | null`; locks the row.
   * @param {string} tokenHash
   */
  async lockGrant(tokenHash) {
    const { rows } = await platformQuery(
      `SELECT id,phone FROM trial_phone_grants WHERE token_hash=$1
      AND consumed_at IS NULL AND expires_at>now() FOR UPDATE`,
      [tokenHash],
    );
    return rows[0] ?? null;
  },
  /** @param {string} id */
  async consumeGrant(id) {
    const { rowCount } = await platformQuery(
      `UPDATE trial_phone_grants SET consumed_at=now()
      WHERE id=$1 AND consumed_at IS NULL AND expires_at>now()`,
      [id],
    );
    return rowCount === 1;
  },
  /** Gives a grant back when business creation failed after it was consumed. @param {string} id */
  async restoreGrant(id) {
    await platformQuery(
      "UPDATE trial_phone_grants SET consumed_at=NULL WHERE id=$1 AND expires_at>now()",
      [id],
    );
  },
  /** @param {string} phone */
  async phoneHasTrial(phone) {
    const { rows } = await platformQuery("SELECT 1 FROM businesses WHERE trial_phone=$1", [phone]);
    return rows.length > 0;
  },
  /** Platform phone-proof codes issued today (UTC day): the SMS circuit breaker reads it. */
  async countPhoneCodesToday() {
    const { rows } = await platformQuery(
      "SELECT count(*)::int AS n FROM mobile_access_codes WHERE created_at >= date_trunc('day', now())",
    );
    return Number(rows[0]?.n ?? 0);
  },

  // --- state transitions (caller's context: platform job or super console) -------------
  /**
   * Soft lock at the end of the trial; only a trialing business moves, so the daily job
   * and a super action can race safely. Resolves to the id when the lock was applied.
   * @param {{ businessId: string, now: Date, purgeAfter: Date }} input
   */
  async lockExpired({ businessId, now, purgeAfter }) {
    const row = await one(
      `UPDATE businesses SET billing_status='locked', trial_status='expired', locked_at=$2,
        purge_after=$3, updated_at=now()
       WHERE id=$1 AND billing_status='trialing' RETURNING id`,
      [businessId, now, purgeAfter],
    );
    return row ? String(row.id) : null;
  },
  /**
   * Extends (or re-opens) a trial by `days` from the later of now and the current end,
   * and clears the reminder markers so the new window re-notifies.
   * @param {{ businessId: string, days: number, now: Date }} input
   */
  async extend({ businessId, days, now }) {
    const row = await one(
      `UPDATE businesses SET
         trial_ends_at = GREATEST(trial_ends_at, $3::timestamptz) + make_interval(days => $2::int),
         trial_status='active', billing_status='trialing', locked_at=NULL, purge_after=NULL, updated_at=now()
       WHERE id=$1 AND trial_status IN ('active','expired') AND billing_status IN ('trialing','locked')
       RETURNING *`,
      [businessId, days, now],
    );
    if (row)
      await exec(
        `DELETE FROM trial_notifications WHERE business_id=$1 AND kind IN ('day10','day13','locked','purge7')`,
        [businessId],
      );
    return row;
  },
  /**
   * Immediate lock from the super console (a trialing business only).
   * @param {{ businessId: string, now: Date, purgeAfter: Date }} input
   */
  async lockNow(input) {
    return this.lockExpired(input);
  },
  /**
   * Manual conversion to a paid plan: access state active, history converted, retention
   * clock cleared. Legacy businesses (trial_status none) keep their history untouched.
   * @param {{ businessId: string, plan: string, currency: string | null }} input
   */
  async convert({ businessId, plan, currency }) {
    return one(
      `UPDATE businesses SET plan=$2, billing_status='active', billing_currency=$3,
         trial_status = CASE WHEN trial_status='none' THEN 'none' ELSE 'converted' END,
         locked_at=NULL, purge_after=NULL, updated_at=now()
       WHERE id=$1 RETURNING *`,
      [businessId, plan, currency],
    );
  },

  // --- notifications ------------------------------------------------------------------
  /** @param {{ businessId: string, kind: string, destination: string, providerId?: string | null }} input */
  async markNotified({ businessId, kind, destination, providerId = null }) {
    const { rowCount } = await exec(
      `INSERT INTO trial_notifications(business_id,kind,destination,provider_id)
       VALUES($1,$2,$3,$4) ON CONFLICT (business_id, kind) DO NOTHING`,
      [businessId, kind, destination, providerId],
    );
    return rowCount === 1;
  },

  // --- listings (platform context) -------------------------------------------------------
  /** Resolves to `TrialBusinessRow[]`: businesses still in their trial window. */
  async listTrialing() {
    return many(
      `SELECT ${TRIAL_COLUMNS} FROM businesses b
       WHERE b.billing_status='trialing' AND b.trial_status='active' ORDER BY b.trial_ends_at`,
    );
  },
  /** Resolves to `TrialBusinessRow[]`: soft-locked businesses in their retention window. */
  async listLocked() {
    return many(
      `SELECT ${TRIAL_COLUMNS} FROM businesses b
       WHERE b.billing_status='locked' ORDER BY b.purge_after NULLS LAST`,
    );
  },
  /**
   * Resolves to `TrialListingRow[]` for the super console: every business that ever had
   * a trial or a billing state, newest first, with the activation facts the funnel reads.
   * @param {{ limit?: number }} [options]
   */
  async listTrials({ limit = 200 } = {}) {
    return many(
      `SELECT ${TRIAL_COLUMNS},
         (SELECT count(*)::int FROM customers c WHERE c.business_id=b.id AND c.deleted_at IS NULL) AS customers,
         (SELECT m.reached_at FROM owner_progress_milestones m WHERE m.business_id=b.id AND m.key='programa_en_marcha') AS programa_en_marcha_at,
         (SELECT m.reached_at FROM owner_progress_milestones m WHERE m.business_id=b.id AND m.key='primer_cliente') AS primer_cliente_at
       FROM businesses b
       WHERE b.trial_status <> 'none' OR b.billing_status <> 'none'
       ORDER BY b.created_at DESC LIMIT $1`,
      [Math.min(500, Math.max(1, Number(limit) || 200))],
    );
  },
  /**
   * Weekly cohorts by trial start (ISO week, business-agnostic UTC) with activation,
   * conversion, lock and purge-candidate counts, plus the median days to primer_cliente.
   * @param {Date} now
   */
  async weeklySummary(now) {
    const { rows } = await platformQuery(
      `WITH t AS (
         SELECT b.id, b.trial_started_at, b.trial_ends_at, b.trial_status, b.billing_status, b.purge_after,
           (SELECT m.reached_at FROM owner_progress_milestones m WHERE m.business_id=b.id AND m.key='programa_en_marcha') AS marcha_at,
           (SELECT m.reached_at FROM owner_progress_milestones m WHERE m.business_id=b.id AND m.key='primer_cliente') AS cliente_at
         FROM businesses b WHERE b.trial_started_at IS NOT NULL
       )
       SELECT to_char(date_trunc('week', trial_started_at), 'YYYY-MM-DD') AS week,
         count(*)::int AS starts,
         count(*) FILTER (WHERE marcha_at IS NOT NULL AND cliente_at IS NOT NULL
           AND marcha_at < trial_ends_at AND cliente_at < trial_ends_at)::int AS activated,
         count(*) FILTER (WHERE trial_status='converted')::int AS converted,
         count(*) FILTER (WHERE billing_status='locked')::int AS locked,
         count(*) FILTER (WHERE billing_status='locked' AND purge_after <= $1::timestamptz)::int AS purge_candidates,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (cliente_at - trial_started_at))/86400)
           FILTER (WHERE cliente_at IS NOT NULL) AS median_days_to_primer_cliente
       FROM t GROUP BY 1 ORDER BY 1 DESC LIMIT 26`,
      [now],
    );
    return rows.map((/** @type {Record<string, unknown>} */ row) => ({
      week: String(row.week),
      starts: Number(row.starts) || 0,
      activated: Number(row.activated) || 0,
      converted: Number(row.converted) || 0,
      locked: Number(row.locked) || 0,
      purge_candidates: Number(row.purge_candidates) || 0,
      median_days_to_primer_cliente:
        row.median_days_to_primer_cliente == null
          ? null
          : Math.round(Number(row.median_days_to_primer_cliente) * 10) / 10,
    }));
  },
  /**
   * Locked businesses past their retention date with the rows a purge would cascade
   * through. Dry run only in wave 1: nothing is deleted.
   * @param {Date} now
   * @returns {Promise<PurgeCandidate[]>}
   */
  async purgeCandidates(now) {
    const counts = PURGE_COUNT_TABLES.map(
      (table) => `(SELECT count(*)::int FROM ${table} x WHERE x.business_id=b.id) AS "${table}"`,
    ).join(",\n         ");
    const { rows } = await platformQuery(
      `SELECT b.id, b.name, b.slug, b.purge_after, b.locked_at,
         ${counts}
       FROM businesses b WHERE b.billing_status='locked' AND b.purge_after IS NOT NULL AND b.purge_after <= $1::timestamptz
       ORDER BY b.purge_after`,
      [now],
    );
    return rows.map((/** @type {Record<string, unknown>} */ row) => ({
      business_id: String(row.id),
      name: String(row.name),
      slug: String(row.slug),
      purge_after: /** @type {Date} */ (row.purge_after),
      locked_at: /** @type {Date | null} */ (row.locked_at ?? null),
      counts: Object.fromEntries(PURGE_COUNT_TABLES.map((t) => [t, Number(row[t]) || 0])),
    }));
  },

  // --- manual billing (platform context writes; the owner reads through tenant RLS) -----
  /** @param {{ businessId: string, email: string }} input */
  async upsertManualCustomer({ businessId, email }) {
    await exec(
      `INSERT INTO billing_customers(business_id,provider,provider_customer_id,email)
       VALUES($1,'manual',$2,$3)
       ON CONFLICT (business_id, provider) DO UPDATE SET email=EXCLUDED.email`,
      [businessId, String(businessId), email],
    );
  },
  /**
   * Closes any open subscription and records the manual one. Resolves to `BillingSubscriptionRow`.
   * @param {{
   *   id: string, businessId: string, plan: string, quantity: number, currency: string,
   *   unitAmountMinor: number, now: Date, metadata: Record<string, unknown>
   * }} input
   */
  async replaceManualSubscription({
    id,
    businessId,
    plan,
    quantity,
    currency,
    unitAmountMinor,
    now,
    metadata,
  }) {
    await exec(
      `UPDATE billing_subscriptions SET status='canceled', canceled_at=$2, updated_at=now()
       WHERE business_id=$1 AND status IN ('active','past_due','paused')`,
      [businessId, now],
    );
    return one(
      `INSERT INTO billing_subscriptions(id,business_id,provider,provider_subscription_id,plan,quantity,currency,
         unit_amount_minor,status,current_period_start,metadata)
       VALUES($1,$2,'manual',$3,$4,$5,$6,$7,'active',$8,$9) RETURNING *`,
      [id, businessId, `manual:${id}`, plan, quantity, currency, unitAmountMinor, now, metadata],
    );
  },
  /**
   * The business's open subscription, if any. Resolves to `BillingSubscriptionRow | null`.
   * @param {string} businessId
   */
  async activeSubscription(businessId) {
    return one(
      `SELECT * FROM billing_subscriptions WHERE business_id=$1 AND status IN ('active','past_due','paused')
       ORDER BY created_at DESC LIMIT 1`,
      [businessId],
    );
  },
  /**
   * Whether a billing event of this type was already recorded for the business (used to
   * emit purge-candidate facts once rather than every day).
   * @param {string} businessId
   * @param {string} eventType
   */
  async hasBillingEvent(businessId, eventType) {
    const row = await one(
      "SELECT 1 FROM billing_events WHERE business_id=$1 AND event_type=$2 LIMIT 1",
      [businessId, eventType],
    );
    return Boolean(row);
  },
};
