import { describe, it } from "node:test";
import assert from "node:assert/strict";
import cors from "cors";
import helmet from "helmet";

import { config } from "../../src/config/index.js";
import { healthRoutes } from "../../src/app/routes/health-routes.js";
import { publicRoutes } from "../../src/app/routes/public-routes.js";
import { staffRoutes } from "../../src/app/routes/staff-routes.js";
import { customerRoutes } from "../../src/app/routes/customer-routes.js";
import { paymentWebhookRoutes } from "../../src/app/routes/payment-webhook-routes.js";
import { errorHandler, notFound } from "../../src/middleware/common.js";
import { pool } from "../../src/app/database.js";

config.NODE_ENV = "test";

pool.query = async (sql) => {
  const text = String(sql);
  if (text.includes("SELECT 1 as health")) return { rows: [{ health: 1 }], rowCount: 1 };
  if (text.includes("SELECT 1")) return { rows: [{ "?column?": 1 }], rowCount: 1 };
  if (text.includes("FROM pg_stat_activity")) {
    return { rows: [{ active_connections: 1, idle_connections: 0, total_connections: 1 }], rowCount: 1 };
  }
  if (text.includes("FROM customers WHERE deleted_at IS NULL")) {
    return {
      rows: [
        { table_name: "customers", row_count: 0 },
        { table_name: "transactions", row_count: 0 },
        { table_name: "redemptions", row_count: 0 }
      ],
      rowCount: 3
    };
  }
  if (text.includes("FROM webhook_deliveries")) return { rows: [], rowCount: 0 };
  if (text.includes("FROM customer_balances")) {
    return { rows: [{ customer_count: 0, total_points: 0, avg_points: 0 }], rowCount: 1 };
  }
  return { rows: [], rowCount: 0 };
};
pool.connect = async () => ({ query: pool.query, release() {} });

function makeReq({ method = "GET", path = "/", headers = {}, body = undefined, cookies = {}, ip = "127.0.0.1" } = {}) {
  return {
    method,
    path,
    url: path,
    originalUrl: path,
    headers,
    body,
    cookies,
    ip,
    get(name) {
      return this.headers[String(name).toLowerCase()];
    }
  };
}

function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    sent: false,
    headersSent: false,
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
    removeHeader(name) {
      delete this.headers[String(name).toLowerCase()];
    },
    getHeader(name) {
      return this.headers[String(name).toLowerCase()];
    },
    getHeaders() {
      return this.headers;
    },
    set(arg1, arg2) {
      if (typeof arg1 === "string") {
        this.setHeader(arg1, arg2);
        return this;
      }
      Object.entries(arg1 || {}).forEach(([key, value]) => this.setHeader(key, value));
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      this.sent = true;
      return this;
    },
    send(payload) {
      this.body = payload;
      this.sent = true;
      this.headersSent = true;
      return this;
    },
    end(payload = "") {
      this.body = payload;
      this.sent = true;
      this.headersSent = true;
      return this;
    },
    writeHead(code, headers = {}) {
      this.statusCode = code;
      Object.entries(headers).forEach(([key, value]) => this.setHeader(key, value));
      return this;
    }
  };
}

async function runHandlers(handlers, req, res) {
  return new Promise((resolve, reject) => {
    const run = (index) => {
      const handler = handlers[index];
      if (!handler || res.sent) return resolve();
      try {
        const maybe = handler(req, res, (err) => {
          if (err) return reject(err);
          run(index + 1);
        });
        if (maybe && typeof maybe.then === "function") {
          maybe.then(() => {
            if (res.sent || index === handlers.length - 1) resolve();
          }).catch(reject);
        } else if (res.sent || index === handlers.length - 1) {
          resolve();
        }
      } catch (err2) {
        reject(err2);
      }
    };
    run(0);
  });
}

function extractHandlers(router, routePath, method = "get") {
  const layer = router.stack.find((entry) => entry.route?.path === routePath && entry.route.methods?.[method]);
  if (!layer) throw new Error(`Route ${method.toUpperCase()} ${routePath} not found`);
  return layer.route.stack.map((entry) => entry.handle);
}

async function invokeRoute(router, routePath, { method = "GET", headers = {}, body = undefined, cookies = {}, ip = "127.0.0.1", params = {} } = {}) {
  const req = makeReq({ method, path: routePath, headers, body, cookies, ip });
  req.params = params;
  const res = makeRes();
  const handlers = extractHandlers(router, routePath, method.toLowerCase());
  await runHandlers(handlers, req, res);
  return { req, res };
}

async function runMiddleware(middleware, req, res) {
  return new Promise((resolve, reject) => {
    try {
      middleware(req, res, (err) => (err ? reject(err) : resolve()));
      if (res.sent) resolve();
    } catch (err) {
      reject(err);
    }
  });
}

describe("API security integration", () => {
  it("enforces strict rate limits on public registration", async () => {
    const statuses = [];
    for (let i = 0; i < 6; i += 1) {
      const out = await invokeRoute(publicRoutes, "/public/business/register", {
        method: "POST",
        body: {
          name: "X",
          slug: `too-short-${i}`,
          email: "not-an-email",
          password: "short",
          phone: "12345678"
        }
      }).catch((err) => {
        const req = makeReq({ method: "POST", path: "/public/business/register", body: {} });
        const res = makeRes();
        errorHandler(err, req, res, () => {});
        return { res };
      });
      statuses.push(out.res.statusCode);
    }
    assert.ok(statuses.includes(429));
  });

  it("rejects invalid registration payloads and SQL-ish email input", async () => {
    const invalid = await invokeRoute(publicRoutes, "/public/business/register", {
      method: "POST",
      ip: "127.0.0.2",
      body: {
        name: "X",
        slug: "demo",
        email: "not-an-email",
        password: "short",
        phone: "12345678"
      }
    });
    assert.equal(invalid.res.statusCode, 400);
    assert.ok(invalid.res.body?.error);

    const injection = await invokeRoute(publicRoutes, "/public/business/register", {
      method: "POST",
      ip: "127.0.0.3",
      body: {
        name: "Demo Coffee",
        slug: "demo-coffee",
        email: "'; DROP TABLE businesses; --",
        password: "Aa1!secure",
        phone: "+50212345678"
      }
    });
    assert.equal(injection.res.statusCode, 400);
  });

  it("requires auth for protected endpoints and rejects invalid customer cookies", async () => {
    const staffMe = await invokeRoute(staffRoutes, "/staff/me");
    assert.equal(staffMe.res.statusCode, 401);

    const customerMe = await invokeRoute(customerRoutes, "/customer/me");
    assert.equal(customerMe.res.statusCode, 401);

    const invalidCustomer = await invokeRoute(customerRoutes, "/customer/me", {
      cookies: { pf_customer: "invalid-token" }
    });
    assert.equal(invalidCustomer.res.statusCode, 401);
  });

  it("rejects unsigned payment webhooks when provider auth is required", async () => {
    const out = await invokeRoute(paymentWebhookRoutes, "/public/payments/webhook/:provider", {
      method: "POST",
      params: { provider: "cubo" },
      body: {
        id: `evt-${Date.now()}`,
        status: "approved",
        businessSlug: "demo",
        amount: 10
      }
    }).catch((err) => {
      const req = makeReq({ method: "POST", path: "/public/payments/webhook/cubo", body: {} });
      req.params = { provider: "cubo" };
      const res = makeRes();
      errorHandler(err, req, res, () => {});
      return { res };
    });
    assert.equal(out.res.statusCode, 403);
    assert.ok(out.res.body?.error);
  });

  it("sets security headers and handles preflight requests", async () => {
    const getReq = makeReq();
    const getRes = makeRes();
    await runMiddleware(helmet(), getReq, getRes);
    assert.ok(getRes.getHeader("x-content-type-options"));
    assert.ok(getRes.getHeader("x-frame-options"));

    const preflightReq = makeReq({
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:3001",
        "access-control-request-method": "GET"
      }
    });
    const preflightRes = makeRes();
    await runMiddleware(cors({ origin: true, credentials: true }), preflightReq, preflightRes);
    assert.ok(preflightRes.statusCode === 204 || preflightRes.getHeader("access-control-allow-origin"));
  });

  it("returns safe JSON errors for bad paths, malformed JSON, and oversized bodies", async () => {
    const req404 = makeReq({ path: "/api/does-not-exist" });
    const res404 = makeRes();
    notFound(req404, res404);
    assert.equal(res404.statusCode, 404);
    assert.ok(res404.body?.error);

    const badJsonReq = makeReq({ method: "POST", path: "/api/public/business/register" });
    const badJsonRes = makeRes();
    errorHandler({ type: "entity.parse.failed", status: 400 }, badJsonReq, badJsonRes, () => {});
    assert.equal(badJsonRes.statusCode, 400);
    assert.equal(badJsonRes.body?.code, "BAD_JSON");

    const hugeReq = makeReq({ method: "POST", path: "/api/public/business/register" });
    const hugeRes = makeRes();
    errorHandler({ status: 413, message: "Payload too large" }, hugeReq, hugeRes, () => {});
    assert.equal(hugeRes.statusCode, 413);
  });

  it("serves observability probes without leaking internals and protects metrics", async () => {
    const health = await invokeRoute(healthRoutes, "/health");
    assert.equal(health.res.statusCode, 200);
    assert.equal(health.res.body?.service, "ok");

    const ready = await invokeRoute(healthRoutes, "/ready");
    assert.ok(ready.res.statusCode === 200 || ready.res.statusCode === 503);
    if (ready.res.statusCode === 503) {
      assert.equal(ready.res.body?.error, "Service unavailable");
    }

    const live = await invokeRoute(healthRoutes, "/live");
    assert.equal(live.res.statusCode, 200);
    assert.equal(live.res.body?.alive, true);

    const forbiddenMetrics = await invokeRoute(healthRoutes, "/metrics");
    assert.equal(forbiddenMetrics.res.statusCode, 403);

    const authMetrics = await invokeRoute(healthRoutes, "/metrics", {
      headers: { authorization: `Bearer ${config.METRICS_TOKEN}` }
    });
    assert.equal(authMetrics.res.statusCode, 200);
    assert.equal(typeof authMetrics.res.body, "string");
    assert.ok(authMetrics.res.body.includes("puntos_"));

    const info = await invokeRoute(healthRoutes, "/info");
    assert.equal(info.res.statusCode, 200);
    assert.equal(info.res.body?.service, "PuntosFieles");
    assert.ok(info.res.body?.version);
  });
});
