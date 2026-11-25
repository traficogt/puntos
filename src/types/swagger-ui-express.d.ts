/**
 * Hand-maintained declaration for `swagger-ui-express` (no
 * `@types/swagger-ui-express` in the dependency tree). Only the static-asset
 * middleware and the document setup used by src/app/routes/swagger-routes.js.
 */
declare module "swagger-ui-express" {
  import type { RequestHandler } from "express";

  export interface SwaggerUiOptions {
    explorer?: boolean;
    customCss?: string;
    customJs?: string | string[];
    customSiteTitle?: string;
    customfavIcon?: string;
    swaggerUrl?: string;
    swaggerOptions?: Record<string, unknown>;
  }

  /** Static Swagger UI assets; mount before `setup()` on the same path. */
  export const serve: RequestHandler[];
  export function setup(
    swaggerDoc?: Record<string, unknown> | null,
    options?: SwaggerUiOptions,
  ): RequestHandler;

  const swaggerUi: {
    serve: typeof serve;
    setup: typeof setup;
  };
  export default swaggerUi;
}
