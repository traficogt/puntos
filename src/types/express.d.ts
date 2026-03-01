import "express-serve-static-core";

declare module "express-serve-static-core" {
  interface Request {
    tenantId?: string;
    tenant?: { id: string };
    staff?: any;
    customer?: any;
    customerAuth?: any;
    super?: any;
    superAdmin?: any;
    pgClient?: any;
    rawBody?: string;
    requestId?: string;
  }
}
