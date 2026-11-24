import {
  listOperatingTemplates,
  approveOperatingTemplate,
  triggerOperatingTemplate,
  revokeOperatingTemplate,
  ApproveOperatingTemplateInput,
  TriggerOperatingTemplateInput,
  RevokeOperatingTemplateInput,
} from "../services/operating-template-service.js";
import { Router } from "express";
import { z } from "zod";
import { requireStaff, requireOwner } from "../../middleware/auth.js";
import { tenantContext } from "../../middleware/tenant.js";
import { csrfProtect } from "../../middleware/csrf.js";
import { asyncRoute } from "../../middleware/common.js";
import {
  getDecisionInbox,
  getDelegatedDecisionInbox,
  getDecisionHistory,
  reviewDecision,
  setOperatingMode,
  ReviewDecisionInput,
  OperatingModeInput,
} from "../services/merchant-decisions-service.js";

/** @typedef {import("./_request-types.js").Request} Request */
/** @typedef {import("./_request-types.js").Response} Response */
/** @typedef {import("./_request-types.js").NextFunction} NextFunction */
/**
 * @template [P=import("./_request-types.js").ParamsDictionary]
 * @typedef {import("./_request-types.js").TenantRequest<P>} TenantRequest
 */
/**
 * The acting staff member as the decision services receive it.
 * @typedef {{
 *   businessId: string,
 *   staffId: string,
 *   staff: TenantRequest["staff"],
 *   ip: string | undefined,
 *   ua: string | null,
 *   impersonated_by: string | null
 * }} DecisionActor
 */
/** @typedef {z.infer<typeof ReviewDecisionInput>} ReviewDecisionBody */
/** @typedef {z.infer<typeof OperatingModeInput>} OperatingModeBody */
/** @typedef {z.infer<typeof ApproveOperatingTemplateInput>} ApproveOperatingTemplateBody */
/** @typedef {z.infer<typeof TriggerOperatingTemplateInput>} TriggerOperatingTemplateBody */
/** @typedef {z.infer<typeof RevokeOperatingTemplateInput>} RevokeOperatingTemplateBody */
/**
 * Services the router calls, by the input it hands them. Unit tests inject
 * fakes, so results are forwarded opaquely (`res.json`).
 * @typedef {{
 *   getDecisionInbox: (input: { businessId: string }) => Promise<unknown>,
 *   getDelegatedDecisionInbox: (input: DecisionActor) => Promise<unknown>,
 *   getDecisionHistory: (input: DecisionActor & { decisionKey: string, delegated?: boolean }) => Promise<unknown>,
 *   reviewDecision: (input: DecisionActor & { input: ReviewDecisionBody, delegated?: boolean }) => Promise<unknown>,
 *   setOperatingMode: (input: DecisionActor & { input: OperatingModeBody, delegated?: boolean }) => Promise<unknown>,
 *   listOperatingTemplates: (input: DecisionActor & { delegated?: boolean }) => Promise<unknown>,
 *   approveOperatingTemplate: (input: DecisionActor & { input: ApproveOperatingTemplateBody }) => Promise<unknown>,
 *   triggerOperatingTemplate: (input: DecisionActor & { input: TriggerOperatingTemplateBody, delegated?: boolean }) => Promise<unknown>,
 *   revokeOperatingTemplate: (input: DecisionActor & { input: RevokeOperatingTemplateBody }) => Promise<unknown>
 * }} MerchantDecisionsDeps
 */
/**
 * One owner template action. `service` is declared as a method so the three
 * entries keep their own body types while the table stays homogeneous (the
 * schema validates the body at runtime).
 * @typedef {{
 *   suffix: string,
 *   schema: z.ZodType,
 *   service(input: DecisionActor & { input: unknown }): Promise<unknown>
 * }} TemplateAction
 */

/** @param {Partial<MerchantDecisionsDeps>} [deps] */
export function createMerchantDecisionsRoutes(deps = {}) {
  /** @type {MerchantDecisionsDeps} */
  const s = {
      getDecisionInbox,
      getDelegatedDecisionInbox,
      getDecisionHistory,
      reviewDecision,
      setOperatingMode,
      listOperatingTemplates,
      approveOperatingTemplate,
      triggerOperatingTemplate,
      revokeOperatingTemplate,
      ...deps,
    },
    router = Router(),
    base = "/admin/decisions",
    empty = z.object({}).strict();
  /** @param {TenantRequest} req @returns {DecisionActor} */
  const actor = (req) => ({
    businessId: req.tenantId,
    staffId: req.staff.id,
    staff: req.staff,
    ip: req.ip,
    ua: req.get("user-agent") ?? null,
    impersonated_by: req.staff.impersonated_by ?? null,
  });
  /** @param {Response} res */
  const invalid = (res) =>
    res
      .status(400)
      .json({ error: "Revisa los datos de esta solicitud.", code: "VALIDATION_ERROR" });
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
  router.get(
    base,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res @returns {Promise<void | Response>} */
      async (req, res) => {
        if (!empty.safeParse(req.query).success || !empty.safeParse(req.body ?? {}).success)
          return invalid(res);
        res.json(await s.getDecisionInbox({ businessId: req.tenantId }));
      },
    ),
  );
  router.post(
    `${base}/review`,
    csrfProtect,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res @returns {Promise<void | Response>} */
      async (req, res) => {
        const input = ReviewDecisionInput.safeParse(req.body);
        if (!input.success || !empty.safeParse(req.query).success) return invalid(res);
        res.json(await s.reviewDecision({ ...actor(req), input: input.data }));
      },
    ),
  );
  router.post(
    `${base}/operating-mode`,
    csrfProtect,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res @returns {Promise<void | Response>} */
      async (req, res) => {
        const input = OperatingModeInput.safeParse(req.body);
        if (!input.success || !empty.safeParse(req.query).success) return invalid(res);
        res.json(await s.setOperatingMode({ ...actor(req), input: input.data }));
      },
    ),
  );
  router.get(
    `${base}/history/:key`,
    asyncRoute(
      /** @param {TenantRequest<{ key: string }>} req @param {Response} res @returns {Promise<void | Response>} */
      async (req, res) => {
        if (!/^[a-z_-]{1,80}$/.test(req.params.key) || !empty.safeParse(req.query).success)
          return invalid(res);
        res.json(await s.getDecisionHistory({ ...actor(req), decisionKey: req.params.key }));
      },
    ),
  );
  router.get(
    `${base}/templates`,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res @returns {Promise<void | Response>} */
      async (req, res) => {
        if (!empty.safeParse(req.query).success) return invalid(res);
        res.json(await s.listOperatingTemplates(actor(req)));
      },
    ),
  );
  /** @type {TemplateAction[]} */
  const templateActions = [
    {
      suffix: "approve",
      schema: ApproveOperatingTemplateInput,
      service: s.approveOperatingTemplate,
    },
    {
      suffix: "trigger",
      schema: TriggerOperatingTemplateInput,
      service: s.triggerOperatingTemplate,
    },
    { suffix: "revoke", schema: RevokeOperatingTemplateInput, service: s.revokeOperatingTemplate },
  ];
  for (const { suffix, schema, service } of templateActions)
    router.post(
      `${base}/templates/${suffix}`,
      csrfProtect,
      asyncRoute(
        /** @param {TenantRequest} req @param {Response} res @returns {Promise<void | Response>} */
        async (req, res) => {
          const input = schema.safeParse(req.body);
          if (!input.success || !empty.safeParse(req.query).success) return invalid(res);
          res.json(await service({ ...actor(req), input: input.data }));
        },
      ),
    );
  router.use(
    ["/staff/decisions", "/staff/operating-mode"],
    /** @param {Request} _req @param {Response} res @param {NextFunction} next */
    (_req, res, next) => {
      res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
      next();
    },
    requireStaff,
    tenantContext,
  );
  router.get(
    "/staff/decisions",
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res @returns {Promise<void | Response>} */
      async (req, res) => {
        if (!empty.safeParse(req.query).success) return invalid(res);
        res.json(await s.getDelegatedDecisionInbox(actor(req)));
      },
    ),
  );
  router.get(
    "/staff/decisions/history/:key",
    asyncRoute(
      /** @param {TenantRequest<{ key: string }>} req @param {Response} res @returns {Promise<void | Response>} */
      async (req, res) => {
        if (!/^[a-z_-]{1,80}$/.test(req.params.key) || !empty.safeParse(req.query).success)
          return invalid(res);
        res.json(
          await s.getDecisionHistory({
            ...actor(req),
            decisionKey: req.params.key,
            delegated: true,
          }),
        );
      },
    ),
  );
  router.post(
    "/staff/decisions/review",
    csrfProtect,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res @returns {Promise<void | Response>} */
      async (req, res) => {
        const input = ReviewDecisionInput.safeParse(req.body);
        if (!input.success || !empty.safeParse(req.query).success) return invalid(res);
        res.json(await s.reviewDecision({ ...actor(req), delegated: true, input: input.data }));
      },
    ),
  );
  router.get(
    "/staff/operating-mode",
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res @returns {Promise<void | Response>} */
      async (req, res) => {
        if (!empty.safeParse(req.query).success) return invalid(res);
        res.json(await s.listOperatingTemplates({ ...actor(req), delegated: true }));
      },
    ),
  );
  router.post(
    "/staff/operating-mode",
    csrfProtect,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res @returns {Promise<void | Response>} */
      async (req, res) => {
        const input = OperatingModeInput.safeParse(req.body);
        if (!input.success || !empty.safeParse(req.query).success) return invalid(res);
        res.json(await s.setOperatingMode({ ...actor(req), delegated: true, input: input.data }));
      },
    ),
  );
  router.post(
    "/staff/operating-mode/trigger",
    csrfProtect,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res @returns {Promise<void | Response>} */
      async (req, res) => {
        const input = TriggerOperatingTemplateInput.safeParse(req.body);
        if (!input.success || !empty.safeParse(req.query).success) return invalid(res);
        res.json(
          await s.triggerOperatingTemplate({ ...actor(req), delegated: true, input: input.data }),
        );
      },
    ),
  );
  return router;
}
export const merchantDecisionsRoutes = createMerchantDecisionsRoutes();
