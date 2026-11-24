import { Router } from "express";
import { z } from "zod";
import { requireStaff, requireOwner } from "../../middleware/auth.js";
import { tenantContext } from "../../middleware/tenant.js";
import { requirePlanFeature } from "../../middleware/plan-feature.js";
import { csrfProtect } from "../../middleware/csrf.js";
import { asyncRoute } from "../../middleware/common.js";
import { AudienceDefinitionSchema } from "../services/customer-audience-definition.js";
import {
  listCustomerSegments,
  createCustomerSegment,
  updateCustomerSegment,
  previewCustomerAudience,
} from "../services/customer-audience-service.js";

/** @typedef {import("./_request-types.js").Request} Request */
/** @typedef {import("./_request-types.js").Response} Response */
/** @typedef {import("./_request-types.js").NextFunction} NextFunction */
/** @typedef {import("./_request-types.js").TenantRequest} TenantRequest */

const uuid = z.guid().transform((value) => value.toLowerCase());
const Empty = z.object({}).strict();
const Params = z.object({ id: uuid }).strict();
const Name = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value));
const Create = z
  .object({ request_id: uuid, name: Name, definition: AudienceDefinitionSchema })
  .strict();
const Update = z
  .object({
    version: z.number().int().min(1).max(2147483646),
    name: Name,
    definition: AudienceDefinitionSchema,
    archived: z.boolean(),
  })
  .strict();
const Preview = z
  .object({
    definition: AudienceDefinitionSchema,
    limit: z.number().int().min(1).max(20).default(10),
  })
  .strict();

/** @typedef {z.infer<typeof AudienceDefinitionSchema>} AudienceDefinition */
/** @typedef {z.infer<typeof Update>} AudienceUpdateBody */

/** @param {Response} res */
const invalid = (res) =>
  res.status(400).json({
    error: "Revisa las condiciones y los límites de esta audiencia.",
    code: "VALIDATION_ERROR",
  });
/** @param {TenantRequest} req */
const actor = (req) => ({
  businessId: req.tenantId,
  staffId: req.staff.id,
  ip: req.ip,
  ua: req.get("user-agent") || null,
  ...(req.staff.impersonated_by ? { impersonated_by: req.staff.impersonated_by } : {}),
});
/** @typedef {ReturnType<typeof actor>} AudienceActor */

/**
 * Services the router calls, by the input it hands them. Unit tests inject
 * fakes, so results are forwarded opaquely (`res.json`).
 * @typedef {{
 *   listCustomerSegments: (input: { businessId: string }) => Promise<unknown>,
 *   createCustomerSegment: (input: AudienceActor & {
 *     requestId: string,
 *     name: string,
 *     definition: AudienceDefinition
 *   }) => Promise<unknown>,
 *   updateCustomerSegment: (input: AudienceActor & { segmentId: string } & AudienceUpdateBody) => Promise<unknown>,
 *   previewCustomerAudience: (input: {
 *     businessId: string,
 *     definition: AudienceDefinition,
 *     limit: number
 *   }) => Promise<unknown>
 * }} CustomerAudienceDeps
 */

/** @param {Partial<CustomerAudienceDeps>} [deps] */
export function createCustomerAudienceRouter(deps = {}) {
  /** @type {CustomerAudienceDeps} */
  const services = {
    listCustomerSegments,
    createCustomerSegment,
    updateCustomerSegment,
    previewCustomerAudience,
    ...deps,
  };
  const router = Router(),
    base = "/admin/audiences";
  router.use(
    base,
    /** @param {Request} _req @param {Response} res @param {NextFunction} next */
    (_req, res, next) => {
      res.set("Cache-Control", "no-store");
      next();
    },
    requireStaff,
    tenantContext,
    requireOwner,
    requirePlanFeature("analytics"),
    requirePlanFeature("campaign_rules"),
  );
  router.get(
    base,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res */
      async (req, res) => {
        if (!Empty.safeParse(req.query).success) return invalid(res);
        return res.json(await services.listCustomerSegments({ businessId: req.tenantId }));
      },
    ),
  );
  router.post(
    base,
    csrfProtect,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res */
      async (req, res) => {
        const body = Create.safeParse(req.body);
        if (!body.success || !Empty.safeParse(req.query).success) return invalid(res);
        return res.status(201).json(
          await services.createCustomerSegment({
            ...actor(req),
            requestId: body.data.request_id,
            name: body.data.name,
            definition: body.data.definition,
          }),
        );
      },
    ),
  );
  router.post(
    `${base}/preview`,
    csrfProtect,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res */
      async (req, res) => {
        const body = Preview.safeParse(req.body);
        if (!body.success || !Empty.safeParse(req.query).success) return invalid(res);
        return res.json(
          await services.previewCustomerAudience({
            businessId: req.tenantId,
            definition: body.data.definition,
            limit: body.data.limit,
          }),
        );
      },
    ),
  );
  router.put(
    `${base}/:id`,
    csrfProtect,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res */
      async (req, res) => {
        const body = Update.safeParse(req.body),
          params = Params.safeParse(req.params);
        if (!body.success || !params.success || !Empty.safeParse(req.query).success)
          return invalid(res);
        return res.json(
          await services.updateCustomerSegment({
            ...actor(req),
            segmentId: params.data.id,
            ...body.data,
          }),
        );
      },
    ),
  );
  return router;
}
