import { Router } from "express";
import { z } from "zod";
import { requireStaff, requireOwner, requireCustomer } from "../../middleware/auth.js";
import { tenantContext } from "../../middleware/tenant.js";
import { csrfProtect } from "../../middleware/csrf.js";
import { asyncRoute } from "../../middleware/common.js";
import * as service from "../services/reward-promise-service.js";

/** @typedef {import("./_request-types.js").Request} Request */
/** @typedef {import("./_request-types.js").Response} Response */
/** @typedef {import("./_request-types.js").NextFunction} NextFunction */
/** @typedef {import("./_request-types.js").TenantRequest} TenantRequest */
/** @typedef {{ businessId: string, staff: TenantRequest["staff"] }} RewardPromiseActor */

const uuid = z.guid().transform((v) => v.toLowerCase()),
  empty = z.object({}).strict();
const availability = z
  .object({ available: z.boolean(), alternative_reward_ids: z.array(uuid).max(5) })
  .strict();
const redeem = z
  .object({
    request_id: uuid,
    customer_id: uuid,
    promise_id: uuid.optional(),
    hospitality_id: uuid.optional(),
    fulfillment_reward_id: uuid.optional(),
    customer_accepted: z.boolean().default(false),
  })
  .strict()
  .refine((v) => Boolean(v.promise_id) !== Boolean(v.hospitality_id));

/**
 * Services the router calls, by the input it hands them. Unit tests inject
 * fakes, so results are forwarded opaquely (`res.json`).
 * @typedef {{
 *   getRewardPromisesOverview: (input: RewardPromiseActor) => Promise<unknown>,
 *   configureRewardAvailability: (input: RewardPromiseActor & {
 *     rewardId: string,
 *     available: boolean,
 *     alternativeRewardIds: string[]
 *   }) => Promise<unknown>,
 *   listCustomerEntitlements: (input: { businessId: string, customerId: string }) => Promise<unknown>,
 *   redeemEntitlement: (input: RewardPromiseActor & {
 *     customerId: string,
 *     promiseId?: string,
 *     hospitalityId?: string,
 *     fulfillmentRewardId?: string,
 *     customerAccepted: boolean,
 *     requestId: string
 *   }) => Promise<unknown>
 * }} RewardPromiseDeps
 */

/** @param {TenantRequest} req @returns {RewardPromiseActor} */
const actor = (req) => ({ businessId: req.tenantId, staff: req.staff });
/** @param {Response} res */
const invalid = (res) =>
  res.status(400).json({ error: "Revisa los datos de la solicitud.", code: "VALIDATION_ERROR" });
/** @param {Partial<RewardPromiseDeps>} [deps] */
export function createRewardPromiseRoutes(deps = {}) {
  /** @type {RewardPromiseDeps} */
  const s = { ...service, ...deps },
    router = Router();
  for (const path of [
    "/admin/reward-promises",
    "/staff/reward-entitlements",
    "/customer/reward-entitlements",
  ])
    router.use(
      path,
      /** @param {Request} _req @param {Response} res @param {NextFunction} next */
      (_req, res, next) => {
        res.set("Cache-Control", "no-store");
        next();
      },
      path.startsWith("/customer/") ? requireCustomer : requireStaff,
      tenantContext,
      ...(path.startsWith("/admin/") ? [requireOwner] : []),
    );
  router.get(
    "/admin/reward-promises",
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res */
      async (req, res) => {
        if (!empty.safeParse(req.query).success) return invalid(res);
        return res.json(await s.getRewardPromisesOverview(actor(req)));
      },
    ),
  );
  router.put(
    "/admin/reward-promises/:rewardId/availability",
    csrfProtect,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res */
      async (req, res) => {
        const id = uuid.safeParse(req.params.rewardId),
          parsed = availability.safeParse(req.body);
        if (!id.success || !parsed.success || !empty.safeParse(req.query).success)
          return invalid(res);
        return res.json(
          await s.configureRewardAvailability({
            ...actor(req),
            rewardId: id.data,
            available: parsed.data.available,
            alternativeRewardIds: parsed.data.alternative_reward_ids,
          }),
        );
      },
    ),
  );
  router.get(
    "/staff/reward-entitlements",
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res */
      async (req, res) => {
        const parsed = z.object({ customer_id: uuid }).strict().safeParse(req.query);
        if (!parsed.success) return invalid(res);
        return res.json(
          await s.listCustomerEntitlements({
            businessId: req.tenantId,
            customerId: parsed.data.customer_id,
          }),
        );
      },
    ),
  );
  router.get(
    "/customer/reward-entitlements",
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res */
      async (req, res) => {
        if (!empty.safeParse(req.query).success) return invalid(res);
        return res.json(
          await s.listCustomerEntitlements({
            businessId: req.tenantId,
            customerId: req.customerAuth.id,
          }),
        );
      },
    ),
  );
  router.post(
    "/staff/reward-entitlements/redeem",
    csrfProtect,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res */
      async (req, res) => {
        const parsed = redeem.safeParse(req.body);
        if (!parsed.success || !empty.safeParse(req.query).success) return invalid(res);
        const v = parsed.data;
        return res.json(
          await s.redeemEntitlement({
            ...actor(req),
            customerId: v.customer_id,
            promiseId: v.promise_id,
            hospitalityId: v.hospitality_id,
            fulfillmentRewardId: v.fulfillment_reward_id,
            customerAccepted: v.customer_accepted,
            requestId: v.request_id,
          }),
        );
      },
    ),
  );
  return router;
}
export const rewardPromiseRoutes = createRewardPromiseRoutes();
