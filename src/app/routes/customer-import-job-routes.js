import { Router } from "express";
import { z } from "zod";
import { requireStaff, requireOwner } from "../../middleware/auth.js";
import { tenantContext } from "../../middleware/tenant.js";
import { csrfProtect } from "../../middleware/csrf.js";
import { asyncRoute } from "../../middleware/common.js";
import { uuidParamsSchema, validateParams, validateRequest } from "../../utils/schemas.js";
import * as imports from "../services/customer-import-job-service.js";

/** @typedef {import("./_request-types.js").Request} Request */
/** @typedef {import("./_request-types.js").Response} Response */
/** @typedef {import("./_request-types.js").NextFunction} NextFunction */
/** @typedef {import("./_request-types.js").TenantRequest} TenantRequest */
/**
 * @template Body
 * @typedef {import("./_request-types.js").WithValidated<Body>} WithValidated
 */
/**
 * @template P
 * @typedef {import("./_request-types.js").WithValidatedParams<P>} WithValidatedParams
 */
/** @typedef {z.infer<typeof uuidParamsSchema>} UuidParams */

// Structural shapes only. importJobPreviewSchema / importJobCreateSchema in the
// service stay authoritative (size limits, UUIDs, strict keys) and keep their
// owner-facing messages for semantic problems such as an oversized file.
const existingPolicy = z.enum(["skip", "reject"]).optional();
const importPreviewShape = z.looseObject({
  csv: z.string(),
  columns: z.record(z.string(), z.unknown()).optional(),
  existing_policy: existingPolicy,
});
const importCreateShape = z.looseObject({
  csv: z.string(),
  columns: z.record(z.string(), z.unknown()),
  existing_policy: existingPolicy,
  request_id: z.string(),
  label: z.string(),
  confirmed: z.boolean(),
});

/** @typedef {z.infer<typeof importPreviewShape>} ImportPreviewBody */
/** @typedef {z.infer<typeof importCreateShape>} ImportCreateBody */

/**
 * Owner identity the router passes to every service call.
 * @typedef {{ businessId: string, staffId: string, impersonated_by: string | null }} ImportJobActor
 */

/**
 * Service overrides for tests, typed by what the router hands them; results are
 * forwarded to `res.json` untouched, so test stubs may answer with reduced shapes.
 * @param {{
 *   listCustomerImportJobs?: (actor: ImportJobActor) => Promise<unknown>,
 *   previewCustomerImportJob?: (input: ImportJobActor & { input: ImportPreviewBody }) => Promise<unknown>,
 *   createCustomerImportJob?: (input: ImportJobActor & { input: ImportCreateBody }) => Promise<unknown>,
 *   controlCustomerImportJob?: (input: ImportJobActor & { id: string, action: string }) => Promise<unknown>
 * }} [deps]
 */
export function createCustomerImportJobRoutes(deps = {}) {
  const s = { ...imports, ...deps },
    router = Router(),
    base = "/admin/customer-import-jobs";
  router.use(
    base,
    /** @param {Request} _req @param {Response} res @param {NextFunction} next */
    (_req, res, next) => {
      res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
      next();
    },
    requireStaff,
    requireOwner,
    tenantContext,
  );
  router.use(
    base,
    /** @param {Request} req @param {Response} res @param {NextFunction} next */
    (req, res, next) =>
      Object.keys(req.query).length || (req.method === "GET" && Object.keys(req.body ?? {}).length)
        ? res.status(400).json({ error: "La importación usa el negocio de tu sesión." })
        : next(),
  );
  /** @param {TenantRequest} req */
  const actor = (req) => ({
    businessId: req.tenantId,
    staffId: req.staff.id,
    impersonated_by: req.staff.impersonated_by ?? null,
  });
  router.get(
    base,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res */
      async (req, res) => res.json(await s.listCustomerImportJobs(actor(req))),
    ),
  );
  router.post(
    `${base}/preview`,
    csrfProtect,
    validateRequest(importPreviewShape),
    asyncRoute(
      /** @param {TenantRequest & WithValidated<ImportPreviewBody>} req @param {Response} res */
      async (req, res) =>
        res.json(await s.previewCustomerImportJob({ ...actor(req), input: req.validated })),
    ),
  );
  router.post(
    base,
    csrfProtect,
    validateRequest(importCreateShape),
    asyncRoute(
      /** @param {TenantRequest & WithValidated<ImportCreateBody>} req @param {Response} res */
      async (req, res) =>
        res
          .status(202)
          .json(await s.createCustomerImportJob({ ...actor(req), input: req.validated })),
    ),
  );
  for (const action of ["cancel", "retry"])
    router.post(
      `${base}/:id/${action}`,
      csrfProtect,
      validateParams(uuidParamsSchema),
      asyncRoute(
        /** @param {TenantRequest & WithValidatedParams<UuidParams>} req @param {Response} res */
        async (req, res) => {
          if (Object.keys(req.body ?? {}).length)
            return res.status(400).json({ error: "Esta acción no admite otros datos." });
          return res.json(
            await s.controlCustomerImportJob({
              ...actor(req),
              id: req.validatedParams.id,
              action,
            }),
          );
        },
      ),
    );
  return router;
}
export const customerImportJobRoutes = createCustomerImportJobRoutes();
