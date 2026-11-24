/**
 * Hand-maintained declaration for `cors` (no `@types/cors` in the dependency
 * tree). Mirrors the upstream DefinitelyTyped shapes for the options object and
 * the per-request delegate form used by the API server.
 */
declare module "cors" {
  import type { IncomingMessage, ServerResponse } from "node:http";

  type StaticOrigin = boolean | string | RegExp | Array<boolean | string | RegExp>;

  type CustomOrigin = (
    requestOrigin: string | undefined,
    callback: (err: Error | null, origin?: StaticOrigin) => void,
  ) => void;

  export interface CorsOptions {
    origin?: StaticOrigin | CustomOrigin;
    methods?: string | string[];
    allowedHeaders?: string | string[];
    exposedHeaders?: string | string[];
    credentials?: boolean;
    maxAge?: number;
    preflightContinue?: boolean;
    optionsSuccessStatus?: number;
  }

  export type CorsOptionsDelegate<T extends IncomingMessage = IncomingMessage> = (
    req: T,
    callback: (err: Error | null, options?: CorsOptions) => void,
  ) => void;

  export type CorsRequestHandler<T extends IncomingMessage = IncomingMessage> = (
    req: T,
    res: ServerResponse,
    next: (err?: unknown) => void,
  ) => void;

  function cors<T extends IncomingMessage = IncomingMessage>(
    options?: CorsOptions | CorsOptionsDelegate<T>,
  ): CorsRequestHandler<T>;

  export default cors;
}
