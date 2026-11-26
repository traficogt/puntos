import { getDbClient } from "../database.js";
import { withPublicRewardAvailability } from "../services/reward-inventory-public.js";
import { getCustomerRewardProgress } from "../services/customer-reward-progress.js";
import { getCustomerStatement } from "../services/customer-statement-service.js";
import { businessRegion } from "../services/regional-settings.js";
import { memberDiscount } from "../services/discount-model.js";
import { stampCard } from "../services/stamp-model.js";
import { cashbackTerms } from "../services/cashback-model.js";
import { getCashbackBalance } from "../services/cashback-service.js";
import { walletProgram } from "../services/wallet-model.js";
import {
  GiftCardTransferSchema,
  transferGiftCardForCustomer,
} from "../services/gift-card-program-service.js";
import { validate } from "../../utils/validation.js";
import { Router } from "express";
import { asyncRoute } from "../../middleware/common.js";
import { requireCustomer } from "../../middleware/auth.js";
import { csrfProtect } from "../../middleware/csrf.js";
import { requirePlanFeature } from "../../middleware/plan-feature.js";
import { CustomerRepo } from "../repositories/customer-repository.js";
import { TxnRepo } from "../repositories/transaction-repository.js";
import { RewardRepo } from "../repositories/reward-repository.js";
import { RedemptionRepo } from "../repositories/redemption-repository.js";
import { toCSV } from "../../utils/csv.js";
import { BusinessRepo } from "../repositories/business-repository.js";
import { PlanConfigService } from "../services/plan-config-service.js";
import {
  settlePendingPointsForCustomer,
  expirePointsForCustomer,
} from "../services/loyalty-ops-service.js";
import { logger } from "../../utils/logger.js";
import { config } from "../../config/index.js";
import { tenantContext } from "../../middleware/tenant.js";
import {
  invalidateBrowserSessionById,
  invalidateBrowserSessionsForActor,
} from "../services/auth-session-service.js";
import { planFeaturesWithOverrides } from "../../utils/plan.js";

/** @typedef {import("./_request-types.js").Response} Response */
/**
 * Customer-session request: `requireCustomer` attaches the browser session and
 * `requirePlanFeature` may cache the business. `tenantId` stays optional because
 * `tenantContext` lets the request through without one unless enforcement is on,
 * and every handler below guards it explicitly.
 * @typedef {import("./_request-types.js").Request
 *   & import("./_request-types.js").WithAuthSession
 *   & import("./_request-types.js").WithResolvedBusiness} CustomerRequest
 */
/** @typedef {Promise<Response | void>} HandlerResult early `return res...` or fall-through */

export const customerRoutes = Router();

/**
 * @param {CustomerRequest} req
 * @param {Response} res
 */
function rejectMissingCustomer(req, res) {
  if (req.authSession?.id) {
    void invalidateBrowserSessionById(req.authSession.id, "customer_missing").catch(() => {});
  }
  res.clearCookie(config.CUSTOMER_COOKIE_NAME, { path: "/" });
  res.status(404).json({ error: "Cliente no encontrado", code: "CUSTOMER_NOT_FOUND" });
}

customerRoutes.get(
  "/customer/me",
  requireCustomer,
  tenantContext,
  asyncRoute(
    /** @param {CustomerRequest} req @param {Response} res @returns {HandlerResult} */
    async (req, res) => {
      if (!req.tenantId)
        return res
          .status(400)
          .json({ error: "Contexto de negocio requerido", code: "TENANT_REQUIRED" });
      const auth = req.customerAuth;
      if (config.NODE_ENV !== "test") {
        await settlePendingPointsForCustomer(auth.id, auth.business_id).catch((err) => {
          logger.warn(
            { err: err?.message, customerId: auth.id, businessId: auth.business_id },
            "settlePendingPointsForCustomer failed",
          );
        });
        await expirePointsForCustomer(auth.id, auth.business_id).catch((err) => {
          logger.warn(
            { err: err?.message, customerId: auth.id, businessId: auth.business_id },
            "expirePointsForCustomer failed",
          );
        });
      }
      const customer = await CustomerRepo.getById(auth.id);
      if (!customer || customer.business_id !== auth.business_id)
        return rejectMissingCustomer(req, res);
      const business = await BusinessRepo.getById(req.tenantId);
      if (!business || business.id !== auth.business_id) return rejectMissingCustomer(req, res);
      const overrides = await PlanConfigService.getPlanFeatureOverrides().catch(() => ({}));
      const features = planFeaturesWithOverrides(business.plan, overrides);
      const discountTerms = memberDiscount(business, { amount_q: 0 });
      const stamp = stampCard(business, { points: Number(customer.points) || 0 });
      const cbTerms = cashbackTerms(business, { amount_q: 0 });
      const cashback = cbTerms ? await getCashbackBalance(getDbClient(), auth.id) : null;
      const wallet = walletProgram(business);
      const walletBalance = wallet
        ? (cashback ?? (await getCashbackBalance(getDbClient(), auth.id)))
        : null;
      res.json({
        ok: true,
        business: {
          id: business.id,
          name: business.name,
          slug: business.slug,
          plan: business.plan,
          features,
          region: businessRegion(business),
          customer_branding: business.customer_branding_json ?? null,
          member_discount: discountTerms
            ? {
                percent_off: discountTerms.percent_off,
                min_purchase_q: discountTerms.min_purchase_q,
              }
            : null,
        },
        customer: {
          id: customer.id,
          phone: customer.phone,
          name: customer.name,
          points: customer.points,
          pending_points: customer.pending_points,
          lifetime_points: customer.lifetime_points,
          created_at: customer.created_at,
          last_visit_at: customer.last_visit_at,
          // "Cuenta de prueba": the card shows a small label so the owner's own phone is
          // never mistaken for a real customer. Additive; older clients ignore it.
          is_test: customer.is_test === true,
        },
        stamp_card: stamp
          ? {
              stamps_required: stamp.stamps_required,
              head_start: stamp.head_start,
              filled: stamp.filled,
              remaining: stamp.remaining,
              reward_label: stamp.reward_label,
              complete: stamp.complete,
            }
          : null,
        cashback:
          cashback && cbTerms
            ? { balance_q: Math.max(0, Number(cashback.balance_q)), percent: cbTerms.percent }
            : null,
        wallet:
          wallet && walletBalance
            ? {
                kind: wallet.kind,
                balance_q: Math.max(0, Number(walletBalance.balance_q)),
                percent: wallet.kind === "CASHBACK" ? wallet.percent : null,
                bonus_percent: wallet.kind === "GIFT_CARD" ? wallet.bonus_percent : null,
              }
            : null,
      });
    },
  ),
);

customerRoutes.post(
  "/customer/giftcard/transfer",
  csrfProtect,
  requireCustomer,
  tenantContext,
  asyncRoute(
    /** @param {CustomerRequest} req @param {Response} res @returns {HandlerResult} */
    async (req, res) => {
      const auth = req.customerAuth;
      if (!req.tenantId || req.tenantId !== auth.business_id)
        return rejectMissingCustomer(req, res);
      const v = validate(GiftCardTransferSchema, req.body);
      if (!v.ok) return res.status(400).json({ error: v.error });
      const out = await transferGiftCardForCustomer({ auth, ...v.data });
      res.json({ ok: true, ...out });
    },
  ),
);

customerRoutes.get(
  "/customer/history",
  requireCustomer,
  tenantContext,
  asyncRoute(
    /** @param {CustomerRequest} req @param {Response} res @returns {HandlerResult} */
    async (req, res) => {
      res.setHeader("Cache-Control", "private, no-store");
      const auth = req.customerAuth;
      if (!req.tenantId || req.tenantId !== auth.business_id)
        return rejectMissingCustomer(req, res);
      const customer = await CustomerRepo.getById(auth.id);
      if (!customer || customer.business_id !== auth.business_id)
        return rejectMissingCustomer(req, res);
      const tx = await TxnRepo.listCustomerHistory(auth.business_id, auth.id, 50);
      const red = await RedemptionRepo.listCustomerHistory(auth.business_id, auth.id, 50);
      res.json({ ok: true, transactions: tx, redemptions: red });
    },
  ),
);

customerRoutes.get(
  "/customer/statement",
  requireCustomer,
  tenantContext,
  asyncRoute(
    /** @param {CustomerRequest} req @param {Response} res */
    async (req, res) => {
      res.setHeader("Cache-Control", "private, no-store");
      if (Object.keys(req.query).length)
        return res
          .status(400)
          .json({ error: "El resumen muestra los últimos 30 días.", code: "VALIDATION_ERROR" });
      const auth = req.customerAuth;
      if (!req.tenantId || req.tenantId !== auth.business_id)
        return rejectMissingCustomer(req, res);
      const statement = await getCustomerStatement(getDbClient(), {
        businessId: auth.business_id,
        customerId: auth.id,
      });
      if (!statement) return rejectMissingCustomer(req, res);
      return res.json({ ok: true, statement });
    },
  ),
);

customerRoutes.get(
  "/customer/rewards",
  requireCustomer,
  tenantContext,
  requirePlanFeature("rewards"),
  asyncRoute(
    /** @param {CustomerRequest} req @param {Response} res @returns {HandlerResult} */
    async (req, res) => {
      const auth = req.customerAuth;
      const customer = await CustomerRepo.getById(auth.id);
      if (!customer || customer.business_id !== auth.business_id)
        return rejectMissingCustomer(req, res);
      const rewards = await RewardRepo.listByBusiness(auth.business_id);
      const business =
        req._resolvedBusiness?.id === auth.business_id
          ? req._resolvedBusiness
          : await BusinessRepo.getById(auth.business_id);
      if (!business || business.id !== auth.business_id) return rejectMissingCustomer(req, res);
      const visible = await withPublicRewardAvailability(getDbClient(), {
        business,
        rewards: rewards.filter((r) => r.active),
      });
      const progress = await getCustomerRewardProgress(getDbClient(), {
        businessId: auth.business_id,
        customerId: auth.id,
      });
      if (!progress) return rejectMissingCustomer(req, res);
      res.setHeader("Cache-Control", "no-store");
      res.json({ ok: true, rewards: visible, progress });
    },
  ),
);

customerRoutes.get(
  "/customer/export",
  requireCustomer,
  tenantContext,
  asyncRoute(
    /** @param {CustomerRequest} req @param {Response} res @returns {HandlerResult} */
    async (req, res) => {
      const auth = req.customerAuth;
      const customer = await CustomerRepo.getById(auth.id);
      if (!customer || customer.business_id !== auth.business_id)
        return rejectMissingCustomer(req, res);
      const tx = await TxnRepo.listByCustomer(auth.id, 200);
      const red = await RedemptionRepo.listByCustomer(auth.id, 200);

      const csv = toCSV(
        [
          {
            customer_id: customer.id,
            phone: customer.phone,
            name: customer.name,
            points: customer.points,
            pending_points: customer.pending_points,
            lifetime_points: customer.lifetime_points,
          },
        ],
        ["customer_id", "phone", "name", "points", "pending_points", "lifetime_points"],
      );

      res.setHeader("Content-Type", "application/json");
      res.json({ customer, transactions: tx, redemptions: red, csv_customer: csv });
    },
  ),
);

customerRoutes.delete(
  "/customer/me",
  csrfProtect,
  requireCustomer,
  tenantContext,
  asyncRoute(
    /** @param {CustomerRequest} req @param {Response} res */
    async (req, res) => {
      const auth = req.customerAuth;
      await CustomerRepo.softDelete(auth.id);
      await invalidateBrowserSessionsForActor({
        actorType: "CUSTOMER",
        actorId: auth.id,
        reason: "customer_deleted",
      }).catch(() => {});
      res.clearCookie(config.CUSTOMER_COOKIE_NAME, { path: "/" });
      res.json({ ok: true });
    },
  ),
);
