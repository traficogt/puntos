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

test("public business profile includes sanitized customer branding for join and wallet shells", async () => {
  process.env.NODE_ENV = "test";
  process.env.DB_HOST = "localhost";
  process.env.DB_NAME = "puntos";
  process.env.DB_USER = "puntos";
  process.env.DB_PASSWORD_FILE = "";
  process.env.DB_PASSWORD = "test-db-password-12345";
  process.env.JWT_SECRET_FILE = "";
  process.env.JWT_SECRET = "test-jwt-secret-abcdefghijklmnopqrstuvwxyz";

  const { publicRoutes } = await import("../../src/app/routes/public-routes.js");
  const { BusinessRepo } = await import("../../src/app/repositories/business-repository.js");
  const layer = routeLayer(publicRoutes, "/public/business/:slug", "get");
  assert.ok(layer, "Expected GET /public/business/:slug");

  const originalGetPublicBySlug = BusinessRepo.getPublicBySlug;

  BusinessRepo.getPublicBySlug = async () => ({
    id: "biz-1",
    slug: "cafe-bourbon",
    name: "Cafe Bourbon",
    category: "coffee",
    program_type: "SPEND",
    program_json: {
      external_awards: {
        enabled: true,
        api_key: "secret"
      }
    },
    customer_branding_json: {
      branding_mode: "white_label_ready",
      customer_program_name: "Cafe Bourbon Rewards",
      customer_logo_url: "https://cdn.example.com/logo.png",
      primary_color: "#6D3524",
      accent_color: "#D7A554",
      neutral_theme: "warm",
      powered_by_visible: false,
      wallet_headline: "Tus puntos en Cafe Bourbon",
      join_headline: "Unete y gana beneficios",
      internal_notes: "should not leak"
    }
  });

  try {
    const res = await runFinalHandler(layer, {
      method: "GET",
      params: { slug: "cafe-bourbon" }
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.program_json.external_awards.enabled, true);
    assert.equal(res.body.program_json.external_awards.api_key, undefined);
    assert.deepEqual(res.body.customer_branding, {
      branding_mode: "white_label_ready",
      customer_program_name: "Cafe Bourbon Rewards",
      customer_logo_url: "https://cdn.example.com/logo.png",
      primary_color: "#6D3524",
      accent_color: "#D7A554",
      neutral_theme: "warm",
      powered_by_visible: false,
      wallet_headline: "Tus puntos en Cafe Bourbon",
      join_headline: "Unete y gana beneficios"
    });
  } finally {
    BusinessRepo.getPublicBySlug = originalGetPublicBySlug;
  }
});
