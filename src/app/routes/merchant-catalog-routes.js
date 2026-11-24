import { Router } from "express";
import { z } from "zod";
import { requireStaff, requireOwner } from "../../middleware/auth.js";
import { tenantContext } from "../../middleware/tenant.js";
import { csrfProtect } from "../../middleware/csrf.js";
import { asyncRoute } from "../../middleware/common.js";
import * as services from "../services/merchant-catalog-service.js";
import { catalogListSchema } from "../services/merchant-catalog-model.js";

/** @typedef {import("./_request-types.js").Request} Request */
/** @typedef {import("./_request-types.js").Response} Response */
/** @typedef {import("./_request-types.js").NextFunction} NextFunction */
/** @typedef {import("./_request-types.js").TenantRequest} TenantRequest */
/** @typedef {z.infer<typeof catalogListSchema>} CatalogListQuery */
/** @typedef {{ businessId: string, staff: TenantRequest["staff"] }} CatalogActor */

/**
 * Services the router calls, by the input it hands them. Unit tests inject
 * fakes, so results are forwarded opaquely (`res.json`). Bodies of the item and
 * CSV endpoints are validated by the services (`input` is the raw body).
 * @typedef {{
 *   listMerchantCatalog: (input: CatalogActor & CatalogListQuery) => Promise<unknown>,
 *   saveManualCatalogItem: (input: CatalogActor & { input: unknown }) => Promise<unknown>,
 *   previewCatalogCsv: (input: CatalogActor & { input: unknown }) => Promise<unknown>,
 *   importCatalogCsv: (input: CatalogActor & { input: unknown }) => Promise<unknown>
 * }} MerchantCatalogDeps
 */

const empty = z.object({}).strict();
/** @param {Response} res */
const invalid = (res) =>
  res
    .status(400)
    .json({ error: "Revisa los campos y la paginación del catálogo.", code: "VALIDATION_ERROR" });
/** @param {Partial<MerchantCatalogDeps>} [deps] */
export function createMerchantCatalogRoutes(deps = {}) {
  const router = Router(),
    /** @type {MerchantCatalogDeps} */
    s = { ...services, ...deps },
    base = "/admin/merchant-catalog";
  router.use(
    base,
    /** @param {Request} _req @param {Response} res @param {NextFunction} next */
    (_req, res, next) => {
      res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
      next();
    },
    requireStaff,
    tenantContext,
    requireOwner,
  );
  /** @param {TenantRequest} req @returns {CatalogActor} */
  const actor = (req) => ({ businessId: req.tenantId, staff: req.staff });
  router.get(
    base,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res @returns {Promise<void | Response>} */
      async (req, res) => {
        const parsed = catalogListSchema.safeParse(req.query);
        if (!parsed.success) return invalid(res);
        res.json(await s.listMerchantCatalog({ ...actor(req), ...parsed.data }));
      },
    ),
  );
  router.put(
    `${base}/items`,
    csrfProtect,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res @returns {Promise<void | Response>} */
      async (req, res) => {
        if (!empty.safeParse(req.query).success) return invalid(res);
        res.json(await s.saveManualCatalogItem({ ...actor(req), input: req.body }));
      },
    ),
  );
  router.post(
    `${base}/csv/preview`,
    csrfProtect,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res @returns {Promise<void | Response>} */
      async (req, res) => {
        if (!empty.safeParse(req.query).success) return invalid(res);
        res.json(await s.previewCatalogCsv({ ...actor(req), input: req.body }));
      },
    ),
  );
  router.post(
    `${base}/csv/import`,
    csrfProtect,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res @returns {Promise<void | Response>} */
      async (req, res) => {
        if (!empty.safeParse(req.query).success) return invalid(res);
        res.json(await s.importCatalogCsv({ ...actor(req), input: req.body }));
      },
    ),
  );
  return router;
}
export const merchantCatalogRoutes = createMerchantCatalogRoutes();
