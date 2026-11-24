import { Router } from "express";
import { z } from "zod";
import { requireStaff, requireOwner } from "../../middleware/auth.js";
import { tenantContext } from "../../middleware/tenant.js";
import { asyncRoute } from "../../middleware/common.js";
import {
  listTransactionHistory,
  getTransactionExplanation,
  listRejectedAttempts,
  movementKinds,
  transactionHistoryFilters,
  validHistoryInterval,
} from "../services/transaction-explanation-service.js";
import { errorStatus } from "../../utils/error-shape.js";

/** @typedef {import("./_request-types.js").Request} Request */
/** @typedef {import("./_request-types.js").Response} Response */
/** @typedef {import("./_request-types.js").NextFunction} NextFunction */
/**
 * @template [P=import("./_request-types.js").ParamsDictionary]
 * @typedef {import("./_request-types.js").TenantRequest<P>} TenantRequest
 */

const empty = z.object({}).strict();
const query = z
  .object({
    limit: z
      .string()
      .regex(/^\d{1,2}$/)
      .transform(Number)
      .pipe(z.number().min(1).max(50))
      .optional()
      .prefault("25"),
    cursor: z.string().min(1).max(400).optional(),
    kind: z
      .string()
      .refine((value) => movementKinds.includes(value))
      .optional()
      .default("all"),
  })
  .merge(transactionHistoryFilters)
  .strict()
  .refine(validHistoryInterval);

/** @typedef {z.infer<typeof query>} TransactionHistoryQuery */

/**
 * Services the router calls, by the input it hands them. Unit tests inject
 * fakes, so results are forwarded opaquely (`res.json`).
 * @typedef {{
 *   listRejectedAttempts: (input: { businessId: string }) => Promise<unknown>,
 *   listTransactionHistory: (input: { businessId: string } & TransactionHistoryQuery) => Promise<unknown>,
 *   getTransactionExplanation: (input: { businessId: string, id: string }) => Promise<unknown>
 * }} TransactionExplanationDeps
 */

/** @param {Request} _req @param {Response} res @param {NextFunction} next */
function noStore(_req, res, next) {
  res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  next();
}
/** @param {Request} req */
function hasBody(req) {
  return (
    Number(req.get("Content-Length") || 0) > 0 ||
    req.get("Transfer-Encoding") ||
    !empty.safeParse(req.body ?? {}).success
  );
}
/** @param {Response} res */
function invalid(res) {
  return res.status(400).json({
    error: "Revisa el ID, los filtros y la página solicitada. Esta consulta no acepta cuerpo.",
    code: "VALIDATION_ERROR",
  });
}
/**
 * @param {Response} res
 * @param {() => Promise<unknown>} fn
 */
async function respond(res, fn) {
  try {
    return res.json(await fn());
  } catch (error) {
    const status = errorStatus(error);
    if (status && status < 500) throw error;
    return res.status(503).json({
      error: "No se pudo consultar el historial. Vuelve a intentar.",
      code: "TRANSACTION_HISTORY_UNAVAILABLE",
    });
  }
}
/** @param {Partial<TransactionExplanationDeps>} [deps] */
export function createTransactionExplanationRoutes(deps = {}) {
  const router = Router(),
    guards = [noStore, requireStaff, requireOwner, tenantContext];
  router.get(
    "/admin/transaction-rejections",
    ...guards,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res */
      async (req, res) => {
        if (!empty.safeParse(req.query).success || hasBody(req)) return invalid(res);
        return respond(res, () =>
          (deps.listRejectedAttempts ?? listRejectedAttempts)({ businessId: req.tenantId }),
        );
      },
    ),
  );
  router.get(
    "/admin/transaction-history",
    ...guards,
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res */
      async (req, res) => {
        const parsed = query.safeParse(req.query);
        if (!parsed.success || hasBody(req)) return invalid(res);
        return respond(res, () =>
          (deps.listTransactionHistory ?? listTransactionHistory)({
            businessId: req.tenantId,
            ...parsed.data,
          }),
        );
      },
    ),
  );
  router.get(
    "/admin/transaction-history/:id",
    ...guards,
    asyncRoute(
      /** @param {TenantRequest<{ id: string }>} req @param {Response} res */
      async (req, res) => {
        if (
          !z.guid().safeParse(req.params.id).success ||
          !empty.safeParse(req.query).success ||
          hasBody(req)
        )
          return invalid(res);
        return respond(res, () =>
          (deps.getTransactionExplanation ?? getTransactionExplanation)({
            businessId: req.tenantId,
            id: req.params.id,
          }),
        );
      },
    ),
  );
  return router;
}
export const transactionExplanationRoutes = createTransactionExplanationRoutes();
