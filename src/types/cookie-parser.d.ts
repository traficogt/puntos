/**
 * Hand-maintained declaration for `cookie-parser` (no `@types/cookie-parser`
 * in the dependency tree). The parsed cookies land on `req.cookies`, which the
 * Express request type already declares.
 */
declare module "cookie-parser" {
  import type { RequestHandler } from "express";

  export interface CookieParseOptions {
    decode?(value: string): string;
  }

  function cookieParser(secret?: string | string[], options?: CookieParseOptions): RequestHandler;

  export default cookieParser;
}
