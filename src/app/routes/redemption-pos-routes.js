import { Router } from "express";
import { z } from "zod";
import { requireStaff, requireOwner, requireStaffPermission } from "../../middleware/auth.js";
import { Permission } from "../../utils/permissions.js";
import { tenantContext } from "../../middleware/tenant.js";
import { csrfProtect } from "../../middleware/csrf.js";
import { asyncRoute } from "../../middleware/common.js";
import { validateRequest } from "../../utils/schemas.js";
import * as services from "../services/redemption-pos-service.js";
import * as mappingServices from "../services/reward-pos-mapping-service.js";

/** @typedef {import("./_request-types.js").Request} Request */
/** @typedef {import("./_request-types.js").Response} Response */
/** @typedef {import("./_request-types.js").NextFunction} NextFunction */
/**
 * @template [P=import("./_request-types.js").ParamsDictionary]
 * @typedef {import("./_request-types.js").TenantRequest<P>} TenantRequest
 */
/**
 * @template Body
 * @typedef {import("./_request-types.js").WithValidated<Body>} WithValidated
 */

const uuid = z.guid(),
  empty = z.object({}).strict();
// Structural shapes only (required keys, primitive types). The services apply
// the strict schemas from redemption-pos-model.js, including unknown-key
// rejection, which is why unknown keys pass through here.
const manualFulfillmentShape = z.looseObject({
  requestId: z.string(),
  version: z.number(),
  action: z.enum(["recorded", "not_required", "review", "reviewed"]),
  receiptRef: z.string().optional(),
  reason: z.string(),
  attested: z.boolean(),
});
const rewardPosMappingShape = z.looseObject({
  source: z.string(),
  branchId: z.string().nullable(),
  productRef: z.string(),
  itemName: z.string(),
  itemKind: z.enum(["product", "service"]),
  quantity: z.number(),
  enabled: z.boolean(),
  inventoryRequired: z.boolean().optional(),
  version: z.number(),
});
const query = z
  .object({
    status: z
      .enum(["all", "pending", "recorded", "not_required", "review", "reviewed", "unknown"])
      .default("pending"),
    code: z
      .string()
      .regex(/^[a-f0-9]{0,16}$/i)
      .default(""),
    offset: z
      .string()
      .regex(/^(0|[1-9]\d*)$/)
      .default("0")
      .transform(Number)
      .pipe(z.number().int().max(100000)),
  })
  .strict();

/** @typedef {z.infer<typeof manualFulfillmentShape>} ManualFulfillmentInput */
/** @typedef {z.infer<typeof rewardPosMappingShape>} RewardPosMappingInput */
/** @typedef {z.infer<typeof query>} RedemptionPosQuery */
/** @typedef {{ businessId: string, staff: TenantRequest["staff"] }} RedemptionPosActor */

/**
 * Services the router calls, by the input it hands them. Unit tests inject
 * fakes, so results are forwarded opaquely (`res.json`).
 * @typedef {{
 *   listRedemptionPosRecords: (input: RedemptionPosActor & RedemptionPosQuery) => Promise<unknown>,
 *   getRedemptionPosRecord: (input: RedemptionPosActor & { redemptionId: string }) => Promise<unknown>,
 *   recordManualFulfillment: (input: RedemptionPosActor & {
 *     redemptionId: string,
 *     input: ManualFulfillmentInput
 *   }) => Promise<unknown>,
 *   getRewardPosMappings: (input: RedemptionPosActor) => Promise<unknown>,
 *   saveRewardPosMapping: (input: RedemptionPosActor & {
 *     rewardId: string,
 *     input: RewardPosMappingInput
 *   }) => Promise<unknown>
 * }} RedemptionPosDeps
 */

/** @param {Response} res */
const invalid = (res) =>
  res
    .status(400)
    .json({ error: "Revisa el canje y los datos de la solicitud.", code: "VALIDATION_ERROR" });
/** @param {Partial<RedemptionPosDeps>} [deps] */
export function createRedemptionPosRoutes(deps = {}) {
  const router = Router(),
    /** @type {RedemptionPosDeps} */
    s = { ...services, ...mappingServices, ...deps };
  for (const prefix of ["admin", "staff"]) {
    const base = `/${prefix}/redemption-pos`;
    router.use(
      base,
      /** @param {Request} _req @param {Response} res @param {NextFunction} next */
      (_req, res, next) => {
        res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
        next();
      },
      requireStaff,
      tenantContext,
      ...(prefix === "admin" ? [requireOwner] : [requireStaffPermission(Permission.STAFF_REDEEM)]),
    );
    /** @param {TenantRequest} req @returns {RedemptionPosActor} */
    const actor = (req) => ({ businessId: req.tenantId, staff: req.staff });
    router.get(
      base,
      asyncRoute(
        /** @param {TenantRequest} req @param {Response} res @returns {Promise<void | Response>} */
        async (req, res) => {
          const parsed = query.safeParse(req.query);
          if (!parsed.success) return invalid(res);
          res.json(await s.listRedemptionPosRecords({ ...actor(req), ...parsed.data }));
        },
      ),
    );
    router.get(
      `${base}/:redemptionId`,
      asyncRoute(
        /** @param {TenantRequest<{ redemptionId: string }>} req @param {Response} res @returns {Promise<void | Response>} */
        async (req, res) => {
          if (
            !uuid.safeParse(req.params.redemptionId).success ||
            !empty.safeParse(req.query).success
          )
            return invalid(res);
          res.json(
            await s.getRedemptionPosRecord({
              ...actor(req),
              redemptionId: req.params.redemptionId.toLowerCase(),
            }),
          );
        },
      ),
    );
    router.post(
      `${base}/:redemptionId`,
      csrfProtect,
      validateRequest(manualFulfillmentShape),
      asyncRoute(
        /** @param {TenantRequest<{ redemptionId: string }> & WithValidated<ManualFulfillmentInput>} req @param {Response} res @returns {Promise<void | Response>} */
        async (req, res) => {
          if (
            !uuid.safeParse(req.params.redemptionId).success ||
            !empty.safeParse(req.query).success
          )
            return invalid(res);
          res.json(
            await s.recordManualFulfillment({
              ...actor(req),
              redemptionId: req.params.redemptionId.toLowerCase(),
              input: req.validated,
            }),
          );
        },
      ),
    );
  }
  const base = "/admin/reward-pos-mappings";
  router.use(
    base,
    /** @param {Request} _req @param {Response} res @param {NextFunction} next */
    (_req, res, next) => {
      res.set("Cache-Control", "no-store");
      next();
    },
    requireStaff,
    requireOwner,
    tenantContext,
  );
  router.get(
    base,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res @returns {Promise<void | Response>} */
      async (req, res) => {
        if (!empty.safeParse(req.query).success) return invalid(res);
        res.json(await s.getRewardPosMappings({ businessId: req.tenantId, staff: req.staff }));
      },
    ),
  );
  router.put(
    `${base}/:rewardId`,
    csrfProtect,
    validateRequest(rewardPosMappingShape),
    asyncRoute(
      /** @param {TenantRequest<{ rewardId: string }> & WithValidated<RewardPosMappingInput>} req @param {Response} res @returns {Promise<void | Response>} */
      async (req, res) => {
        if (!uuid.safeParse(req.params.rewardId).success || !empty.safeParse(req.query).success)
          return invalid(res);
        res.json(
          await s.saveRewardPosMapping({
            businessId: req.tenantId,
            staff: req.staff,
            rewardId: req.params.rewardId.toLowerCase(),
            input: req.validated,
          }),
        );
      },
    ),
  );
  return router;
}
export const redemptionPosRoutes = createRedemptionPosRoutes();
