import { test } from "node:test";
import assert from "node:assert/strict";

function routeLayer(router, path, method) {
  return router.stack.find((entry) => entry.route?.path === path && entry.route?.methods?.[method]);
}

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

async function runFinalHandler(layer, req) {
  const res = makeRes();
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;
  await new Promise((resolve, reject) => {
    try {
      const maybe = handler(req, res, (err) => (err ? reject(err) : resolve()));
      if (maybe && typeof maybe.then === "function") maybe.then(resolve).catch(reject);
      else resolve();
    } catch (error) {
      reject(error);
    }
  });
  return res;
}

test("admin branding routes return and persist customer branding config", async () => {
  process.env.NODE_ENV = "test";
  process.env.DB_HOST = "localhost";
  process.env.DB_NAME = "puntos";
  process.env.DB_USER = "puntos";
  process.env.DB_PASSWORD_FILE = "";
  process.env.DB_PASSWORD = "test-db-password-12345";
  process.env.JWT_SECRET_FILE = "";
  process.env.JWT_SECRET = "test-jwt-secret-abcdefghijklmnopqrstuvwxyz";

  const { adminBrandingRoutes } = await import("../../src/app/routes/admin/branding-routes.js");
  const { BusinessRepo } = await import("../../src/app/repositories/business-repository.js");
  const getLayer = routeLayer(adminBrandingRoutes, "/admin/branding", "get");
  const putLayer = routeLayer(adminBrandingRoutes, "/admin/branding", "put");

  assert.ok(getLayer, "Expected GET /admin/branding");
  assert.ok(putLayer, "Expected PUT /admin/branding");

  const originalGetById = BusinessRepo.getById;
  const originalUpdateCustomerBranding = BusinessRepo.updateCustomerBranding;

  const persistedBranding = {
    branding_mode: "endorsed_brand",
    customer_program_name: "Cafe Bourbon Rewards",
    customer_logo_url: "https://cdn.example.com/logo.png",
    primary_color: "#6D3524",
    accent_color: "#D7A554",
    qr_logo_enabled: true,
    powered_by_visible: true,
    wallet_headline: "Tus puntos en un solo lugar",
    join_headline: "Unete y gana beneficios"
  };

  BusinessRepo.getById = async () => ({
    id: "biz-1",
    plan: "EMPRESA",
    customer_branding_json: persistedBranding
  });
  BusinessRepo.updateCustomerBranding = async (businessId, branding) => ({
    id: businessId,
    customer_branding_json: branding
  });

  try {
    const getRes = await runFinalHandler(getLayer, {
      method: "GET",
      tenantId: "biz-1"
    });

    assert.equal(getRes.statusCode, 200);
    assert.equal(getRes.body.ok, true);
    assert.deepEqual(getRes.body.customer_branding, persistedBranding);

    const putRes = await runFinalHandler(putLayer, {
      method: "PUT",
      tenantId: "biz-1",
      body: persistedBranding
    });

    assert.equal(putRes.statusCode, 200);
    assert.equal(putRes.body.ok, true);
    assert.deepEqual(putRes.body.customer_branding, persistedBranding);
  } finally {
    BusinessRepo.getById = originalGetById;
    BusinessRepo.updateCustomerBranding = originalUpdateCustomerBranding;
  }
});

test("admin branding routes reject premium QR logo below EMPRESA", async () => {
  process.env.NODE_ENV = "test";
  process.env.DB_HOST = "localhost";
  process.env.DB_NAME = "puntos";
  process.env.DB_USER = "puntos";
  process.env.DB_PASSWORD_FILE = "";
  process.env.DB_PASSWORD = "test-db-password-12345";
  process.env.JWT_SECRET_FILE = "";
  process.env.JWT_SECRET = "test-jwt-secret-abcdefghijklmnopqrstuvwxyz";

  const { adminBrandingRoutes } = await import("../../src/app/routes/admin/branding-routes.js");
  const { BusinessRepo } = await import("../../src/app/repositories/business-repository.js");
  const putLayer = routeLayer(adminBrandingRoutes, "/admin/branding", "put");

  assert.ok(putLayer, "Expected PUT /admin/branding");

  const originalGetById = BusinessRepo.getById;
  const originalUpdateCustomerBranding = BusinessRepo.updateCustomerBranding;
  let updateCalled = false;

  BusinessRepo.getById = async () => ({
    id: "biz-1",
    plan: "NEGOCIO",
    customer_branding_json: {}
  });
  BusinessRepo.updateCustomerBranding = async () => {
    updateCalled = true;
    return null;
  };

  try {
    const putRes = await runFinalHandler(putLayer, {
      method: "PUT",
      tenantId: "biz-1",
      body: {
        branding_mode: "endorsed_brand",
        customer_program_name: "Cafe Bourbon Rewards",
        customer_logo_url: "https://cdn.example.com/logo.png",
        qr_logo_enabled: true
      }
    });

    assert.equal(putRes.statusCode, 403);
    assert.match(String(putRes.body?.error || ""), /EMPRESA/i);
    assert.equal(updateCalled, false);
  } finally {
    BusinessRepo.getById = originalGetById;
    BusinessRepo.updateCustomerBranding = originalUpdateCustomerBranding;
  }
});
