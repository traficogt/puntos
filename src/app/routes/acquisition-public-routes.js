import { Router } from "express";
import { z } from "zod";
import { asyncRoute } from "../../middleware/common.js";
import { moderateRateLimit } from "../../middleware/rate-limit.js";
import { BusinessRepo } from "../repositories/business-repository.js";
import { AcquisitionService, sourceCodePattern } from "../services/acquisition-service.js";

/** @typedef {import("./_request-types.js").Request} Request */
/** @typedef {import("./_request-types.js").Response} Response */
/** @typedef {import("./_request-types.js").NextFunction} NextFunction */
/**
 * @template P
 * @typedef {import("./_request-types.js").ParamsRequest<P>} ParamsRequest
 */

const visitSchema = z.object({ source_code: z.string().max(80) }).strict();
/** @typedef {import("../services/acquisition-link.js").AcquisitionBusiness} AcquisitionBusiness */
/**
 * The router only passes the business through to `visit`; both use the
 * acquisition service's own business shape.
 * @param {{
 *   getBusiness?: (slug: string) => Promise<AcquisitionBusiness | null | undefined>,
 *   visit?: (business: AcquisitionBusiness, code: string) => Promise<unknown>,
 *   rateLimit?: import("express").RequestHandler
 * }} [deps]
 */
export function createAcquisitionPublicRoutes({
  getBusiness = (slug) => BusinessRepo.getPublicBySlug(slug),
  visit = (business, code) => AcquisitionService.visit(business, code),
  rateLimit = moderateRateLimit,
} = {}) {
  const router = Router();
  router.post(
    "/public/business/:slug/acquisition/visit",
    /** @param {Request} _req @param {Response} res @param {NextFunction} next */
    (_req, res, next) => {
      res.set("Cache-Control", "no-store");
      next();
    },
    rateLimit,
    asyncRoute(
      /** @param {ParamsRequest<{ slug: string }>} req @param {Response} res */
      async (req, res) => {
        const parsed = visitSchema.safeParse(req.body);
        if (!req.is("application/json") || Object.keys(req.query).length || !parsed.success)
          return res.status(400).json({ error: "Origen no válido." });
        if (!sourceCodePattern.test(parsed.data.source_code))
          return res.json({ ok: true, visit_token: null });
        const business = await getBusiness(req.params.slug);
        if (!business) return res.json({ ok: true, visit_token: null });
        return res.json(await visit(business, parsed.data.source_code));
      },
    ),
  );
  return router;
}
export const acquisitionPublicRoutes = createAcquisitionPublicRoutes();
