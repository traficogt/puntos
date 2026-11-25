// Soft lock after the trial (design section 4.3): a trialing business past
// `trial_ends_at` (or already marked locked by the daily job) keeps every read but loses
// every owner and staff mutation, including awards and redemptions. Converted/paid
// businesses and legacy businesses (billing_status 'none') are never restricted.
import { BusinessRepo } from "../app/repositories/business-repository.js";
import { regionTimezone } from "../app/services/regional-settings.js";
import { trialState, TRIAL_COPY, TRIAL_UPGRADE_URL } from "../app/services/trial-state.js";
import { errorMessage } from "../utils/error-shape.js";
import { logger } from "../utils/logger.js";

/** @typedef {import("express").Request} Request */
/** @typedef {import("express").Response} Response */
/** @typedef {import("express").NextFunction} NextFunction */
/** @typedef {import("../types/auth.js").AnnotatedRequestHandler} AnnotatedRequestHandler */
/** @typedef {import("../app/repositories/business-repository.js").BusinessRow} BusinessRow */

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Paths (relative to the /api or /api/v1 mount) that stay writable while locked: session
 * and security routes so the owner can still sign in and out, the trial/billing surface
 * itself (the upgrade path), support and public endpoints.
 */
export const TRIAL_LOCK_EXEMPT_PATTERNS = Object.freeze([
  /^\/staff\/login$/,
  /^\/staff\/logout$/,
  /^\/staff\/me$/,
  /^\/staff\/permissions$/,
  /^\/staff\/security\//,
  /^\/admin\/signup$/,
  /^\/admin\/trial(?:\/|$)/,
  /^\/admin\/billing\//,
  /^\/public\//,
  /^\/support\//,
]);

/**
 * The route path relative to the API mount, without query string or version prefix.
 * @param {Pick<Request, "originalUrl" | "url">} req
 */
export function apiPathOf(req) {
  const raw = String(req.originalUrl || req.url || "").split("?")[0];
  return raw.replace(/^\/api(?:\/v1)?(?=\/|$)/, "") || "/";
}

/**
 * Whether the lock applies to this request: a mutating method on a non-exempt path.
 * @param {string} method
 * @param {string} pathname as apiPathOf returns it
 */
export function trialLockApplies(method, pathname) {
  if (!MUTATING.has(String(method).toUpperCase())) return false;
  return !TRIAL_LOCK_EXEMPT_PATTERNS.some((pattern) => pattern.test(pathname));
}

/**
 * The 402 body a locked business receives. Owners get the upgrade call to action; other
 * staff roles are told the program is paused and who can fix it.
 * @param {import("../app/services/trial-state.js").TrialState} state
 * @param {string | null | undefined} role
 */
export function trialLockedBody(state, role) {
  return {
    error: role === "OWNER" ? TRIAL_COPY.locked_error_owner : TRIAL_COPY.locked_error_staff,
    code: "TRIAL_LOCKED",
    trial_status: "locked",
    trial_ends_at: state.ends_at,
    purge_after: state.purge_after,
    upgrade_url: TRIAL_UPGRADE_URL,
  };
}

/**
 * The authenticated actor's business, loaded once per request (same cache as
 * requirePlanFeature).
 * @param {Request} req
 * @param {(id: string) => Promise<BusinessRow | null>} getBusiness
 */
async function resolveBusiness(req, getBusiness) {
  const businessId = req.staff?.business_id || req.customerAuth?.business_id;
  if (!businessId) return null;
  if (req._resolvedBusiness && req._resolvedBusiness.id === businessId)
    return req._resolvedBusiness;
  const business = await getBusiness(businessId);
  req._resolvedBusiness = business;
  return business;
}

/**
 * Collaborators the lock check reads; tests inject fakes.
 * @typedef {{
 *   getBusiness?: (id: string) => Promise<BusinessRow | null>,
 *   now?: () => Date,
 *   log?: { warn: (ctx: object, msg: string) => void }
 * }} TrialLockDeps
 */

/**
 * Answers 402 TRIAL_LOCKED and resolves to true when the request must stop; resolves to
 * false when the request may proceed. Reads nothing for non-mutating or exempt requests.
 * The check narrows writes and is advisory about infrastructure: when the business row
 * cannot be read the request proceeds (its own database work fails the same way) and the
 * skip is logged, so an outage never turns into a lock or a 500 of its own.
 * @param {Request} req
 * @param {Response} res
 * @param {TrialLockDeps} [deps]
 */
export async function enforceTrialLock(req, res, deps = {}) {
  if (!trialLockApplies(req.method, apiPathOf(req))) return false;
  /** @type {BusinessRow | null} */
  let business;
  try {
    business = await resolveBusiness(req, deps.getBusiness ?? ((id) => BusinessRepo.getById(id)));
  } catch (error) {
    (deps.log ?? logger).warn(
      { err: errorMessage(error), businessId: req.staff?.business_id ?? null },
      "Trial lock check skipped: business row could not be read",
    );
    return false;
  }
  if (!business) return false;
  const state = trialState(business, {
    now: deps.now ? deps.now() : new Date(),
    timezone: regionTimezone(business),
  });
  if (!state.locked) return false;
  res.status(402).json(trialLockedBody(state, req.staff?.role));
  return true;
}

/**
 * Standalone middleware form of the lock, for routes that run outside `requireStaff`
 * (which already enforces it) or for tests. Mount after the authentication middleware.
 * @param {TrialLockDeps} [deps]
 */
export function requireActiveBilling(deps = {}) {
  /** @type {AnnotatedRequestHandler} */
  const middleware = async (req, res, next) => {
    try {
      if (await enforceTrialLock(req, res, deps)) return;
      return next();
    } catch (error) {
      return next(error);
    }
  };
  middleware.__openapi = { auth: "staff" };
  return middleware;
}
