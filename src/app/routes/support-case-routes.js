import { Router } from "express";
import { z } from "zod";
import { asyncRoute } from "../../middleware/common.js";
import { csrfProtect } from "../../middleware/csrf.js";
import { requireSuperAdmin } from "../../middleware/auth.js";
import { rateLimitByIp } from "../../middleware/rate-limit.js";
import { getRequestIp } from "../../utils/request-ip.js";
import { config } from "../../config/index.js";
import { withDbClientContext, dbQuery } from "../database.js";
import { browserSessionStatus, getBrowserSession } from "../services/auth-session-service.js";
import { verifyTurnstile } from "../services/contact-service.js";
import {
  createSupportCase,
  trackSupportCase,
  replySupportCase,
  listSupportCases,
  getSupportCase,
  updateSupportCase,
  getSupportAttachment,
  supportTrackSchema,
} from "../services/support-case-service.js";

/** @typedef {import("./_request-types.js").Request} Request */
/** @typedef {import("./_request-types.js").Response} Response */
/** @typedef {import("./_request-types.js").NextFunction} NextFunction */
/**
 * @template P
 * @typedef {import("./_request-types.js").ParamsRequest<P>} ParamsRequest
 */
/**
 * Account context attached to a public support case when the visitor opted in
 * (`includeAccount`) and holds a valid staff or customer browser session.
 * @typedef {{ businessId: string, actorType: "STAFF" | "CUSTOMER", actorId: string }} SupportContext
 */
/**
 * Collaborators of the router. `serviceDeps` is forwarded to every
 * support-case service call (tests inject a database handle through it).
 * @typedef {{
 *   verifyChallenge?: (token: string, remoteIp: string) => Promise<boolean>,
 *   resolveContext?: (req: Request) => Promise<SupportContext | null>,
 *   serviceDeps?: Record<string, unknown>
 * }} SupportCaseRouteDeps
 */

/**
 * @param {Request} req
 * @returns {Promise<SupportContext | null>}
 */
export async function verifiedSupportContext(req) {
  if (req.body?.includeAccount !== true) return null;
  for (const [cookie, actorType] of /** @type {Array<[string, "STAFF" | "CUSTOMER"]>} */ ([
    [config.STAFF_COOKIE_NAME, "STAFF"],
    [config.CUSTOMER_COOKIE_NAME, "CUSTOMER"],
  ])) {
    if (!req.cookies?.[cookie]) continue;
    const session = await getBrowserSession(req.cookies[cookie]);
    if (
      !browserSessionStatus(session).ok ||
      session.actor_type !== actorType ||
      !session.business_id
    )
      continue;
    const valid = await withDbClientContext(
      { tenantId: session.business_id, platformAdmin: false },
      async () => {
        const result =
          actorType === "STAFF"
            ? await dbQuery(
                "SELECT id FROM staff_users WHERE id=$1 AND business_id=$2 AND active=true",
                [session.actor_id, session.business_id],
              )
            : await dbQuery(
                "SELECT id FROM customers WHERE id=$1 AND business_id=$2 AND deleted_at IS NULL",
                [session.actor_id, session.business_id],
              );
        return Boolean(result.rows[0]);
      },
    );
    if (valid) return { businessId: session.business_id, actorType, actorId: session.actor_id };
  }
  return null;
}
/** @param {SupportCaseRouteDeps} [deps] */
export function createSupportCaseRoutes({
  verifyChallenge = verifyTurnstile,
  resolveContext = verifiedSupportContext,
  serviceDeps = {},
} = {}) {
  const routes = Router();
  const createLimit = rateLimitByIp(8, 60 * 60 * 1000, { keyPrefix: "support:create:" });
  const readLimit = rateLimitByIp(60, 60 * 1000, { keyPrefix: "support:read:" });
  const replyLimit = rateLimitByIp(20, 60 * 60 * 1000, { keyPrefix: "support:reply:" });
  routes.use(
    ["/public/support", "/super/support"],
    /** @param {Request} _req @param {Response} res @param {NextFunction} next */
    (_req, res, next) => {
      res.set({
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "X-Robots-Tag": "noindex",
      });
      next();
    },
  );
  routes.get(
    "/public/support/config",
    /** @param {Request} _req @param {Response} res */
    (_req, res) =>
      res.json({
        challengeRequired: Boolean(config.CONTACT_TURNSTILE_SECRET),
        siteKey: config.CONTACT_TURNSTILE_SITE_KEY,
        attachmentMaxBytes: 614400,
      }),
  );
  routes.post(
    "/public/support/cases",
    createLimit,
    csrfProtect,
    asyncRoute(
      /** @param {Request} req @param {Response} res @returns {Promise<void | Response>} */
      async (req, res) => {
        const context = await resolveContext(req);
        const out = await createSupportCase(req.body, {
          ...serviceDeps,
          context,
          /** @param {string} token */
          verify: (token) => verifyChallenge(token, getRequestIp(req)).catch(() => false),
        });
        res.status(out.replayed ? 200 : 201).json(out);
      },
    ),
  );
  routes.post(
    "/public/support/track",
    readLimit,
    csrfProtect,
    asyncRoute(
      /** @param {Request} req @param {Response} res */
      async (req, res) => res.json(await trackSupportCase(req.body, serviceDeps)),
    ),
  );
  routes.post(
    "/public/support/reply",
    replyLimit,
    csrfProtect,
    asyncRoute(
      /** @param {Request} req @param {Response} res */
      async (req, res) => res.json(await replySupportCase(req.body, serviceDeps)),
    ),
  );
  routes.post(
    "/public/support/attachment",
    readLimit,
    csrfProtect,
    asyncRoute(
      /** @param {Request} req @param {Response} res @returns {Promise<void | Response>} */
      async (req, res) => {
        const parsed = supportTrackSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ error: "Enlace privado inválido." });
        const row = await getSupportAttachment(parsed.data, serviceDeps);
        res
          .type(row.content_type)
          .set("Content-Disposition", 'inline; filename="captura.webp"')
          .send(row.data);
      },
    ),
  );
  routes.use("/super/support", requireSuperAdmin, csrfProtect);
  routes.get(
    "/super/support/cases",
    asyncRoute(
      /** @param {Request} req @param {Response} res @returns {Promise<void | Response>} */
      async (req, res) => {
        const query = z
          .object({
            status: z.enum(["new", "open", "waiting", "resolved", "closed"]).optional(),
            offset: z.coerce.number().int().min(0).max(100000).optional(),
          })
          .strict()
          .safeParse(req.query);
        if (!query.success) return res.status(400).json({ error: "Filtro inválido." });
        res.json({ cases: await listSupportCases(query.data, serviceDeps) });
      },
    ),
  );
  routes.post(
    "/super/support/search",
    asyncRoute(
      /** @param {Request} req @param {Response} res @returns {Promise<void | Response>} */
      async (req, res) => {
        const query = z
          .object({
            status: z.enum(["new", "open", "waiting", "resolved", "closed"]).optional(),
            search: z.string().max(160).optional(),
            offset: z.number().int().min(0).max(100000).optional(),
          })
          .strict()
          .safeParse(req.body);
        if (!query.success) return res.status(400).json({ error: "Filtro inválido." });
        res.json({ cases: await listSupportCases(query.data, serviceDeps) });
      },
    ),
  );
  routes.get(
    "/super/support/cases/:id",
    asyncRoute(
      /** @param {ParamsRequest<{ id: string }>} req @param {Response} res @returns {Promise<void | Response>} */
      async (req, res) => {
        if (!z.uuid().safeParse(req.params.id).success)
          return res.status(400).json({ error: "Caso inválido." });
        res.json(await getSupportCase(req.params.id, serviceDeps));
      },
    ),
  );
  routes.patch(
    "/super/support/cases/:id",
    asyncRoute(
      /** @param {ParamsRequest<{ id: string }>} req @param {Response} res @returns {Promise<void | Response>} */
      async (req, res) => {
        if (!z.uuid().safeParse(req.params.id).success)
          return res.status(400).json({ error: "Caso inválido." });
        res.json(
          await updateSupportCase(req.params.id, req.body, req.superAdmin.email, serviceDeps),
        );
      },
    ),
  );
  routes.get(
    "/super/support/cases/:id/attachment",
    asyncRoute(
      /** @param {ParamsRequest<{ id: string }>} req @param {Response} res @returns {Promise<void | Response>} */
      async (req, res) => {
        if (!z.uuid().safeParse(req.params.id).success)
          return res.status(400).json({ error: "Caso inválido." });
        const row = await getSupportAttachment({ caseId: req.params.id }, serviceDeps);
        res
          .type(row.content_type)
          .set("Content-Disposition", 'inline; filename="captura.webp"')
          .send(row.data);
      },
    ),
  );
  return routes;
}
export const supportCaseRoutes = createSupportCaseRoutes();
