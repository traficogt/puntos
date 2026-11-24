import { dateTimeSchema } from "../../utils/date-time-schema.js";
import { Router } from "express";
import { z } from "zod";
import { requireStaff, requireOwner } from "../../middleware/auth.js";
import { tenantContext } from "../../middleware/tenant.js";
import { csrfProtect } from "../../middleware/csrf.js";
import { asyncRoute } from "../../middleware/common.js";
import * as services from "../services/staff-delegation-service.js";

/** @typedef {import("./_request-types.js").Request} Request */
/** @typedef {import("./_request-types.js").Response} Response */
/** @typedef {import("./_request-types.js").NextFunction} NextFunction */
/** @typedef {import("./_request-types.js").TenantRequest} TenantRequest */
/** @typedef {{ businessId: string, staff: TenantRequest["staff"] }} StaffDelegationActor */

const uuid = z.guid().transform((value) => value.toLowerCase());
const empty = z.object({}).strict();
/** @param {number} max */
const integer = (max) => z.number().int().positive().max(max);
const grantBody = z
  .object({
    request_id: uuid,
    staff_id: uuid,
    branch_id: uuid.nullable().default(null),
    action: z.enum([
      "restore_redemption",
      "extend_promise",
      "fulfill_promise",
      "operating_mode",
      "offer_template",
    ]),
    per_action_points: integer(100000),
    total_points: integer(1000000),
    starts_at: dateTimeSchema({ offset: true }),
    ends_at: dateTimeSchema({ offset: true }),
    max_actions: integer(100000).optional(),
    frequency_limit: integer(100000).optional(),
    frequency_minutes: integer(44640).optional(),
    per_action_cost: z.number().nonnegative().max(10000000).optional(),
    total_cost: z.number().nonnegative().max(10000000).optional(),
  })
  .strict();
const noticeFields = {
  title: z.string().trim().min(1).max(100),
  body: z.string().trim().min(1).max(600),
  branch_id: uuid.nullable().default(null),
  expires_at: dateTimeSchema({ offset: true }),
};
const noticeBody = z.object(noticeFields).strict();
const noticeEdit = z.object({ ...noticeFields, expected_version: integer(2147483646) }).strict();
const acknowledgement = z.object({ version: integer(2147483646) }).strict();
const pagination = z
  .object({
    offset: z
      .string()
      .regex(/^(0|[1-9]\d*)$/)
      .default("0")
      .transform(Number)
      .pipe(z.number().int().max(100000)),
  })
  .strict();

/** @typedef {z.infer<typeof grantBody>} ServiceGrantBody */
/** @typedef {z.infer<typeof noticeBody>} ShiftNoticeBody */
/** @typedef {z.infer<typeof pagination>} DelegationPagination */
/** @typedef {ReturnType<typeof noticeInput>} ShiftNoticeInput */

/**
 * Services the router calls, by the input it hands them. Unit tests inject
 * fakes, so results are forwarded opaquely (`res.json`).
 * @typedef {{
 *   listServiceGrants: (input: StaffDelegationActor & DelegationPagination) => Promise<unknown>,
 *   createServiceGrant: (input: StaffDelegationActor & {
 *     requestId: string,
 *     staffId: string,
 *     branchId: string | null,
 *     action: ServiceGrantBody["action"],
 *     perActionPoints: number,
 *     totalPoints: number,
 *     startsAt: string,
 *     endsAt: string,
 *     maxActions: number | undefined,
 *     frequencyLimit: number | undefined,
 *     frequencyMinutes: number | undefined,
 *     perActionCost: number | undefined,
 *     totalCost: number | undefined
 *   }) => Promise<unknown>,
 *   revokeServiceGrant: (input: StaffDelegationActor & { grantId: string }) => Promise<unknown>,
 *   listShiftNotices: (input: StaffDelegationActor) => Promise<unknown>,
 *   publishShiftNotice: (input: StaffDelegationActor & ShiftNoticeInput & {
 *     noticeId?: string,
 *     expectedVersion?: number
 *   }) => Promise<unknown>,
 *   getOwnServiceAuthority: (input: StaffDelegationActor) => Promise<unknown>,
 *   getShiftBriefing: (input: StaffDelegationActor) => Promise<unknown>,
 *   acknowledgeShiftNotice: (input: StaffDelegationActor & {
 *     noticeId: string,
 *     version: number
 *   }) => Promise<unknown>
 * }} StaffDelegationDeps
 */

/** @param {Response} res */
const invalid = (res) =>
  res.status(400).json({ error: "Revisa los datos de la solicitud.", code: "VALIDATION_ERROR" });
/** @param {TenantRequest} req @returns {StaffDelegationActor} */
const actor = (req) => ({ businessId: req.tenantId, staff: req.staff });
/** @param {ShiftNoticeBody} body */
const noticeInput = (body) => ({
  title: body.title,
  body: body.body,
  branchId: body.branch_id,
  expiresAt: body.expires_at,
});
/** @param {Partial<StaffDelegationDeps>} [deps] */
export function createStaffDelegationRoutes(deps = {}) {
  /** @type {StaffDelegationDeps} */
  const s = { ...services, ...deps },
    router = Router();
  for (const path of [
    "/admin/staff-authority",
    "/admin/shift-notices",
    "/staff/service-authority",
    "/staff/shift-briefing",
  ]) {
    router.use(
      path,
      /** @param {Request} _req @param {Response} res @param {NextFunction} next */
      (_req, res, next) => {
        res.set("Cache-Control", "no-store");
        next();
      },
      requireStaff,
      tenantContext,
      ...(path.startsWith("/admin/") ? [requireOwner] : []),
    );
  }
  router.get(
    "/admin/staff-authority",
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res */
      async (req, res) => {
        const parsed = pagination.safeParse(req.query);
        if (!parsed.success) return invalid(res);
        return res.json(await s.listServiceGrants({ ...actor(req), ...parsed.data }));
      },
    ),
  );
  router.post(
    "/admin/staff-authority",
    csrfProtect,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res */
      async (req, res) => {
        const parsed = grantBody.safeParse(req.body);
        if (!parsed.success || !empty.safeParse(req.query).success) return invalid(res);
        const v = parsed.data;
        return res.status(201).json(
          await s.createServiceGrant({
            ...actor(req),
            requestId: v.request_id,
            staffId: v.staff_id,
            branchId: v.branch_id,
            action: v.action,
            perActionPoints: v.per_action_points,
            totalPoints: v.total_points,
            startsAt: v.starts_at,
            endsAt: v.ends_at,
            maxActions: v.max_actions,
            frequencyLimit: v.frequency_limit,
            frequencyMinutes: v.frequency_minutes,
            perActionCost: v.per_action_cost,
            totalCost: v.total_cost,
          }),
        );
      },
    ),
  );
  router.post(
    "/admin/staff-authority/:grantId/revoke",
    csrfProtect,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res */
      async (req, res) => {
        const id = uuid.safeParse(req.params.grantId);
        if (
          !id.success ||
          !empty.safeParse(req.body).success ||
          !empty.safeParse(req.query).success
        )
          return invalid(res);
        return res.json(await s.revokeServiceGrant({ ...actor(req), grantId: id.data }));
      },
    ),
  );
  router.get(
    "/admin/shift-notices",
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res */
      async (req, res) => {
        if (!empty.safeParse(req.query).success) return invalid(res);
        return res.json(await s.listShiftNotices(actor(req)));
      },
    ),
  );
  router.post(
    "/admin/shift-notices",
    csrfProtect,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res */
      async (req, res) => {
        const parsed = noticeBody.safeParse(req.body);
        if (!parsed.success || !empty.safeParse(req.query).success) return invalid(res);
        return res
          .status(201)
          .json(await s.publishShiftNotice({ ...actor(req), ...noticeInput(parsed.data) }));
      },
    ),
  );
  router.put(
    "/admin/shift-notices/:noticeId",
    csrfProtect,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res */
      async (req, res) => {
        const id = uuid.safeParse(req.params.noticeId),
          parsed = noticeEdit.safeParse(req.body);
        if (!id.success || !parsed.success || !empty.safeParse(req.query).success)
          return invalid(res);
        return res.json(
          await s.publishShiftNotice({
            ...actor(req),
            noticeId: id.data,
            expectedVersion: parsed.data.expected_version,
            ...noticeInput(parsed.data),
          }),
        );
      },
    ),
  );
  router.get(
    "/staff/service-authority",
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res */
      async (req, res) => {
        if (!empty.safeParse(req.query).success) return invalid(res);
        return res.json(await s.getOwnServiceAuthority(actor(req)));
      },
    ),
  );
  router.get(
    "/staff/shift-briefing",
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res */
      async (req, res) => {
        if (!empty.safeParse(req.query).success) return invalid(res);
        return res.json(await s.getShiftBriefing(actor(req)));
      },
    ),
  );
  router.post(
    "/staff/shift-briefing/:noticeId/ack",
    csrfProtect,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res */
      async (req, res) => {
        const id = uuid.safeParse(req.params.noticeId),
          parsed = acknowledgement.safeParse(req.body);
        if (!id.success || !parsed.success || !empty.safeParse(req.query).success)
          return invalid(res);
        return res.json(
          await s.acknowledgeShiftNotice({
            ...actor(req),
            noticeId: id.data,
            version: parsed.data.version,
          }),
        );
      },
    ),
  );
  return router;
}
export const staffDelegationRoutes = createStaffDelegationRoutes();
