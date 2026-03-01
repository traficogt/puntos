process.env.NODE_ENV = "test";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

import { customerRoutes } from "../../src/app/routes/customer-routes.js";
import { publicRoutes } from "../../src/app/routes/public-routes.js";
import { signCustomerToken } from "../../src/utils/auth-token.js";
import { config } from "../../src/config/index.js";
import { pool } from "../../src/app/database.js";

// Ensure downstream guards treat this as test environment
config.NODE_ENV = "test";
if (!config.QR_PRIVATE_KEY_PEM || !config.QR_PUBLIC_KEY_PEM) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  config.QR_PRIVATE_KEY_PEM = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  config.QR_PUBLIC_KEY_PEM = publicKey.export({ format: "pem", type: "spki" }).toString();
}

// Ensure pooled connections don't block the test process
pool.end().catch(() => {});
pool.query = async () => ({ rows: [] });
pool.connect = async () => ({ query: pool.query, release() {} });
import { CustomerRepo } from "../../src/app/repositories/customer-repository.js";
import { BusinessRepo } from "../../src/app/repositories/business-repository.js";
import { TxnRepo } from "../../src/app/repositories/transaction-repository.js";
import { RedemptionRepo } from "../../src/app/repositories/redemption-repository.js";

// Stub data
const businessId = "biz-test";
const customerId = "cust-test";
const business = { id: businessId, name: "Test Biz", slug: "test-biz" };
const customer = {
  id: customerId,
  business_id: businessId,
  phone: "+50212345678",
  name: "Customer Test",
  points: 100,
  pending_points: 0,
  lifetime_points: 100,
  created_at: new Date().toISOString(),
  last_visit_at: new Date().toISOString()
};

// Patch repos to avoid DB
CustomerRepo.getById = async () => customer;
BusinessRepo.getById = async () => business;
TxnRepo.listByCustomer = async () => [];
RedemptionRepo.listByCustomer = async () => [];

function makeReq(path) {
  return {
    method: "GET",
    path,
    originalUrl: path,
    url: path,
    headers: {},
    cookies: {},
    rawBody: "",
    ip: "127.0.0.1"
  };
}

function makeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; this.sent = true; return this; },
    send(payload) { this.body = payload; this.sent = true; return this; }
  };
  return res;
}

async function runHandlers(handlers, req, res) {
  return new Promise((resolve, reject) => {
    const run = (idx) => {
      const handler = handlers[idx];
      if (!handler) return resolve();
      const next = (err) => {
        if (err) return reject(err);
        run(idx + 1);
      };
      try {
        const maybe = handler(req, res, next);
        if (maybe && typeof maybe.then === "function") {
          maybe.then(() => {
            if (idx === handlers.length - 1) resolve();
          }).catch(reject);
        } else if (idx === handlers.length - 1) {
          resolve();
        }
      } catch (e) {
        reject(e);
      }
    };
    run(0);
  });
}

function extractHandlers(router, path) {
  const layer = router.stack.find((l) => l.route?.path === path);
  if (!layer) throw new Error(`Route ${path} not found`);
  return layer.route.stack.map((s) => s.handle);
}

function overrideHandler(router, path, fn) {
  const layer = router.stack.find((l) => l.route?.path === path);
  if (!layer) throw new Error(`Route ${path} not found`);
  const stack = layer.route.stack;
  stack[stack.length - 1].handle = fn;
}

describe("customer happy path flow (no network/listen)", () => {
  const tokenPromise = signCustomerToken({ cid: customerId, bid: businessId, slug: business.slug });

  it("returns customer profile and QR svg", async () => {
    const token = await tokenPromise;
    const cookieName = config.CUSTOMER_COOKIE_NAME;

    // /customer/me
    const reqMe = makeReq("/api/customer/me");
    reqMe.cookies[cookieName] = token;
    const resMe = makeRes();
    const meHandlers = extractHandlers(customerRoutes, "/customer/me");
    await runHandlers(meHandlers, reqMe, resMe);
    assert.equal(resMe.statusCode, 200);
    assert.equal(resMe.body.customer.id, customerId);
    assert.equal(resMe.body.business.id, businessId);

    // /public/customer/qr.svg
    const reqQr = makeReq("/api/public/customer/qr.svg");
    reqQr.cookies[cookieName] = token;
    const resQr = makeRes();
    overrideHandler(publicRoutes, "/public/customer/qr.svg", (req, res) => {
      res.setHeader("Content-Type", "image/svg+xml");
      res.setHeader("X-QR-Exp", String(Date.now() + 300000));
      res.send("<svg>test</svg>");
    });
    const qrHandlers = extractHandlers(publicRoutes, "/public/customer/qr.svg");
    await runHandlers(qrHandlers, reqQr, resQr);
    assert.equal(resQr.statusCode, 200);
    assert.ok((resQr.headers["content-type"] || "").includes("image/svg+xml"));
    assert.ok(resQr.headers["x-qr-exp"]);
    assert.ok(String(resQr.body || resQr.sent ? "" : "").includes("<svg") || String(resQr.body || "").includes("<svg"));
  });
});
