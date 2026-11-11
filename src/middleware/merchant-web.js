import { Router } from "express";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";

/** Serve the merchant shell with per-response nonces for Mantine's style tags. */
export function createMerchantWeb(publicDir) {
  const router = Router();
  router.get(["/", "/index.html"], async (_req, res, next) => {
    try {
      // The directory is supplied by server configuration; no request value enters this path.
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const html = await readFile(
        path.join(publicDir, "merchant/index.html"),
        "utf8",
      );
      const nonce = randomBytes(18).toString("base64");
      const policy = String(
        res.getHeader("Content-Security-Policy") ||
          "default-src 'self';script-src 'self'",
      );
      const stylePolicy = `style-src 'self' https://fonts.googleapis.com 'nonce-${nonce}'`;
      const nextPolicy = /(?:^|;)\s*style-src\s[^;]*/.test(policy)
        ? policy.replace(
            /(^|;)\s*style-src\s[^;]*/,
            (_match, separator) => `${separator}${stylePolicy}`,
          )
        : `${policy};${stylePolicy}`;
      const imagePolicy = /(?:^|;)\s*img-src\s[^;]*/.test(nextPolicy)
        ? nextPolicy.replace(/(^|;)\s*img-src\s([^;]*)/, (_match, separator, sources) => `${separator}img-src ${sources} blob:`)
        : `${nextPolicy};img-src 'self' data: https: blob:`;
      res.set("Content-Security-Policy", imagePolicy);
      res.set("Cache-Control", "no-store");
      res.set("X-Robots-Tag", "noindex, nofollow");
      return res
        .type("html")
        .send(html.replaceAll("__PF_STYLE_NONCE__", nonce));
    } catch (error) {
      return next(error);
    }
  });
  return router;
}
