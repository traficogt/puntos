import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import cookieParser from "cookie-parser";
import { SecurityEventRepo } from "../../src/app/repositories/security-event-repository.js";
import { errorHandler } from "../../src/middleware/common.js";

test("branded enrollment QR requires the owner and paid feature within their tenant", async t => {
  const { createAdminBrandedQrRoutes } = await import("../../src/app/routes/admin/branded-qr-routes.js");
  const business = { id: "own-business", name: "Café Uno", slug: "café uno/x", plan: "NEGOCIO", customer_branding_json: { primary_color: "#204030", customer_logo_url: "https://private.example/logo.png" } };
  const calls = [];
  let missing = false, overrides = {};
  t.mock.method(SecurityEventRepo, "log", async () => {});
  const app = express();
  app.use(express.json({ limit: "200kb" }));
  app.use(cookieParser());
  app.use("/api", createAdminBrandedQrRoutes({
    appOrigin: "https://app.puntosfieles.com/path",
    getBusiness: async id => { calls.push(id); return missing ? null : business; },
    getPlanFeatureOverrides: async () => overrides,
    getSources: async business => ({sources:[{id:"11111111-1111-4111-8111-111111111111",business_id:business.id,code:"abcdefghijklmnop",name:"Mostrador"}]}),
    getSource: async (businessId, sourceId) => sourceId === "11111111-1111-4111-8111-111111111111" ? {id:sourceId,business_id:businessId,code:"abcdefghijklmnop"} : null,
    staffAuth: (req, res, next) => {
      if (!req.get("x-role")) return res.status(401).json({ error: "Sign in" });
      req.staff = { id: "owner", business_id: "own-business", role: req.get("x-role") };
      next();
    },
  }));
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (server.address()).port}`;
  const get = (path = "", role = "OWNER") => fetch(`${origin}/api/admin/customer-enrollment/branded-qr${path}`, { headers: role ? { "x-role": role, host: "untrusted.example" } : {} });
  const post = (body = {}, {role="OWNER",token="fixture-qr-token",cookie="pf_csrf=fixture-qr-token",requestOrigin=origin,query="",contentType="application/json"} = {}) => fetch(`${origin}/api/admin/customer-enrollment/branded-qr.svg${query}`, {
    method:"POST",headers:{...(role?{"x-role":role}:{}),"content-type":contentType,origin:requestOrigin,cookie,"x-csrf-token":token},body:JSON.stringify(body),
  });
  try {
    await t.test("rejects unsigned, cashier and manager reads before business lookup", async () => {
      for (const path of ["", ".svg"]) for (const role of ["", "CASHIER", "MANAGER"]) {
        const response = await get(path, role);
        assert.equal(response.status, role ? 403 : 401);
        assert.equal(response.headers.get("cache-control"), "private, no-store");
      }
      for (const role of ["", "CASHIER", "MANAGER"]) {
        assert.equal((await post({}, {role})).status,role?403:401);
      }
      assert.deepEqual(calls, []);
    });
    await t.test("returns canonical enrollment and only public branding fields", async () => {
      const response = await get();
      assert.equal(response.status, 200);
      const data = await response.json();
      assert.equal(data.registration_url, "https://app.puntosfieles.com/registro/caf%C3%A9%20uno%2Fx");
      assert.deepEqual(data.business, { id: "own-business", name: "Café Uno", slug: "café uno/x" });
      assert.equal(data.branding.logo_included, false);
      assert.equal(data.defaults.foreground, "#204030");
      assert.equal(data.capabilities.quiet_zone_modules, 4);
      assert.equal(data.capabilities.error_correction, "H");
      assert.equal(data.defaults.logo_position, "center");
      assert.deepEqual(data.capabilities.logo_positions, ["center", "header", "none"]);
      assert.equal(JSON.stringify(data).includes("private.example"), false);
      assert.deepEqual(calls, ["own-business"]);
    });
    await t.test("source exports select only an existing tenant source, never a supplied URL", async () => {
      const own="11111111-1111-4111-8111-111111111111", foreign="22222222-2222-4222-8222-222222222222";
      assert.equal((await get(`.svg?source_id=${own}`)).status,200);
      assert.equal((await post({source_id:own})).status,200);
      assert.equal((await get(`.svg?source_id=${foreign}`)).status,404);
      assert.equal((await post({source_id:foreign})).status,404);
      assert.equal((await get('.svg?source_id=bad')).status,400);
      assert.equal((await post({source_id:own,registration_url:'https://outside.test'})).status,400);
    });
    await t.test("enforces paid defaults, plan overrides and unknown plan rejection", async () => {
      business.plan = "EMPRENDEDOR";
      for (const path of ["", ".svg"]) {
        const response = await get(path);
        assert.equal(response.status, 403);
        const data = await response.json();
        assert.equal(data.code, "PLAN_FEATURE_LOCKED");
        assert.equal(data.suggested_plan, "NEGOCIO");
      }
      assert.equal((await post()).status, 403);
      business.plan = "NEGOCIO";
      overrides = { NEGOCIO: { branded_qr: false } };
      assert.equal((await get()).status, 403);
      assert.equal((await post()).status, 403);
      overrides = {};
      business.plan = "UNKNOWN";
      assert.equal((await get()).status, 403);
      business.plan = "EMPRESA";
      assert.equal((await get()).status, 200);
    });
    await t.test("rejects unsafe or ambiguous customization and requested foreign tenants", async () => {
      for (const query of ["foreground=white", "foreground=%23ffffff", "foreground=%23000000&foreground=%23111111", "download=yes", "business_id=foreign", "slug=foreign", "name=Foreign", "logo=https://example.com", "logo_position=outside", "logo_position=center&logo_position=header", "logo_data_url=data:image/png;base64,abc"]) {
        const response = await get(`.svg?${query}`);
        assert.equal(response.status, 400, query);
        assert.equal(response.headers.get("cache-control"), "private, no-store");
      }
    });
    await t.test("delivers a self-contained attachment with private caching", async () => {
      const response = await get(".svg?foreground=%23333333&download=1");
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "image/svg+xml; charset=utf-8");
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      assert.equal(response.headers.get("content-disposition"), 'attachment; filename="qr-registro-con-marca.svg"');
      assert.match(response.headers.get("content-security-policy"), /default-src 'none'/);
      const svg = await response.text();
      assert.match(svg, /#333333/);
      assert.equal(/private\.example|<script|<foreignObject|javascript:|onload=/i.test(svg), false);
    });
    await t.test("supports each GET placement without accepting uploaded data or changing the enrollment target", async () => {
      const before=JSON.stringify(business);
      for (const position of ["center","header","none"]) {
        const response=await get(`.svg?logo_position=${position}`);
        assert.equal(response.status,200);
      }
      assert.equal(JSON.stringify(business),before);
    });
    await t.test("requires matching CSRF cookies, headers and origin for POST previews", async () => {
      for (const options of [{token:""},{token:"wrong"},{cookie:""},{requestOrigin:"https://outside.invalid"}]) {
        const response=await post({},options);
        assert.equal(response.status,403);
        assert.equal(response.headers.get("cache-control"),"private, no-store");
      }
    });
    await t.test("strictly accepts only foreground, placement and bounded raster data in POST", async () => {
      for (const body of [null,[],{business_id:"foreign"},{registration_url:"https://outside.test"},{download:true},{logo_position:"outside"},{logo_position:["center"]},{logo_position:null},{foreground:null},{foreground:"#ffffff"},{logo_data_url:42},{logo_data_url:{}},{logo_data_url:"https://outside.test/logo.png"},{logo_data_url:"data:image/svg+xml;base64,PHN2Zy8+"},{logo_data_url:`data:image/png;base64,${"A".repeat(180000)}`}]) {
        assert.equal((await post(body)).status,400,JSON.stringify(body).slice(0,100));
      }
      assert.equal((await post({}, {query:"?foreground=%23000000"})).status,400);
      assert.equal((await post({}, {contentType:"text/plain"})).status,400);
    });
    await t.test("POST previews embed local logo data and return protected SVG without persisting branding", async () => {
      const logo="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/l8AAAAASUVORK5CYII=";
      const before=JSON.stringify(business);
      const response=await post({foreground:"#333333",logo_position:"center",logo_data_url:logo});
      assert.equal(response.status,200);
      assert.equal(response.headers.get("content-type"),"image/svg+xml; charset=utf-8");
      assert.equal(response.headers.get("cache-control"),"private, no-store");
      assert.equal(response.headers.get("x-content-type-options"),"nosniff");
      assert.equal(response.headers.get("content-disposition"),null);
      assert.match(response.headers.get("content-security-policy"),/default-src 'none'; img-src data:; style-src 'none'; sandbox/);
      const svg=await response.text();
      assert.match(svg,/<svg x="50"[\s\S]*<image[^>]+data:image\/png;base64,/);
      assert.equal(svg.includes("private.example"),false);
      assert.doesNotMatch(await (await post({logo_data_url:null})).text(),/<image/);
      assert.equal((await post()).status,200);
      assert.equal(JSON.stringify(business),before);
    });
    await t.test("never exposes a mismatched or missing business", async () => {
      business.id = "foreign";
      assert.equal((await get()).status, 404);
      assert.equal((await post()).status, 404);
      business.id = "own-business";
      missing = true;
      assert.equal((await get()).status, 404);
      assert.equal((await post()).status, 404);
    });
  } finally { await new Promise(resolve => server.close(resolve)); }
});
