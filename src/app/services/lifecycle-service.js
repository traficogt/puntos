import crypto from "node:crypto";
import { runAutomationRule, runGuidedAutomationsOnce } from "./automation-controls-service.js";
import { processAutomationMessagesOnce } from "./automation-message-service.js";
import { processCampaignMessagesOnce } from "./campaign-message-service.js";
import { logger } from "../../utils/logger.js";
import { dbQuery, withTransaction, withDbClientContext } from "../database.js";
import { BusinessRepo } from "../repositories/business-repository.js";
import { sendMessage } from "./messaging-service.js";
import { TierService } from "./tier-service.js";
import { expirePointsForBusiness } from "./loyalty-ops-service.js";

function id() { return crypto.randomUUID(); }

async function recordLifecycleEvent(client, { businessId, customerId, eventType, eventDate, meta = {} }) {
  const out = await client.query(
    `INSERT INTO lifecycle_events (id, business_id, customer_id, event_type, event_date, meta)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (business_id, customer_id, event_type, event_date) DO NOTHING
     RETURNING id`,
    [id(), businessId, customerId, eventType, eventDate, meta]
  );
  return out.rowCount === 1;
}

// Legacy job entry points now use the same durable, budgeted rules as the owner screen.
export async function processBirthdayBusiness(businessId) {
  return runAutomationRule({businessId,rule:'birthday'});
}
export async function processWinbackBusiness(businessId) {
  return runAutomationRule({businessId,rule:'winback'});
}

async function processSuspiciousDigestBusiness(business, cfg) {
  if (!cfg?.suspicious_digest_enabled) return { sent: false, count: 0 };
  const minCount = Math.max(1, Number(cfg.suspicious_digest_min_count ?? 1));
  const today = new Date().toISOString().slice(0, 10);

  const { rows } = await dbQuery(
    `SELECT
       t.id,
       t.created_at,
       t.points,
       t.amount_q,
       su.name AS staff_name,
       su.email AS staff_email,
       c.phone AS customer_phone
     FROM transactions t
     LEFT JOIN staff_users su ON su.id = t.staff_user_id
     LEFT JOIN customers c ON c.id = t.customer_id
     WHERE t.business_id = $1
       AND COALESCE((t.meta->'guard'->>'suspicious')::boolean, false) = true
       AND t.created_at >= now() - interval '1 day'
     ORDER BY t.created_at DESC
     LIMIT 20`,
    [business.id]
  );

  if (rows.length < minCount) return { sent: false, count: rows.length };
  if (!business.email) return { sent: false, count: rows.length, reason: "no_business_email" };

  const { rows: anyCustomer } = await dbQuery(
    `SELECT id FROM customers WHERE business_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1`,
    [business.id]
  );
  if (!anyCustomer[0]) return { sent: false, count: rows.length, reason: "no_customer_for_dedupe" };

  const dedupe = await withTransaction(async (client) => {
    return recordLifecycleEvent(client, {
      businessId: business.id,
      customerId: anyCustomer[0].id,
      eventType: "suspicious_digest",
      eventDate: today,
      meta: { count: rows.length }
    });
  });
  if (!dedupe) return { sent: false, count: rows.length, reason: "already_sent_today" };

  const lines = rows.slice(0, 10).map((r) => {
    const when = new Date(r.created_at).toLocaleString();
    const who = r.staff_name || r.staff_email || "staff";
    return `${when} | ${who} | +${Number(r.points || 0)} pts | Q${Number(r.amount_q || 0).toFixed(2)} | ${r.customer_phone || "-"}`;
  });

  const result = await sendMessage({
    businessId: business.id,
    customerId: null,
    channel: "alerts",
    to: business.email,
    body: `PuntosFieles alerta diaria\n\nSe detectaron ${rows.length} transacciones sospechosas en las ultimas 24h.\n\n${lines.join("\n")}`,
    email: {
      type: "lifecycle",
      subject: "PuntosFieles alerta diaria",
      title: "Transacciones sospechosas detectadas",
      intro: `Se detectaron ${rows.length} transacciones sospechosas en las últimas 24 horas.`,
      lines,
      tone: "alert"
    }
  }).catch(() => null);

  return { sent: Boolean(result?.ok && result?.accepted), count: rows.length };
}

const maintenanceDefaults = {
  context: withDbClientContext,
  listBusinessIds: () => BusinessRepo.listAllIds(),
  getBusiness: businessId => BusinessRepo.getById(businessId),
  birthday: processBirthdayBusiness,
  winback: processWinbackBusiness,
  digest: processSuspiciousDigestBusiness,
  retention: (businessId, policy) => TierService.runTierRetentionSweep(businessId, policy),
  expiration: expirePointsForBusiness,
  log: logger
};

export async function runLifecycleOnce({ businessId = null } = {}, injected = {}) {
  const deps = { ...maintenanceDefaults, ...injected };
  const businessIds = businessId
    ? [businessId]
    : await deps.context({ platformAdmin: true, tenantId: null }, deps.listBusinessIds);
  const out = [];
  async function step(stage, fn) {
    try { return await fn(); }
    catch {
      // Provider/SQL exception text may contain customer data. Keep logs and
      // persisted job results bounded to the maintenance stage that failed.
      deps.log.warn({ stage }, 'Lifecycle maintenance step did not complete');
      return { error: 'LIFECYCLE_STEP_FAILED' };
    }
  }
  for (const bid of businessIds) {
    try {
      const entry = await deps.context({ tenantId: bid, platformAdmin: false }, async () => {
        const business = await deps.getBusiness(bid);
        if (!business) return null;
        const lifecycleCfg = business.program_json?.lifecycle ?? {};
        const tierPolicy = business.program_json?.tier_policy ?? {};
        // Each incentive checks its own saved schedule. Daily maintenance must
        // also run when the owner chooses another incentive preparation hour.
        const birthday = await step('birthday', () => deps.birthday(bid));
        const winback = await step('winback', () => deps.winback(bid));
        const suspiciousDigest = await step('suspicious_digest', () => deps.digest(business, lifecycleCfg));
        const tierRetention = await step('tier_retention', () => deps.retention(bid, tierPolicy));
        const expiration = await step('points_expiration', () => deps.expiration(bid));
        return { businessId: bid, birthday, winback, suspiciousDigest, tierRetention, expiration };
      });
      if (entry) out.push(entry);
    } catch {
      deps.log.warn({ stage: 'business_context' }, 'Lifecycle business maintenance did not complete');
      out.push({ businessId: bid, error: 'LIFECYCLE_BUSINESS_FAILED' });
    }
  }
  return out;
}

// Both API-hosted workers and the standalone worker use this same tick. A
// failed stage cannot strand already queued messages in either outbox. Durable
// event/claim keys handle duplication across processes; this guard also avoids
// overlapping timer callbacks within one process.
/**
 * @param {{generate?: () => Promise<unknown>, dispatchAutomations?: () => Promise<unknown>, dispatchCampaigns?: () => Promise<unknown>, log?: {warn: (...args: any[]) => unknown}}} [dependencies]
 */
export function createMarketingTick({
  generate = runGuidedAutomationsOnce,
  dispatchAutomations = processAutomationMessagesOnce,
  dispatchCampaigns = processCampaignMessagesOnce,
  log = logger
} = {}) {
  let running = false;
  return async function marketingTick() {
    if (running) return { skipped: true };
    running = true;
    try {
      for (const {stage, run} of [
        {stage: 'generation', run: generate},
        {stage: 'automation_dispatch', run: dispatchAutomations},
        {stage: 'campaign_dispatch', run: dispatchCampaigns}
      ]) {
        try { await run(); }
        catch { log.warn({ stage }, 'Marketing worker stage did not complete'); }
      }
      return { skipped: false };
    } finally { running = false; }
  };
}
