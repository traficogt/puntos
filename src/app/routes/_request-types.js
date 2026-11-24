/**
 * Request shapes shared by the route modules.
 *
 * `src/types/express.d.ts` augments Express's `Request` with the fields the
 * middleware attaches (`tenantId`, `staff`, `customerAuth`, `superAdmin`,
 * `pgClient`, `rawBody`, ...), all optional and the identities typed `any`.
 * The typedefs below refine that augmentation for handlers that run after the
 * middleware which guarantees a field, and add the fields the augmentation does
 * not declare yet (`validated`, `validatedQuery`, `validatedParams`,
 * `authSession`, `_resolvedBusiness`). Candidates for `src/types` later.
 *
 * Type-only module: it has no runtime exports and Node never loads it.
 */

/** @typedef {import("express").Request} Request */
/** @typedef {import("express").Response} Response */
/** @typedef {import("express").NextFunction} NextFunction */

/**
 * Express 5 types route params as `string | string[]`; handlers that hand a
 * param to a `string` parameter declare `P` (e.g. `TenantRequest<{ id: string }>`).
 * @typedef {import("express-serve-static-core").ParamsDictionary} ParamsDictionary
 */

/**
 * A request that passed `tenantContext` or `setTenantForRequest`: `tenantId` is set.
 * @template [P=ParamsDictionary]
 * @typedef {import("express").Request<P> & { tenantId: string }} TenantRequest
 */

/**
 * A request whose `req.params` were narrowed without a tenant (public routes).
 * @template P
 * @typedef {import("express").Request<P>} ParamsRequest
 */

/**
 * Body parsed by `validateRequest(schema)` (utils/schemas.js) into `req.validated`.
 * @template Body
 * @typedef {{ validated: Body }} WithValidated
 */

/**
 * Query parsed by `validateQuery(schema)` into `req.validatedQuery`.
 * @template Query
 * @typedef {{ validatedQuery: Query }} WithValidatedQuery
 */

/**
 * Params parsed by `validateParams(schema)` into `req.validatedParams`.
 * @template Params
 * @typedef {{ validatedParams: Params }} WithValidatedParams
 */

/**
 * Browser session attached by `requireStaff` / `requireCustomer` / `requireSuperAdmin`
 * (middleware/auth.js) and by the mobile session middleware.
 * @typedef {{ authSession?: import("../repositories/auth-session-repository.js").AuthSessionRow | null }} WithAuthSession
 */

/**
 * Business row cached on the request by `requirePlanFeature` (middleware/plan-feature.js).
 * @typedef {{ _resolvedBusiness?: import("../repositories/business-repository.js").BusinessRow | null }} WithResolvedBusiness
 */

export {};
