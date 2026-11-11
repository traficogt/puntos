import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import QRCode from "qrcode";
import { errorHandler } from "../../src/middleware/common.js";

test("business invitation routes use the authenticated Branding scope and canonical app URL", async t => {
  const module = await import("../../src/app/routes/admin/branding-routes.js");
  assert.equal(typeof module.createAdminBrandingRoutes, "function", "Branding routes must expose the scoped invitation handlers");
  const calls = [];
  let missing = false;
  const business = { id: "business-own", name: "Café Uno", slug: "café uno/x", password_hash: "private-password", program_json: { api_key: "private-key" } };
  const app = express();
  app.use("/api", module.createAdminBrandingRoutes({
    appOrigin: "https://app.puntosfieles.com",
    getBusiness: async id => { calls.push(id); return missing ? null : business; },
    staffAuth: (req, res, next) => {
      if (!req.get("x-test-role")) return res.status(401).json({ error: "Sign in" });
      req.staff = { id: "owner", business_id: business.id, role: req.get("x-test-role") };
      next();
    }
  }));
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (server.address()).port}`;
  const get = (path, role = "OWNER") => fetch(`${origin}/api/admin/customer-enrollment${path}`, { headers: role ? { "x-test-role": role, host: "untrusted.example" } : {} });
  try {
    await t.test("unauthenticated, manager and cashier callers retain the existing Branding boundary", async () => {
      for (const path of ["", "/qr.svg"]) {
        assert.equal((await get(path, "")).status, 401);
        assert.equal((await get(path, "MANAGER")).status, 403);
        assert.equal((await get(path, "CASHIER")).status, 403);
      }
      assert.deepEqual(calls, []);
    });
    await t.test("only own business metadata is returned and request tenant/Host values cannot alter the URL", async () => {
      const response = await get("?business_id=foreign&slug=foreign");
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.deepEqual(await response.json(), {
        ok: true, business: { id: business.id, name: business.name, slug: business.slug },
        registration_url: "https://app.puntosfieles.com/registro/caf%C3%A9%20uno%2Fx"
      });
      assert.deepEqual(calls, [business.id]);
    });
    await t.test("QR contains the public enrollment URL with white background and a four-module quiet zone", async () => {
      const response = await get("/qr.svg?business_id=foreign");
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type"), /image\/svg\+xml/);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      const svg = await response.text();
      const target = "https://app.puntosfieles.com/registro/caf%C3%A9%20uno%2Fx";
      assert.equal(svg, await QRCode.toString(target, {
        type: "svg", errorCorrectionLevel: "M", margin: 4, width: 240,
        color: { dark: "#000000", light: "#ffffff" }
      }));
      const dimension = QRCode.create(target, { errorCorrectionLevel: "M" }).modules.size + 8;
      assert.ok(svg.includes(`viewBox="0 0 ${dimension} ${dimension}"`));
      assert.match(svg, /fill="#ffffff"/i);
      assert.match(svg, /stroke="#000000"/i);
      assert.equal(svg.includes("private-"), false);
      assert.equal(calls.at(-1), business.id);
      const download = await get("/qr.svg?download=1");
      assert.equal(download.headers.get("content-disposition"), 'attachment; filename="qr-registro.svg"');
      await download.arrayBuffer();
    });
    await t.test("a missing own business never falls back to a requested business", async () => {
      missing = true;
      assert.equal((await get("?business_id=foreign")).status, 404);
      assert.equal((await get("/qr.svg?business_id=foreign")).status, 404);
    });
  } finally { await new Promise(resolve => server.close(resolve)); }
});
