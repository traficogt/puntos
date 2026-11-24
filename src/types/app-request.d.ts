import type { Request } from "express";

/**
 * The Express request as PuntosFieles middleware extends it. The properties
 * (`staff`, `customerAuth`, `superAdmin`, `pgClient`, ...) are declared on the
 * Express request itself in ./express.d.ts; this alias names that shape.
 */
export type AppRequest = Request;
