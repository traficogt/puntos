// The owner-facing trial/billing payload shared by GET /api/admin/trial and the additive
// fields of GET /api/admin/plan (design section 7.3). Pure: callers load the rows.
import { PLAN_DISPLAY_NAMES } from "./public-plan-service.js";
import { regionTimezone } from "./regional-settings.js";
import { formatTrialDate, trialState, TRIAL_COPY, TRIAL_UPGRADE_URL } from "./trial-state.js";
import { normalizePlan, isPlanName } from "../../utils/plan.js";

/** @typedef {import("../repositories/business-repository.js").BusinessRow} BusinessRow */
/** @typedef {import("../repositories/trial-repository.js").BillingSubscriptionRow} BillingSubscriptionRow */

/** @param {unknown} plan */
export function planDisplayName(plan) {
  const key = normalizePlan(plan);
  return isPlanName(key) ? PLAN_DISPLAY_NAMES[key] : String(plan ?? "");
}

/** @param {Date | string | null | undefined} value */
const iso = (value) => (value ? new Date(value).toISOString() : null);

/**
 * @param {Pick<BusinessRow, "plan" | "program_json" | "billing_currency"> & import("./trial-state.js").TrialColumns} business
 * @param {{ subscription?: BillingSubscriptionRow | null, now?: Date }} [options]
 */
export function ownerTrialPayload(business, { subscription = null, now = new Date() } = {}) {
  const timezone = regionTimezone(business);
  const state = trialState(business, { now, timezone });
  const daysLeft = state.days_left ?? 0;
  return {
    trial: {
      status: state.status,
      days_left: state.days_left,
      started_at: state.started_at,
      ends_at: state.ends_at,
      ends_on: state.ends_at ? formatTrialDate(state.ends_at, timezone) : null,
      locked_at: state.locked_at,
      purge_after: state.purge_after,
      purge_on: state.purge_after ? formatTrialDate(state.purge_after, timezone) : null,
      plan: business.plan,
      plan_name: planDisplayName(business.plan),
      upgrade_url: TRIAL_UPGRADE_URL,
      // Online checkout arrives with the billing adapter (wave 2); until then the owner app
      // shows the contact path behind "Elegir plan".
      upgrade_available: false,
      copy: {
        banner: TRIAL_COPY.banner(daysLeft),
        banner_cta: TRIAL_COPY.banner_cta,
        locked_title: TRIAL_COPY.locked_title,
        locked_body: TRIAL_COPY.locked_body,
        locked_still_works: TRIAL_COPY.locked_still_works,
        retention: TRIAL_COPY.retention(
          state.purge_after ? formatTrialDate(state.purge_after, timezone) : "",
        ),
        upgrade_pending: TRIAL_COPY.upgrade_pending,
      },
    },
    billing: {
      status: state.billing_status,
      currency: business.billing_currency ?? null,
      provider: subscription?.provider ?? null,
      subscription: subscription
        ? {
            plan: subscription.plan,
            quantity: Number(subscription.quantity),
            currency: subscription.currency,
            unit_amount_minor: Number(subscription.unit_amount_minor),
            status: subscription.status,
            current_period_end: iso(subscription.current_period_end),
            cancel_at: iso(subscription.cancel_at),
          }
        : null,
      purge_after: state.purge_after,
    },
  };
}
