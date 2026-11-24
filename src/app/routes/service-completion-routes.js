import { Router } from "express";
import { z } from "zod";
import { requireStaff, requireOwner } from "../../middleware/auth.js";
import { tenantContext } from "../../middleware/tenant.js";
import { csrfProtect } from "../../middleware/csrf.js";
import { asyncRoute } from "../../middleware/common.js";
import * as services from "../services/service-completion-service.js";

/** @typedef {import("./_request-types.js").Request} Request */
/** @typedef {import("./_request-types.js").Response} Response */
/** @typedef {import("./_request-types.js").NextFunction} NextFunction */
/** @typedef {import("./_request-types.js").TenantRequest} TenantRequest */
/** @typedef {{ businessId: string, staff: TenantRequest["staff"] }} ServiceCompletionActor */

const empty = z.object({}).strict(),
  uuid = z.guid().transform((value) => value.toLowerCase()),
  version = z.number().int().min(1).max(2147483646);
const step = z
  .object({
    requestId: uuid,
    version,
    action: z.enum(["signup", "earn", "ineligibility", "unlock", "redeem", "refund"]),
    quantity: z.number().positive().max(1000000).optional(),
    rewardId: uuid.optional(),
  })
  .strict();

/** @typedef {z.infer<typeof step>} RehearsalStepBody */

/**
 * Services the router calls, by the input it hands them. Unit tests inject
 * fakes, so results are forwarded opaquely (`res.json`).
 * @typedef {{
 *   getAutomaticBriefing: (input: ServiceCompletionActor) => Promise<unknown>,
 *   acknowledgeAutomaticBriefing: (input: ServiceCompletionActor & {
 *     briefingId: string,
 *     version: number
 *   }) => Promise<unknown>,
 *   getRehearsal: (input: ServiceCompletionActor) => Promise<unknown>,
 *   startRehearsal: (input: ServiceCompletionActor & { requestId: string }) => Promise<unknown>,
 *   advanceRehearsal: (input: ServiceCompletionActor & {
 *     rehearsalId: string,
 *     requestId: string
 *   } & RehearsalStepBody) => Promise<unknown>
 * }} ServiceCompletionDeps
 */

/** @param {Response} res */
const invalid = (res) =>
  res
    .status(400)
    .json({ error: "Revisa los datos de la práctica o del resumen.", code: "VALIDATION_ERROR" });
/** @param {Partial<ServiceCompletionDeps>} [deps] */
export function createServiceCompletionRoutes(deps = {}) {
  const router = Router(),
    /** @type {ServiceCompletionDeps} */
    s = { ...services, ...deps };
  for (const prefix of ["staff", "admin"]) {
    const base = `/${prefix}/service-operations`;
    /** @param {TenantRequest} req @returns {ServiceCompletionActor} */
    const actor = (req) => ({ businessId: req.tenantId, staff: req.staff });
    router.use(
      base,
      /** @param {Request} _req @param {Response} res @param {NextFunction} next */
      (_req, res, next) => {
        res.set("Cache-Control", "no-store");
        next();
      },
      requireStaff,
      tenantContext,
      ...(prefix === "admin" ? [requireOwner] : []),
    );
    router.get(
      `${base}/briefing`,
      asyncRoute(
        /** @param {TenantRequest} req @param {Response} res */
        async (req, res) => {
          if (!empty.safeParse(req.query).success) return invalid(res);
          return res.json(await s.getAutomaticBriefing(actor(req)));
        },
      ),
    );
    router.post(
      `${base}/briefing/:id/ack`,
      csrfProtect,
      asyncRoute(
        /** @param {TenantRequest} req @param {Response} res */
        async (req, res) => {
          const id = uuid.safeParse(req.params.id),
            body = z.object({ version }).strict().safeParse(req.body);
          if (!id.success || !body.success || !empty.safeParse(req.query).success)
            return invalid(res);
          return res.json(
            await s.acknowledgeAutomaticBriefing({
              ...actor(req),
              briefingId: id.data,
              ...body.data,
            }),
          );
        },
      ),
    );
    router.get(
      `${base}/rehearsal`,
      asyncRoute(
        /** @param {TenantRequest} req @param {Response} res */
        async (req, res) => {
          if (!empty.safeParse(req.query).success) return invalid(res);
          return res.json(await s.getRehearsal(actor(req)));
        },
      ),
    );
    router.post(
      `${base}/rehearsal`,
      csrfProtect,
      asyncRoute(
        /** @param {TenantRequest} req @param {Response} res */
        async (req, res) => {
          const body = z.object({ requestId: uuid }).strict().safeParse(req.body);
          if (!body.success || !empty.safeParse(req.query).success) return invalid(res);
          return res
            .status(201)
            .json(await s.startRehearsal({ ...actor(req), requestId: body.data.requestId }));
        },
      ),
    );
    router.post(
      `${base}/rehearsal/:id/step`,
      csrfProtect,
      asyncRoute(
        /** @param {TenantRequest} req @param {Response} res */
        async (req, res) => {
          const id = uuid.safeParse(req.params.id),
            body = step.safeParse(req.body);
          if (!id.success || !body.success || !empty.safeParse(req.query).success)
            return invalid(res);
          return res.json(
            await s.advanceRehearsal({
              ...actor(req),
              rehearsalId: id.data,
              ...body.data,
              requestId: body.data.requestId,
            }),
          );
        },
      ),
    );
  }
  return router;
}
export const serviceCompletionRoutes = createServiceCompletionRoutes();
