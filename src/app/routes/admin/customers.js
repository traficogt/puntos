import { Router } from "express";
import { asyncRoute } from "../../../middleware/common.js";
import { requireOwner, requireStaff } from "../../../middleware/auth.js";
import { tenantContext } from "../../../middleware/tenant.js";
import { requirePlanFeature } from "../../../middleware/plan-feature.js";
import { CustomerRepo } from "../../repositories/customer-repository.js";
import { toCSV } from "../../../utils/csv.js";

/** @typedef {import("../_request-types.js").Request} Request */
/** @typedef {import("../_request-types.js").Response} Response */
/** @typedef {import("../_request-types.js").NextFunction} NextFunction */
/**
 * @template [P=import("../_request-types.js").ParamsDictionary]
 * @typedef {import("../_request-types.js").TenantRequest<P>} TenantRequest
 */

export const adminCustomerRoutes = Router();

adminCustomerRoutes.get(
  "/admin/customers.csv",
  requireStaff,
  requireOwner,
  tenantContext,
  requirePlanFeature("customer_export"),
  asyncRoute(
    /** @param {TenantRequest} req @param {Response} res */
    async (req, res) => {
      const rows = await CustomerRepo.listByBusiness(req.tenantId, 5000);
      const csv = toCSV(rows, [
        "id",
        "phone",
        "name",
        "created_at",
        "last_visit_at",
        "points",
        "lifetime_points",
      ]);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="customers.csv"');
      return res.send(csv);
    },
  ),
);

// The directory is a basic owner operation; export retains its existing plan gate.
import { z } from "zod";
import { csrfProtect } from "../../../middleware/csrf.js";
import { CustomerDirectoryRepo } from "../../repositories/customer-directory-repository.js";
const Name = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value));
const Query = z
  .object({
    q: z.string().trim().max(120).default(""),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
const Empty = z.object({}).strict();
const Profile = z.object({ name: Name, previous_name: z.string().max(120).nullable() }).strict();
const Id = z.guid();
/** @param {Response} res */
const invalid = (res) =>
  res.status(400).json({
    error: "Revisa el nombre, la búsqueda y el número de página.",
    code: "VALIDATION_ERROR",
  });
/** @param {Pick<typeof CustomerDirectoryRepo, "list" | "get" | "updateName">} [repo] */
export function createCustomerDirectoryRouter(repo = CustomerDirectoryRepo) {
  const router = Router();
  router.use(
    "/admin/customers",
    requireStaff,
    requireOwner,
    tenantContext,
    /** @param {Request} _req @param {Response} res @param {NextFunction} next */
    (_req, res, next) => {
      res.set("Cache-Control", "no-store");
      next();
    },
  );
  router.get(
    "/admin/customers",
    asyncRoute(
      /** @param {TenantRequest} req @param {Response} res */
      async (req, res) => {
        const query = Query.safeParse(req.query);
        if (!query.success) return invalid(res);
        return res.json({
          ok: true,
          ...(await repo.list({ businessId: req.tenantId, ...query.data })),
        });
      },
    ),
  );
  router.get(
    "/admin/customers/:id",
    asyncRoute(
      /** @param {TenantRequest<{ id: string }>} req @param {Response} res */
      async (req, res) => {
        if (!Id.safeParse(req.params.id).success || !Empty.safeParse(req.query).success)
          return invalid(res);
        const customer = await repo.get({ businessId: req.tenantId, customerId: req.params.id });
        if (!customer)
          return res.status(404).json({ error: "No encontramos este cliente en tu negocio." });
        return res.json({ ok: true, customer });
      },
    ),
  );
  router.patch(
    "/admin/customers/:id",
    csrfProtect,
    asyncRoute(
      /** @param {TenantRequest<{ id: string }>} req @param {Response} res */
      async (req, res) => {
        const body = Profile.safeParse(req.body);
        if (
          !body.success ||
          !Id.safeParse(req.params.id).success ||
          !Empty.safeParse(req.query).success
        )
          return invalid(res);
        const customer = await repo.updateName({
          businessId: req.tenantId,
          customerId: req.params.id,
          name: body.data.name,
          previousName: body.data.previous_name,
        });
        return res.json({ ok: true, customer });
      },
    ),
  );
  return router;
}
adminCustomerRoutes.use(createCustomerDirectoryRouter());
