import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import helmet from "helmet";
import { createMerchantWeb } from "../../src/middleware/merchant-web.js";
import path from "node:path";
test("merchant HTML uses unique matching CSP style nonce without broadening script policy", async () => {
  const app = express();
  app.use(helmet());
  app.use("/merchant", createMerchantWeb(path.resolve("public")));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing address");
    const first = await fetch(`http://127.0.0.1:${address.port}/merchant/`),
      second = await fetch(`http://127.0.0.1:${address.port}/merchant`);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    const html = await first.text(),
      nonce = html.match(/name="pf-style-nonce" content="([^"]+)"/)?.[1];
    assert.ok(nonce && nonce !== "__PF_STYLE_NONCE__");
    assert.ok(
      first.headers.get("content-security-policy").includes(`nonce-${nonce}`),
    );
    assert.match(
      first.headers.get("content-security-policy"),
      /script-src 'self'/,
    );
    assert.equal(first.headers.get("cache-control"), "no-store");
    assert.notEqual(html, await second.text());
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
