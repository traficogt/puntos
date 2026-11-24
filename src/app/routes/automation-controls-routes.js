import {
  SecondVisitSettings,
  getSecondVisitControls,
  saveSecondVisitSettings,
} from "../services/second-visit-service.js";
import {
  WeeklyBriefSettings,
  getWeeklyBriefControls,
  saveWeeklyBriefSettings,
  previewWeeklyOwnerBrief,
  retryWeeklyOwnerBrief,
  requestOwnerBriefEmailVerification,
  confirmOwnerBriefEmailVerification,
  requestWeeklyOwnerBriefTest,
} from "../services/weekly-owner-brief-service.js";
import { Router } from "express";
import { z } from "zod";
import { requireStaff, requireOwner } from "../../middleware/auth.js";
import { tenantContext } from "../../middleware/tenant.js";
import { requirePlanFeature } from "../../middleware/plan-feature.js";
import { csrfProtect } from "../../middleware/csrf.js";
import { asyncRoute } from "../../middleware/common.js";
import {
  AutomationSettings,
  getAutomationControls,
  saveAutomationSettings,
} from "../services/automation-controls-service.js";

/** @typedef {import("./_request-types.js").Request} Request */
/** @typedef {import("./_request-types.js").Response} Response */
/** @typedef {import("./_request-types.js").NextFunction} NextFunction */
/** @typedef {import("./_request-types.js").TenantRequest} TenantRequest */
/**
 * The acting owner as the automation services receive it.
 * @typedef {{
 *   businessId: string,
 *   staffId: string,
 *   ip: string | undefined,
 *   ua: string | null,
 *   impersonated_by?: string
 * }} AutomationActor
 */
/** @typedef {z.infer<typeof AutomationSettings>} AutomationSettingsInput */
/** @typedef {z.infer<typeof SecondVisitSettings>} SecondVisitSettingsInput */
/** @typedef {z.infer<typeof WeeklyBriefSettings>} WeeklyBriefSettingsInput */
/** @typedef {(input: AutomationActor) => Promise<unknown>} AutomationRead */
/**
 * A settings saver as the control table sees it: the paired schema has already
 * validated `settings`, so the table widens it to `unknown`.
 * @typedef {(input: AutomationActor & { settings: unknown }) => Promise<unknown>} AutomationSave
 */
/** @typedef {(input: AutomationActor & { requestId: string, token?: string }) => Promise<unknown>} OwnerBriefAction */
/**
 * Services the router calls, by the input it hands them. Unit tests inject
 * fakes, so results are forwarded opaquely (`res.json`).
 * @typedef {{
 *   getAutomationControls: (input: { businessId: string }) => Promise<unknown>,
 *   saveAutomationSettings: (input: AutomationActor & { settings: AutomationSettingsInput }) => Promise<unknown>,
 *   getSecondVisitControls: AutomationRead,
 *   saveSecondVisitSettings: (input: AutomationActor & { settings: SecondVisitSettingsInput }) => Promise<unknown>,
 *   getWeeklyBriefControls: AutomationRead,
 *   saveWeeklyBriefSettings: (input: AutomationActor & { settings: WeeklyBriefSettingsInput }) => Promise<unknown>,
 *   previewWeeklyOwnerBrief: AutomationRead,
 *   retryWeeklyOwnerBrief: (input: AutomationActor & { id: string }) => Promise<unknown>,
 *   requestOwnerBriefEmailVerification: OwnerBriefAction,
 *   confirmOwnerBriefEmailVerification: OwnerBriefAction,
 *   requestWeeklyOwnerBriefTest: OwnerBriefAction
 * }} AutomationControlsDeps
 */

const Empty = z.object({}).strict();
/** @param {Partial<AutomationControlsDeps>} [deps] */
export function createAutomationControlsRoutes(deps = {}) {
  const router = Router();
  const base = "/admin/automations";
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
    requirePlanFeature("lifecycle_automation"),
  );
  router.get(
    base,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res */
      async (req, res) => {
        if (
          !Empty.safeParse(req.query).success ||
          !Empty.safeParse(req.body ?? {}).success ||
          req.get("Transfer-Encoding") ||
          Number(req.get("Content-Length") || 0) > 0
        )
          return res.status(400).json({
            error: "Esta consulta no acepta parámetros ni cuerpo.",
            code: "VALIDATION_ERROR",
          });
        return res.json(
          await (deps.getAutomationControls ?? getAutomationControls)({
            businessId: req.tenantId,
          }),
        );
      },
    ),
  );
  router.put(
    base,
    csrfProtect,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res */
      async (req, res) => {
        const parsed = AutomationSettings.safeParse(req.body);
        if (!parsed.success || !Empty.safeParse(req.query).success)
          return res.status(400).json({
            error: "Revisa los límites, el horario y el presupuesto de cada incentivo.",
            code: "VALIDATION_ERROR",
          });
        // The service defaults staffId/ip/ua to null, which TypeScript infers as the
        // only accepted type; the request supplies strings, so assert the router's view.
        return res.json(
          await /** @type {AutomationControlsDeps["saveAutomationSettings"]} */ (
            deps.saveAutomationSettings ?? saveAutomationSettings
          )({
            businessId: req.tenantId,
            staffId: req.staff.id,
            ip: req.ip,
            ua: req.get("user-agent") || null,
            settings: parsed.data,
          }),
        );
      },
    ),
  );
  /** @param {TenantRequest} req @returns {AutomationActor} */
  const actor = (req) => ({
    businessId: req.tenantId,
    staffId: req.staff.id,
    ip: req.ip,
    ua: req.get("user-agent") || null,
    ...(req.staff.impersonated_by ? { impersonated_by: req.staff.impersonated_by } : {}),
  });
  /** @param {Response} res */
  const invalid = (res) =>
    res
      .status(400)
      .json({ error: "Revisa los datos de esta solicitud.", code: "VALIDATION_ERROR" });
  // Each row pairs a schema with the saver that accepts its output; the table type
  // widens `settings` because TypeScript cannot correlate the two columns.
  for (const [
    suffix,
    schema,
    read,
    save,
  ] of /** @type {Array<[string, z.ZodType, AutomationRead, AutomationSave]>} */ ([
    [
      "second-visit",
      SecondVisitSettings,
      deps.getSecondVisitControls ?? getSecondVisitControls,
      deps.saveSecondVisitSettings ?? saveSecondVisitSettings,
    ],
    [
      "owner-brief",
      WeeklyBriefSettings,
      deps.getWeeklyBriefControls ?? getWeeklyBriefControls,
      deps.saveWeeklyBriefSettings ?? saveWeeklyBriefSettings,
    ],
  ])) {
    router.get(
      `${base}/${suffix}`,
      asyncRoute(
        /** @param {TenantRequest} req @param {Response} res */
        async (req, res) => {
          if (
            !Empty.safeParse(req.query).success ||
            !Empty.safeParse(req.body ?? {}).success ||
            req.get("Transfer-Encoding") ||
            Number(req.get("Content-Length") || 0) > 0
          )
            return invalid(res);
          return res.json(await read(actor(req)));
        },
      ),
    );
    router.put(
      `${base}/${suffix}`,
      csrfProtect,
      asyncRoute(
        /** @param {TenantRequest} req @param {Response} res */
        async (req, res) => {
          const parsed = schema.safeParse(req.body);
          if (!parsed.success || !Empty.safeParse(req.query).success) return invalid(res);
          return res.json(await save({ ...actor(req), settings: parsed.data }));
        },
      ),
    );
  }
  router.post(
    `${base}/owner-brief/preview`,
    csrfProtect,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res */
      async (req, res) => {
        if (!Empty.safeParse(req.query).success || !Empty.safeParse(req.body ?? {}).success)
          return invalid(res);
        return res.json(
          await (deps.previewWeeklyOwnerBrief ?? previewWeeklyOwnerBrief)(actor(req)),
        );
      },
    ),
  );
  const Request = z.object({ request_id: z.guid() }).strict();
  /** @type {Array<[string, z.ZodType<{ request_id: string, token?: string }>, OwnerBriefAction]>} */
  const ownerBriefActions = [
    [
      "email-verification/request",
      Request,
      deps.requestOwnerBriefEmailVerification ?? requestOwnerBriefEmailVerification,
    ],
    [
      "email-verification/confirm",
      Request.extend({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }),
      deps.confirmOwnerBriefEmailVerification ?? confirmOwnerBriefEmailVerification,
    ],
    ["test", Request, deps.requestWeeklyOwnerBriefTest ?? requestWeeklyOwnerBriefTest],
  ];
  for (const [suffix, schema, action] of ownerBriefActions)
    router.post(
      `${base}/owner-brief/${suffix}`,
      csrfProtect,
      asyncRoute(
        /** @param {TenantRequest} req @param {Response} res */
        async (req, res) => {
          const parsed = schema.safeParse(req.body);
          if (!parsed.success || !Empty.safeParse(req.query).success) return invalid(res);
          return res.json(
            await action({
              ...actor(req),
              requestId: parsed.data.request_id,
              ...("token" in parsed.data ? { token: parsed.data.token } : {}),
            }),
          );
        },
      ),
    );
  router.post(
    `${base}/owner-brief/:id/retry`,
    csrfProtect,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res */
      async (req, res) => {
        const id = z.guid().safeParse(req.params.id);
        if (
          !id.success ||
          !Empty.safeParse(req.query).success ||
          !Empty.safeParse(req.body ?? {}).success
        )
          return invalid(res);
        return res.json(
          await (deps.retryWeeklyOwnerBrief ?? retryWeeklyOwnerBrief)({
            ...actor(req),
            id: id.data,
          }),
        );
      },
    ),
  );
  return router;
}
