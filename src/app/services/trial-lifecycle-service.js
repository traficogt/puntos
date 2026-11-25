// Daily trial step (design section 4.2), run by the worker after lifecycle.daily:
// reminders at day 10 and 13, the soft lock at day 14, the last call 7 days before the
// retention date, and a DRY-RUN purge report at day 44. Nothing is deleted in wave 1
// (the cascade audit is a prerequisite, section 3.6). Every email is idempotent per
// business and kind through trial_notifications, written only on relay acceptance.
import { config } from "../../config/index.js";
import { dbQuery, withDbClientContext } from "../database.js";
import { TrialRepo } from "../repositories/trial-repository.js";
import { emitBillingEvent } from "./billing-service.js";
import { loadOwnerProgressFacts } from "./owner-progress-service.js";
import { PlanConfigService } from "./plan-config-service.js";
import { regionTimezone } from "./regional-settings.js";
import { planDisplayName } from "./trial-entitlement.js";
import { sendTrialEmail, trialEmailReady } from "./trial-email-service.js";
import { countTrialTransition } from "./trial-metrics.js";
import {
  trialState,
  TRIAL_PURGE_WARNING_DAYS,
  TRIAL_REMINDER_DAYS,
  DEFAULT_TRIAL_TIMEZONE,
} from "./trial-state.js";
import { isPlanName, normalizePlan, PLAN_PRICING_USD } from "../../utils/plan.js";
import { errorMessage } from "../../utils/error-shape.js";
import { logger } from "../../utils/logger.js";

const DAY_MS = 86_400_000;

/** @typedef {import("../repositories/trial-repository.js").TrialBusinessRow} TrialBusinessRow */
/** @typedef {import("../repositories/trial-repository.js").PurgeCandidate} PurgeCandidate */
/** @typedef {import("./trial-email-service.js").TrialEmailKind} TrialEmailKind */
/** @typedef {import("./trial-email-service.js").TrialEmailContext} TrialEmailContext */
/**
 * Collaborators; unit tests inject fakes, so only the members used here are typed.
 * @typedef {{
 *   repo: Pick<typeof TrialRepo,
 *     "listTrialing" | "listLocked" | "lockExpired" | "markNotified" | "purgeCandidates" | "hasBillingEvent">,
 *   platform: <T>(fn: () => Promise<T>) => Promise<T>,
 *   tenant: <T>(businessId: string, fn: () => Promise<T>) => Promise<T>,
 *   query: import("../../types/db.js").DbQueryFnLike,
 *   loadFacts: (query: import("../../types/db.js").DbQueryFnLike, businessId: string, timezone: string)
 *     => Promise<{ active_customers: number, genuine_awards: number, genuine_redemptions: number }>,
 *   sendEmail: typeof sendTrialEmail,
 *   emailReady: () => boolean,
 *   emitBillingEvent: typeof emitBillingEvent,
 *   countTransition: typeof countTrialTransition,
 *   getBillingCatalog: () => Promise<{ usd: Record<string, number> }>,
 *   config: Pick<import("../../types/config.js").AppConfig, "APP_ORIGIN" | "TRIAL_RETENTION_DAYS">,
 *   log: { warn: (ctx: object, msg: string) => void, info: (ctx: object, msg: string) => void }
 * }} TrialLifecycleDeps
 */
/**
 * @typedef {{
 *   reminders: { day10: number, day13: number },
 *   locked: number,
 *   purge7: number,
 *   emails_skipped: number,
 *   purge_candidates: PurgeCandidate[],
 *   purge_mode: "dry_run"
 * }} TrialDailySummary
 */

/** @type {TrialLifecycleDeps} */
const defaults = {
  repo: TrialRepo,
  platform: (fn) => withDbClientContext({ platformAdmin: true, tenantId: null }, fn),
  tenant: (businessId, fn) =>
    withDbClientContext({ tenantId: businessId, platformAdmin: false }, fn),
  query: dbQuery,
  loadFacts: loadOwnerProgressFacts,
  sendEmail: sendTrialEmail,
  emailReady: trialEmailReady,
  emitBillingEvent,
  countTransition: countTrialTransition,
  getBillingCatalog: () => PlanConfigService.getBillingCatalog(),
  config,
  log: logger,
};

/** @param {Date | string | null | undefined} value */
const iso = (value) => (value ? new Date(value).toISOString() : null);

/**
 * @param {{ now?: Date }} [options]
 * @param {Partial<TrialLifecycleDeps>} [injected]
 * @returns {Promise<TrialDailySummary>}
 */
export async function runTrialDailyOnce({ now = new Date() } = {}, injected = {}) {
  /** @type {TrialLifecycleDeps} */
  const deps = { ...defaults, ...injected };
  /** @type {TrialDailySummary} */
  const summary = {
    reminders: { day10: 0, day13: 0 },
    locked: 0,
    purge7: 0,
    emails_skipped: 0,
    purge_candidates: [],
    purge_mode: "dry_run",
  };
  const origin = String(deps.config.APP_ORIGIN).replace(/\/+$/, "");
  const catalog = await deps.getBillingCatalog().catch(() => ({ usd: { ...PLAN_PRICING_USD } }));

  /**
   * @param {TrialBusinessRow} business
   * @param {string} timezone
   * @returns {TrialEmailContext}
   */
  function contextFor(business, timezone) {
    const plan = normalizePlan(business.plan);
    return {
      businessName: business.name,
      panelUrl: `${origin}/negocio/`,
      joinUrl: `${origin}/registro/${business.slug}`,
      planUrl: `${origin}/negocio/#plan`,
      exportUrl: `${origin}/negocio/#clientes`,
      endsAt: business.trial_ends_at,
      purgeAfter: business.purge_after,
      timezone,
      planName: planDisplayName(business.plan),
      priceUsd: isPlanName(plan) ? catalog.usd[plan] : PLAN_PRICING_USD.EMPRENDEDOR,
      progress: null,
    };
  }

  /**
   * Sends one reminder and records it; resolves to true when the marker was written.
   * @param {TrialBusinessRow} business
   * @param {TrialEmailKind} kind
   * @param {TrialEmailContext} context
   */
  async function notify(business, kind, context) {
    if (!deps.emailReady()) {
      summary.emails_skipped += 1;
      return false;
    }
    const outcome = await deps.sendEmail({ to: business.email, kind, context });
    if (!outcome.ok) {
      deps.log.warn(
        { businessId: business.id, kind, error: outcome.error ?? null },
        "Trial email not accepted; it retries on the next run",
      );
      return false;
    }
    return deps.tenant(business.id, async () => {
      const marked = await deps.repo.markNotified({
        businessId: business.id,
        kind,
        destination: business.email,
        providerId: outcome.providerId ?? null,
      });
      if (marked)
        await deps.emitBillingEvent({
          businessId: business.id,
          eventType: "trial.reminder_sent",
          metadata: { kind },
        });
      return marked;
    });
  }

  const trialing = await deps.platform(() => deps.repo.listTrialing());
  for (const business of trialing) {
    const timezone = regionTimezone(business) || DEFAULT_TRIAL_TIMEZONE;
    const sent = new Set(business.kinds_sent ?? []);
    const state = trialState(business, { now, timezone });
    try {
      if (state.locked) {
        const purgeAfter = new Date(now.getTime() + deps.config.TRIAL_RETENTION_DAYS * DAY_MS);
        const lockedId = await deps.platform(() =>
          deps.repo.lockExpired({ businessId: business.id, now, purgeAfter }),
        );
        if (lockedId) {
          summary.locked += 1;
          deps.countTransition("locked");
          await deps.tenant(business.id, () =>
            deps.emitBillingEvent({
              businessId: business.id,
              eventType: "trial.locked",
              metadata: {
                trial_ends_at: iso(business.trial_ends_at),
                purge_after: purgeAfter.toISOString(),
              },
            }),
          );
        }
        if (!sent.has("locked"))
          await notify(business, "locked", {
            ...contextFor(business, timezone),
            purgeAfter: business.purge_after ?? purgeAfter,
          });
        continue;
      }
      const daysLeft = state.days_left ?? Number.POSITIVE_INFINITY;
      if (daysLeft <= TRIAL_REMINDER_DAYS.day13) {
        if (!sent.has("day13") && (await notify(business, "day13", contextFor(business, timezone))))
          summary.reminders.day13 += 1;
      } else if (daysLeft <= TRIAL_REMINDER_DAYS.day10 && !sent.has("day10")) {
        const progress = await deps
          .tenant(business.id, () => deps.loadFacts(deps.query, business.id, timezone))
          .catch(() => null);
        const facts = progress
          ? {
              active_customers: progress.active_customers,
              genuine_awards: progress.genuine_awards,
              genuine_redemptions: progress.genuine_redemptions,
            }
          : null;
        if (await notify(business, "day10", { ...contextFor(business, timezone), progress: facts }))
          summary.reminders.day10 += 1;
      }
    } catch (error) {
      deps.log.warn(
        { businessId: business.id, err: errorMessage(error) },
        "Trial daily step did not complete for a business",
      );
    }
  }

  const locked = await deps.platform(() => deps.repo.listLocked());
  for (const business of locked) {
    const sent = new Set(business.kinds_sent ?? []);
    const purgeAfter = business.purge_after ? new Date(business.purge_after) : null;
    if (!purgeAfter || sent.has("purge7")) continue;
    if (purgeAfter.getTime() - now.getTime() > TRIAL_PURGE_WARNING_DAYS * DAY_MS) continue;
    try {
      const timezone = regionTimezone(business) || DEFAULT_TRIAL_TIMEZONE;
      if (await notify(business, "purge7", contextFor(business, timezone))) summary.purge7 += 1;
    } catch (error) {
      deps.log.warn(
        { businessId: business.id, err: errorMessage(error) },
        "Trial purge warning did not complete for a business",
      );
    }
  }

  summary.purge_candidates = await purgeDryRun({ now }, deps);
  deps.log.info(
    {
      reminders: summary.reminders,
      locked: summary.locked,
      purge7: summary.purge7,
      emails_skipped: summary.emails_skipped,
      purge_candidates: summary.purge_candidates.length,
      purge_mode: summary.purge_mode,
    },
    "Trial daily step completed",
  );
  return summary;
}

/**
 * Lists the locked businesses past their retention date with the rows a purge would
 * remove, records the fact once per business (billing_events `trial.purge_candidate`)
 * and logs the report. Deletion is intentionally not implemented in wave 1.
 * @param {{ now?: Date }} [options]
 * @param {Partial<TrialLifecycleDeps>} [injected]
 */
export async function purgeDryRun({ now = new Date() } = {}, injected = {}) {
  /** @type {TrialLifecycleDeps} */
  const deps = { ...defaults, ...injected };
  const candidates = await deps.platform(() => deps.repo.purgeCandidates(now));
  for (const candidate of candidates) {
    try {
      const recorded = await deps.tenant(candidate.business_id, () =>
        deps.repo.hasBillingEvent(candidate.business_id, "trial.purge_candidate"),
      );
      if (recorded) continue;
      await deps.tenant(candidate.business_id, () =>
        deps.emitBillingEvent({
          businessId: candidate.business_id,
          eventType: "trial.purge_candidate",
          metadata: { purge_after: iso(candidate.purge_after), counts: candidate.counts },
        }),
      );
      deps.countTransition("purge_candidate");
    } catch (error) {
      deps.log.warn(
        { businessId: candidate.business_id, err: errorMessage(error) },
        "Purge candidate fact was not recorded",
      );
    }
  }
  if (candidates.length)
    deps.log.warn(
      {
        mode: "dry_run",
        candidates: candidates.map((c) => ({
          business_id: c.business_id,
          slug: c.slug,
          purge_after: iso(c.purge_after),
          counts: c.counts,
        })),
      },
      "trial.purge dry run: businesses past retention; deletion is disabled in wave 1",
    );
  return candidates;
}
