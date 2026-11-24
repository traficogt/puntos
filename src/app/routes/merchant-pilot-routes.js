import { Router } from "express";
import { z } from "zod";
import { requireStaff, requireOwner } from "../../middleware/auth.js";
import { tenantContext } from "../../middleware/tenant.js";
import { requirePlanFeature } from "../../middleware/plan-feature.js";
import { csrfProtect } from "../../middleware/csrf.js";
import { asyncRoute } from "../../middleware/common.js";
import * as services from "../services/merchant-pilot-service.js";

/** @typedef {import("./_request-types.js").Request} Request */
/** @typedef {import("./_request-types.js").Response} Response */
/** @typedef {import("./_request-types.js").NextFunction} NextFunction */
/**
 * @template [P=import("./_request-types.js").ParamsDictionary]
 * @typedef {import("./_request-types.js").TenantRequest<P>} TenantRequest
 */

const uuid = z.guid().transform((v) => v.toLowerCase()),
  empty = z.object({}).strict();
const create = z
  .object({
    request_id: uuid,
    name: z.string().trim().min(1).max(100),
    duration_days: z.union([z.literal(14), z.literal(30), z.literal(60)]),
    pos_profile: services.PilotPosProfile.nullable().optional(),
    capabilities: services.PilotCapabilities.optional(),
  })
  .strict()
  .refine((v) => !v.capabilities || v.capabilities.pos === !!v.pos_profile);
const evidence = z
  .object({
    status: z.enum(["pending", "passed", "failed", "not_applicable"]),
    note: z.string().trim().max(500),
  })
  .strict();
const close = z
  .object({ outcome: z.enum(["completed", "stopped"]), note: z.string().trim().max(500) })
  .strict()
  .refine((v) => v.outcome !== "stopped" || v.note.length > 0);
const params = z.object({ id: uuid }).strict();
const list = z
  .object({
    offset: z
      .string()
      .regex(/^(0|[1-9]\d*)$/)
      .default("0")
      .transform(Number)
      .pipe(z.number().int().max(100000)),
  })
  .strict();

/** @typedef {z.infer<typeof create>} PilotCreateBody */
/** @typedef {z.infer<typeof evidence>} PilotEvidenceBody */
/** @typedef {z.infer<typeof close>} PilotCloseBody */

/** @param {TenantRequest} req */
const actor = (req) => ({
  businessId: req.tenantId,
  staffId: req.staff.id,
  ip: req.ip,
  ua: req.get("user-agent") || null,
});
/** @typedef {ReturnType<typeof actor>} PilotActor */
/** @param {Response} res */
const invalid = (res) =>
  res.status(400).json({ error: "Revisa los datos de esta solicitud.", code: "VALIDATION_ERROR" });

/**
 * Services the router calls, by the input it hands them. Unit tests inject
 * fakes, so results are forwarded opaquely (`res.json`).
 * @typedef {{
 *   listPilots: (input: { businessId: string, offset: number }) => Promise<unknown>,
 *   createPilot: (input: PilotActor & {
 *     requestId: string,
 *     name: string,
 *     durationDays: PilotCreateBody["duration_days"],
 *     posProfile?: PilotCreateBody["pos_profile"],
 *     capabilities?: PilotCreateBody["capabilities"]
 *   }) => Promise<unknown>,
 *   getPilot: (input: { businessId: string, pilotId: string }) => Promise<unknown>,
 *   updatePilotCheck: (input: PilotActor & {
 *     pilotId: string,
 *     key: string,
 *     status: PilotEvidenceBody["status"],
 *     note: string
 *   }) => Promise<unknown>,
 *   closePilot: (input: PilotActor & { pilotId: string } & PilotCloseBody) => Promise<unknown>
 * }} MerchantPilotDeps
 */

/** @param {Partial<MerchantPilotDeps>} [deps] */
export function createMerchantPilotRoutes(deps = {}) {
  /** @type {MerchantPilotDeps} */
  const s = { ...services, ...deps },
    router = Router(),
    base = "/admin/pilots";
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
  );
  router.get(
    base,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res */
      async (req, res) => {
        const p = list.safeParse(req.query);
        if (!p.success) return invalid(res);
        return res.json(await s.listPilots({ businessId: req.tenantId, offset: p.data.offset }));
      },
    ),
  );
  router.post(
    base,
    csrfProtect,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res */
      async (req, res) => {
        const p = create.safeParse(req.body);
        if (!p.success || !empty.safeParse(req.query).success) return invalid(res);
        return res.status(201).json(
          await s.createPilot({
            ...actor(req),
            requestId: p.data.request_id,
            name: p.data.name,
            durationDays: p.data.duration_days,
            ...(p.data.pos_profile !== undefined ? { posProfile: p.data.pos_profile } : {}),
            ...(p.data.capabilities !== undefined ? { capabilities: p.data.capabilities } : {}),
          }),
        );
      },
    ),
  );
  router.get(
    `${base}/:id`,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res */
      async (req, res) => {
        const p = params.safeParse(req.params);
        if (!p.success || !empty.safeParse(req.query).success) return invalid(res);
        return res.json(await s.getPilot({ businessId: req.tenantId, pilotId: p.data.id }));
      },
    ),
  );
  router.put(
    `${base}/:id/checks/:key`,
    csrfProtect,
    asyncRoute(
      /** @param {TenantRequest<{ id: string, key: string }>} req @param {Response} res */
      async (req, res) => {
        const id = uuid.safeParse(req.params.id),
          p = evidence.safeParse(req.body),
          key = req.params.key;
        if (
          !id.success ||
          !p.success ||
          !empty.safeParse(req.query).success ||
          !services.PILOT_CHECKS.some((c) => c.key === key)
        )
          return invalid(res);
        return res.json(
          await s.updatePilotCheck({
            ...actor(req),
            pilotId: id.data,
            key,
            status: p.data.status,
            note: p.data.note,
          }),
        );
      },
    ),
  );
  router.post(
    `${base}/:id/close`,
    csrfProtect,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res */
      async (req, res) => {
        const id = params.safeParse(req.params),
          p = close.safeParse(req.body);
        if (!id.success || !p.success || !empty.safeParse(req.query).success) return invalid(res);
        return res.json(await s.closePilot({ ...actor(req), pilotId: id.data.id, ...p.data }));
      },
    ),
  );
  return router;
}
