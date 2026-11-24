import "express-serve-static-core";
import type { BrowserSessionRecord, CustomerActor, StaffActor, SuperAdminActor } from "./auth.js";
import type { DbPooledClient } from "./db.js";

declare module "express-serve-static-core" {
  interface Request {
    /** Set by tenantContext / setTenantForRequest (src/middleware/tenant.js). */
    tenantId?: string;
    tenant?: { id: string };
    /**
     * Set by requireStaff (src/middleware/auth.js). Declared present because
     * every route that reads it is mounted behind requireStaff; on routes
     * without that guard the property is undefined at runtime and must not be
     * read. (Making it optional needs the route handlers to narrow it first.)
     */
    staff: StaffActor;
    /** Set by requireCustomer. */
    customerAuth?: CustomerActor;
    /** Set by requireSuperAdmin. */
    superAdmin?: SuperAdminActor;
    /** The browser session behind staff/customer/super auth, after validation. */
    authSession?: BrowserSessionRecord;
    /** Request-pinned connection on API prefixes (src/middleware/pg-client.js). */
    pgClient?: DbPooledClient;
    /** Raw JSON body for signature verification (src/app/server.js). */
    rawBody?: string;
    requestId?: string;
    /** Double-submit CSRF token issued for this request (src/middleware/csrf.js). */
    csrfToken?: string;
    /**
     * Parsed request body / query / params set by validateRequest, validateQuery
     * and validateParams (src/utils/schemas.js). The shape is the route's zod
     * schema output; narrow it with `z.infer<typeof schema>` where it is read.
     */
    validated?: unknown;
    validatedQuery?: unknown;
    validatedParams?: unknown;
    /** Business row cached by requirePlanFeature for the rest of the request. */
    _resolvedBusiness?: Awaited<
      ReturnType<
        (typeof import("../app/repositories/business-repository.js").BusinessRepo)["getById"]
      >
    >;
  }
}
