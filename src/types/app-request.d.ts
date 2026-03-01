import { Request } from "express";

export type AppRequest = Request & {
  tenantId?: string;
  tenant?: { id: string };
  staff?: any;
  customer?: any;
  customerAuth?: any;
  super?: any;
  pgClient?: any;
  rawBody?: string;
};
