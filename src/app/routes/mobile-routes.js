import { Router } from "express";
import { z } from "zod";
import { asyncRoute } from "../../middleware/common.js";
import { setTenantForRequest } from "../../middleware/tenant.js";
import {
  moderateRateLimit,
  rateLimitByIp,
  rateLimitByPhone,
  strictRateLimit,
} from "../../middleware/rate-limit.js";
import { validate } from "../../utils/validation.js";
import {
  businessCustomerBrandingSchema,
  requestJoinCodeSchema,
  verifyJoinCodeSchema,
} from "../../utils/schemas.js";
import { normalizePhone } from "../../utils/phone.js";
import { sanitizeProgramForClient } from "../../utils/program-secrets.js";
import { planFeaturesWithOverrides } from "../../utils/plan.js";
import { badRequest, notFound } from "../../utils/http-error.js";
import { logger } from "../../utils/logger.js";
import { getDbClient, withTransaction } from "../database.js";
import { BusinessRepo } from "../repositories/business-repository.js";
import { CustomerRepo } from "../repositories/customer-repository.js";
import { TxnRepo } from "../repositories/transaction-repository.js";
import { getCustomerRewardProgress } from "../services/customer-reward-progress.js";
import { memberDiscount } from "../services/discount-model.js";
import { stampCard } from "../services/stamp-model.js";
import { cashbackTerms } from "../services/cashback-model.js";
import { walletProgram } from "../services/wallet-model.js";
import { getCashbackBalance, listStoredValueHistory } from "../services/cashback-service.js";
import {
  GiftCardTransferSchema,
  transferGiftCardForCustomer,
} from "../services/gift-card-program-service.js";
import { TierService } from "../services/tier-service.js";
import { ReferralService } from "../services/referral-service.js";
import { RedemptionRepo } from "../repositories/redemption-repository.js";
import { requestJoinCode, verifyJoinCode, issueCustomerQr } from "../services/customer-service.js";
import {
  browserSessionStatus,
  getBrowserSession,
  touchBrowserSessionIfNeeded,
  invalidateBrowserSessionById,
  invalidateBrowserSessionsForActor,
} from "../services/auth-session-service.js";
import { PlanConfigService } from "../services/plan-config-service.js";
import {
  settlePendingPointsForCustomer,
  expirePointsForCustomer,
} from "../services/loyalty-ops-service.js";
import { nativeWalletService } from "../services/native-wallet/runtime.js";
import { mobilePushService } from "../services/mobile-push/runtime.js";
import { mobileAccessService } from "../services/mobile-access-service.js";

/** @typedef {import("./_request-types.js").Request} Request */
/** @typedef {import("./_request-types.js").Response} Response */
/** @typedef {import("./_request-types.js").NextFunction} NextFunction */
/**
 * @template P
 * @typedef {import("./_request-types.js").ParamsRequest<P>} ParamsRequest
 */
/** @typedef {import("./_request-types.js").WithAuthSession} WithAuthSession */
/** @typedef {import("../repositories/auth-session-repository.js").AuthSessionRow} AuthSessionRow */
/**
 * Request past `requireMobileCustomer`: the bearer session and `customerAuth` are set.
 * `P` narrows `req.params` where a handler reads one (see `_request-types.js`).
 * @template [P=import("./_request-types.js").ParamsDictionary]
 * @typedef {ParamsRequest<P> & { authSession: AuthSessionRow }} MobileCustomerRequest
 */
/** @typedef {Promise<Response | void>} HandlerResult early `return res...` or fall-through */
/**
 * One reward choice from the customer reward-progress service (shape owned there);
 * only the fields this module reads are named.
 * @typedef {Record<string, unknown> & {
 *   active?: boolean,
 *   available?: boolean,
 *   valid_until?: string | Date | null
 * }} RewardChoice
 */

const defaults = {
  BusinessRepo,
  CustomerRepo,
  TxnRepo,
  RedemptionRepo,
  PlanConfigService,
  getDbClient,
  getCustomerRewardProgress,
  setTenantForRequest,
  requestJoinCode,
  verifyJoinCode,
  issueCustomerQr,
  getBrowserSession,
  touchBrowserSessionIfNeeded,
  invalidateBrowserSessionById,
  invalidateBrowserSessionsForActor,
  settlePendingPointsForCustomer,
  expirePointsForCustomer,
  withTransaction,
  getCashbackBalance,
  listStoredValueHistory,
  transferGiftCard: transferGiftCardForCustomer,
  getCustomerTierInfo: TierService.getCustomerTierInfo,
  getCustomerReferralStats: ReferralService.getCustomerReferralStats,
  walletService: nativeWalletService,
  pushService: mobilePushService,
  accessService: mobileAccessService,
  accessRequestLimit: rateLimitByIp(5, 15 * 60 * 1000, { keyPrefix: "ip:mobile-access-request:" }),
  accessVerifyLimit: rateLimitByIp(60, 60000, { keyPrefix: "ip:mobile-access-verify:" }),
  accessSelectLimit: rateLimitByIp(30, 60000, { keyPrefix: "ip:mobile-access-select:" }),
  accessRequestPhoneLimit: rateLimitByPhone(5, 60 * 60 * 1000, {
    keyPrefix: "phone:mobile-access-request:",
  }),
  accessVerifyPhoneLimit: rateLimitByPhone(10, 10 * 60 * 1000, {
    keyPrefix: "phone:mobile-access-verify:",
  }),
  pushRegisterLimit: rateLimitByIp(20, 60000, { keyPrefix: "ip:push-register:" }),
  pushRevokeLimit: rateLimitByIp(10, 60000, { keyPrefix: "ip:push-revoke:" }),
  pushTestLimit: rateLimitByIp(3, 60000, { keyPrefix: "ip:push-test:" }),
  requestCodeLimit: strictRateLimit,
  verifyCodeLimit: moderateRateLimit,
  requestPhoneLimit: rateLimitByPhone(3, 10 * 60 * 1000),
  verifyPhoneLimit: rateLimitByPhone(10, 10 * 60 * 1000),
  walletIssueLimit: rateLimitByIp(20, 60000, { keyPrefix: "ip:wallet-issue:" }),
  giftTransferLimit: rateLimitByIp(10, 60000, { keyPrefix: "ip:mobile-gift-transfer:" }),
};

const accessPhoneSchema = z
  .string()
  .max(30)
  .regex(/^[+\d\s()-]+$/)
  .transform((value) => normalizePhone(value))
  .refine((phone) => /^\d{8,15}$/.test(phone), "Teléfono inválido");
const accessRequestSchema = z.object({ phone: accessPhoneSchema });
const accessVerifySchema = z.object({
  phone: accessPhoneSchema,
  code: z.string().regex(/^\d{6}$/),
});
const accessSelectSchema = z.object({
  accessToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  businessId: z.guid(),
});
const deleteSchema = z.object({ confirm: z.literal(true) });
const customerFields = ["id", "name", "phone", "points", "pending_points", "lifetime_points"];
const rewardFields = [
  "id",
  "name",
  "description",
  "points_cost",
  "active",
  "stock",
  "valid_until",
  "branch_ids",
  "branch_labels",
];
const transactionFields = ["id", "points_delta", "amount_q", "source", "created_at", "reward_name"];
const redemptionFields = [
  "id",
  "reward_name",
  "points_cost",
  "status",
  "created_at",
  "redeemed_at",
];
/** @param {Record<string, unknown>} record @param {readonly string[]} fields */
const project = (record, fields) => Object.fromEntries(fields.map((key) => [key, record[key]]));
/** @param {Pick<import("../repositories/business-repository.js").BusinessRow, "id" | "name" | "slug">} business */
const businessIdentity = (business) => ({
  id: business.id,
  name: business.name,
  slug: business.slug,
});

/** @param {unknown} value */
function customerBranding(value) {
  const result = businessCustomerBrandingSchema.safeParse(
    value && typeof value === "object" ? value : {},
  );
  return result.success ? result.data : businessCustomerBrandingSchema.parse({});
}

/**
 * The customer's tier as the browser card reads it (`/api/customer/tier`), with
 * pg NUMERIC/COUNT strings turned into numbers. Internal ids and audit columns
 * stay on the server.
 * @param {Record<string, unknown> | null | undefined} tier
 */
function customerTier(tier) {
  if (!tier || typeof tier !== "object") return null;
  /** @param {unknown} value */
  const num = (value) => (value == null || value === "" ? null : Number(value));
  return {
    tier_level: num(tier.tier_level),
    name: tier.name == null ? null : String(tier.name),
    points_multiplier: num(tier.points_multiplier),
    current_points: num(tier.current_points),
    next_tier_name: tier.next_tier_name == null ? null : String(tier.next_tier_name),
    next_tier_points: num(tier.next_tier_points),
    points_to_next_tier: num(tier.points_to_next_tier),
    perks: Array.isArray(tier.perks) ? tier.perks.map((perk) => String(perk)) : [],
    color: typeof tier.color === "string" && /^#[0-9a-f]{6}$/i.test(tier.color) ? tier.color : null,
  };
}

/**
 * Referral code and counters as the browser card reads them
 * (`/api/customer/referral-code`, `/api/customer/referrals`). The per-referral
 * rows, which name other customers, stay on the server.
 * @param {Record<string, unknown> | null | undefined} stats
 */
function customerReferral(stats) {
  if (!stats || typeof stats !== "object") return { referral_code: null, referral_stats: null };
  const code = typeof stats.referral_code === "string" && stats.referral_code;
  return {
    referral_code: code ? { code } : null,
    referral_stats: {
      total_referrals: Number(stats.total_referrals) || 0,
      completed_referrals: Number(stats.completed_referrals) || 0,
      total_points_earned: Number(stats.total_points_earned) || 0,
    },
  };
}

/** @param {Response} res @param {string} [code] */
function rejectAuth(res, code = "AUTH_INVALID_SESSION") {
  return res.status(401).json({ error: "No autenticado", code });
}

/** @param {import("zod").ZodType} schema body schema whose output carries `phone` */
function prepareOtp(schema) {
  /** @param {Request} req @param {Response} res @param {NextFunction} next @returns {Response | void} */
  return (req, res, next) => {
    const result = validate(schema, req.body);
    if (!result.ok) return res.status(400).json({ error: result.error });
    const phone = normalizePhone(result.data.phone);
    if (!phone) return next(badRequest("Falta el teléfono"));
    // Share the existing phone limiter across local and international formats.
    req.body = { ...result.data, phone };
    next();
  };
}

/**
 * Injectable collaborators: any subset of `defaults` (unit tests pass fakes).
 * @typedef {Partial<typeof defaults>} MobileRouteOverrides
 */

/** @param {MobileRouteOverrides} [overrides] */
export function createMobileRoutes(overrides = {}) {
  const deps = { ...defaults, ...overrides };
  const router = Router();
  router.use("/mobile", (_req, res, next) => {
    res.set({ "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" });
    next();
  });

  /** @param {Request & WithAuthSession} req @param {Response} res */
  async function missingCustomer(req, res) {
    if (req.authSession?.id) {
      await deps
        .invalidateBrowserSessionById(req.authSession.id, "customer_missing")
        .catch(() => {});
    }
    return res.status(404).json({ error: "Cliente no encontrado", code: "CUSTOMER_NOT_FOUND" });
  }

  /**
   * @param {import("../repositories/customer-repository.js").CustomerWithBalanceRow | null | undefined} customer
   * @param {{ id: string, business_id: string }} auth
   */
  function matchesCustomer(customer, auth) {
    return Boolean(
      customer &&
      !customer.deleted_at &&
      String(customer.id) === auth.id &&
      String(customer.business_id) === auth.business_id,
    );
  }

  const requireMobileCustomer = asyncRoute(
    /** @param {Request & WithAuthSession} req @param {Response} res @param {NextFunction} next @returns {HandlerResult} */
    async (req, res, next) => {
      const bearer = /^Bearer ([A-Za-z0-9_-]{1,256})$/i.exec(req.get("Authorization") || "");
      if (!bearer) return rejectAuth(res, "AUTH_REQUIRED");
      const session = await deps.getBrowserSession(bearer[1]);
      if (
        !browserSessionStatus(session).ok ||
        session.actor_type !== "CUSTOMER" ||
        !session.id ||
        !session.actor_id ||
        !session.business_id
      ) {
        return rejectAuth(res);
      }
      const auth = { id: String(session.actor_id), business_id: String(session.business_id) };
      // Never use URL, query, body, cookie, or pre-existing request tenant values.
      await deps.setTenantForRequest(req, auth.business_id);
      req.authSession = session;
      req.customerAuth = auth;
      const customer = await deps.CustomerRepo.getById(auth.id);
      if (!matchesCustomer(customer, auth)) return missingCustomer(req, res);
      const touched = await deps.touchBrowserSessionIfNeeded(session).catch(() => session);
      if (!browserSessionStatus(touched).ok) return rejectAuth(res);
      req.authSession = touched;
      next();
    },
  );

  router.post(
    "/mobile/access/request-code",
    deps.accessRequestLimit,
    prepareOtp(accessRequestSchema),
    deps.accessRequestPhoneLimit,
    asyncRoute(
      /** @param {Request} req @param {Response} res */
      async (req, res) => {
        res.json(await deps.accessService.requestCode({ phone: req.body.phone }));
      },
    ),
  );
  router.post(
    "/mobile/access/verify",
    deps.accessVerifyLimit,
    prepareOtp(accessVerifySchema),
    deps.accessVerifyPhoneLimit,
    asyncRoute(
      /** @param {Request} req @param {Response} res */
      async (req, res) => {
        const result = await deps.accessService.verify({
          phone: req.body.phone,
          code: req.body.code,
        });
        if (result?.status === "choose_card") {
          result.cards = result.cards.map(
            (
              /** @type {import("../repositories/mobile-access-repository.js").MobileAccessCardRow} */ {
                customer_branding_json,
                ...card
              },
            ) => ({
              ...card,
              customer_branding: customerBranding(customer_branding_json),
            }),
          );
        }
        res.json(result);
      },
    ),
  );
  router.post(
    "/mobile/access/select",
    deps.accessSelectLimit,
    asyncRoute(
      /** @param {Request} req @param {Response} res @returns {HandlerResult} */
      async (req, res) => {
        const result = validate(accessSelectSchema, req.body);
        if (!result.ok) return res.status(400).json({ error: result.error });
        res.json(await deps.accessService.select(result.data));
      },
    ),
  );

  router.get(
    "/mobile/business/:slug",
    asyncRoute(
      /** @param {ParamsRequest<{ slug: string }>} req @param {Response} res */
      async (req, res) => {
        const business = await deps.BusinessRepo.getPublicBySlug(req.params.slug);
        if (!business) throw notFound("Negocio no encontrado");
        res.json({
          ...businessIdentity(business),
          category: business.category,
          program_type: business.program_type,
          program_json: sanitizeProgramForClient(business.program_json),
          customer_branding: customerBranding(business.customer_branding_json),
        });
      },
    ),
  );

  // Express 5 route strings no longer support inline regular expressions.
  // Keep the same accepted modes and 404 behavior before any OTP side effect.
  router.param("mode", (_req, _res, next, mode) =>
    ["login", "join"].includes(mode) ? next() : next("route"),
  );
  router.param("provider", (_req, _res, next, provider) =>
    ["apple", "google"].includes(provider) ? next() : next("route"),
  );
  const otpPath = "/mobile/business/:slug/:mode";
  router.post(
    `${otpPath}/request-code`,
    deps.requestCodeLimit,
    prepareOtp(requestJoinCodeSchema),
    deps.requestPhoneLimit,
    asyncRoute(
      /** @param {ParamsRequest<{ slug: string, mode: string }>} req @param {Response} res */
      async (req, res) => {
        const business = await deps.BusinessRepo.getPublicBySlug(req.params.slug);
        if (!business) throw notFound("Negocio no encontrado");
        await deps.setTenantForRequest(req, business.id);
        res.json(
          await deps.requestJoinCode({
            business,
            phone: req.body.phone,
            email: req.body.email ?? null,
            name: req.body.name ?? null,
            requireExisting: req.params.mode === "login",
          }),
        );
      },
    ),
  );

  router.post(
    `${otpPath}/verify`,
    deps.verifyCodeLimit,
    prepareOtp(verifyJoinCodeSchema),
    deps.verifyPhoneLimit,
    asyncRoute(
      /** @param {ParamsRequest<{ slug: string, mode: string }>} req @param {Response} res @returns {HandlerResult} */
      async (req, res) => {
        const business = await deps.BusinessRepo.getPublicBySlug(req.params.slug);
        if (!business) throw notFound("Negocio no encontrado");
        await deps.setTenantForRequest(req, business.id);
        const { customer, token } = await deps.verifyJoinCode({
          business,
          phone: req.body.phone,
          code: req.body.code,
          name: req.body.name ?? null,
          referralCode: req.params.mode === "join" ? (req.body.referralCode ?? null) : null,
          requireExisting: req.params.mode === "login",
        });
        const session = await deps.getBrowserSession(token);
        if (
          !browserSessionStatus(session).ok ||
          session.actor_type !== "CUSTOMER" ||
          String(session.actor_id) !== String(customer.id) ||
          String(session.business_id) !== String(business.id) ||
          !matchesCustomer(customer, {
            id: String(session.actor_id),
            business_id: String(business.id),
          })
        ) {
          return rejectAuth(res);
        }
        res.json({
          ok: true,
          token,
          expiresAt: new Date(session.absolute_expires_at).toISOString(),
          customer: project(customer, customerFields),
          business: businessIdentity(business),
        });
      },
    ),
  );

  // This credential grants only revocation, including after bearer expiry.
  router.post(
    "/mobile/customer/push-device/revoke",
    deps.pushRevokeLimit,
    asyncRoute(
      /** @param {Request} req @param {Response} res */
      async (req, res) => {
        res.json(await deps.pushService.revoke(req.body));
      },
    ),
  );

  router.use("/mobile/customer", requireMobileCustomer);
  router.get(
    "/mobile/customer/push-status",
    asyncRoute(
      /** @param {MobileCustomerRequest} _req @param {Response} res */
      async (_req, res) => {
        res.json(deps.pushService.status());
      },
    ),
  );
  router.put(
    "/mobile/customer/push-device",
    deps.pushRegisterLimit,
    asyncRoute(
      /** @param {MobileCustomerRequest} req @param {Response} res */
      async (req, res) => {
        res.json(await deps.pushService.register(req.customerAuth, req.authSession, req.body));
      },
    ),
  );
  router.post(
    "/mobile/customer/push-device/test",
    deps.pushTestLimit,
    asyncRoute(
      /** @param {MobileCustomerRequest} req @param {Response} res */
      async (req, res) => {
        res.json(await deps.pushService.test(req.customerAuth, req.body));
      },
    ),
  );
  router.get(
    "/mobile/customer",
    asyncRoute(
      /** @param {MobileCustomerRequest} req @param {Response} res @returns {HandlerResult} */
      async (req, res) => {
        const auth = req.customerAuth;
        await deps.settlePendingPointsForCustomer(auth.id, auth.business_id).catch((err) => {
          logger.warn(
            { err: err?.message, customerId: auth.id, businessId: auth.business_id },
            "settlePendingPointsForCustomer failed",
          );
        });
        await deps.expirePointsForCustomer(auth.id, auth.business_id).catch((err) => {
          logger.warn(
            { err: err?.message, customerId: auth.id, businessId: auth.business_id },
            "expirePointsForCustomer failed",
          );
        });
        const customer = await deps.CustomerRepo.getById(auth.id);
        if (!matchesCustomer(customer, auth)) return missingCustomer(req, res);
        const business = await deps.BusinessRepo.getById(auth.business_id);
        if (!business || String(business.id) !== auth.business_id) return missingCustomer(req, res);
        const overrides = await deps.PlanConfigService.getPlanFeatureOverrides().catch(() => ({}));
        const features = planFeaturesWithOverrides(business.plan, overrides);
        const discountTerms = memberDiscount(business, { amount_q: 0 });
        const stampTerms = stampCard(business, { points: Number(customer.points) || 0 });
        const rewardProgress = features.rewards
          ? await deps.getCustomerRewardProgress(deps.getDbClient(), {
              businessId: auth.business_id,
              customerId: auth.id,
            })
          : null;
        // Installed clients only understand stock/expiry, so expose eligible choices
        // without changing those fields or excluding choices still requiring points.
        /** @type {RewardChoice[]} */
        const rewards = (rewardProgress?.choices ?? []).filter(
          (/** @type {RewardChoice} */ reward) => reward.active && reward.available,
        );
        const transactions = await deps.TxnRepo.listByCustomer(auth.id, 50);
        const redemptions = await deps.RedemptionRepo.listByCustomer(auth.id, 50);
        const wallet = await deps.walletService.status(auth);
        // Stored-value programs (CASHBACK, GIFT_CARD) carry a Q balance and a
        // ledger beside the points fields; other programs read nothing here.
        const cbTerms = cashbackTerms(business, { amount_q: 0 });
        const programWallet = walletProgram(business);
        const walletBalance = programWallet
          ? await deps.getCashbackBalance(deps.getDbClient(), auth.id)
          : null;
        const walletHistory = programWallet
          ? await deps.listStoredValueHistory(deps.getDbClient(), auth.id, 50)
          : [];
        const tier = features.tiers
          ? await deps.getCustomerTierInfo(auth.id).catch((err) => {
              logger.warn({ err: err?.message, customerId: auth.id }, "customer tier unavailable");
              return null;
            })
          : null;
        const referral = features.referrals
          ? await deps.getCustomerReferralStats(auth.id).catch(() => null)
          : null;
        /** @param {{ business_id: unknown }} record */
        const inBusiness = (record) => String(record.business_id) === auth.business_id;
        /** @param {{ business_id: unknown, customer_id: unknown }} record */
        const forCustomer = (record) =>
          inBusiness(record) && String(record.customer_id) === auth.id;
        res.json({
          ok: true,
          business: {
            ...businessIdentity(business),
            customer_branding: customerBranding(business.customer_branding_json),
            features,
            member_discount: discountTerms
              ? {
                  percent_off: discountTerms.percent_off,
                  min_purchase_q: discountTerms.min_purchase_q,
                }
              : null,
          },
          customer: project(customer, customerFields),
          rewards: rewards.map((record) => ({
            ...project(record, rewardFields),
            valid_until:
              record.valid_until == null
                ? record.valid_until
                : new Date(record.valid_until).toISOString(),
          })),
          reward_progress: rewardProgress,
          transactions: transactions
            .filter(forCustomer)
            .map((record) => project(record, transactionFields)),
          redemptions: redemptions
            .filter(forCustomer)
            .map((record) => project(record, redemptionFields)),
          wallet,
          stamp_card: stampTerms
            ? {
                stamps_required: stampTerms.stamps_required,
                head_start: stampTerms.head_start,
                filled: stampTerms.filled,
                remaining: stampTerms.remaining,
                reward_label: stampTerms.reward_label,
                complete: stampTerms.complete,
              }
            : null,
          // Same shapes as /api/customer/me `cashback` and `wallet`; the latter is
          // named program_wallet here because `wallet` above is the native-pass
          // status installed clients already read.
          cashback:
            walletBalance && cbTerms
              ? {
                  balance_q: Math.max(0, Number(walletBalance.balance_q)),
                  percent: cbTerms.percent,
                }
              : null,
          program_wallet:
            programWallet && walletBalance
              ? {
                  kind: programWallet.kind,
                  balance_q: Math.max(0, Number(walletBalance.balance_q)),
                  percent: programWallet.kind === "CASHBACK" ? programWallet.percent : null,
                  bonus_percent:
                    programWallet.kind === "GIFT_CARD" ? programWallet.bonus_percent : null,
                }
              : null,
          wallet_history: walletHistory,
          tier: customerTier(tier),
          ...customerReferral(referral),
        });
      },
    ),
  );

  // Member-to-member gift of gift-card balance: the same validation, service and
  // idempotency key as the browser card's /api/customer/giftcard/transfer.
  router.post(
    "/mobile/customer/giftcard/transfer",
    deps.giftTransferLimit,
    asyncRoute(
      /** @param {MobileCustomerRequest} req @param {Response} res @returns {HandlerResult} */
      async (req, res) => {
        const result = validate(GiftCardTransferSchema, req.body);
        if (!result.ok) return res.status(400).json({ error: result.error });
        const out = await deps.transferGiftCard({ auth: req.customerAuth, ...result.data });
        res.json({ ok: true, ...out });
      },
    ),
  );

  router.post(
    "/mobile/customer/qr",
    asyncRoute(
      /** @param {MobileCustomerRequest} req @param {Response} res */
      async (req, res) => {
        res.json(
          await deps.issueCustomerQr({
            businessId: req.customerAuth.business_id,
            customerId: req.customerAuth.id,
          }),
        );
      },
    ),
  );

  router.post(
    "/mobile/customer/logout",
    asyncRoute(
      /** @param {MobileCustomerRequest} req @param {Response} res */
      async (req, res) => {
        await deps.invalidateBrowserSessionById(req.authSession.id, "logout");
        res.json({ ok: true });
      },
    ),
  );

  router.delete(
    "/mobile/customer",
    asyncRoute(
      /** @param {MobileCustomerRequest} req @param {Response} res */
      async (req, res) => {
        if (!deleteSchema.safeParse(req.body).success)
          throw badRequest("Confirma la eliminación con confirm: true.");
        await deps.withTransaction(async () => {
          await deps.CustomerRepo.softDelete(req.customerAuth.id);
          await deps.invalidateBrowserSessionsForActor({
            actorType: "CUSTOMER",
            actorId: req.customerAuth.id,
            reason: "customer_deleted",
          });
        });
        res.json({ ok: true });
      },
    ),
  );

  router.post(
    "/mobile/customer/wallet/:provider",
    deps.walletIssueLimit,
    asyncRoute(
      /** @param {MobileCustomerRequest<{ provider: string }>} req @param {Response} res */
      async (req, res) => {
        const result = await deps.walletService.issue(req.customerAuth, req.params.provider);
        res.json(
          req.params.provider === "apple"
            ? { ...result, url: `${req.baseUrl}/mobile/customer/wallet/apple/download` }
            : result,
        );
      },
    ),
  );

  router.get(
    "/mobile/customer/wallet/apple/download",
    asyncRoute(
      /** @param {MobileCustomerRequest} req @param {Response} res */
      async (req, res) => {
        const bytes = await deps.walletService.downloadApple(req.customerAuth);
        res
          .set({
            "Content-Type": "application/vnd.apple.pkpass",
            "Content-Disposition": 'attachment; filename="PuntosFieles.pkpass"',
            "Content-Length": String(bytes.length),
          })
          .end(bytes);
      },
    ),
  );

  return router;
}

export const mobileRoutes = createMobileRoutes();
