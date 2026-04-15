import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

process.env.NODE_ENV = "test";
process.env.PAYMENT_WEBHOOK_HMAC_SECRETS = JSON.stringify({ "cafe-gt": "topsecret" });

const { createOrderReturnRoutes } = await import("../../src/app/routes/order-return-routes.js");

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    set(nameOrHeaders, value) {
      if (typeof nameOrHeaders === "string") {
        this.headers[nameOrHeaders] = value;
      } else {
        Object.assign(this.headers, nameOrHeaders);
      }
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

async function runRoute(router, method, routePath, req) {
  const layer = router.stack.find((entry) => entry.route?.path === routePath && entry.route?.methods?.[method]);
  if (!layer) throw new Error(`Route not found: ${method.toUpperCase()} ${routePath}`);

  const res = makeRes();
  const handlers = layer.route.stack.map((entry) => entry.handle);
  for (const handler of handlers) {
    await new Promise((resolve, reject) => {
      try {
        const maybe = handler(req, res, (err) => (err ? reject(err) : resolve()));
        if (maybe && typeof maybe.then === "function") maybe.then(resolve).catch(reject);
        else if (handler.length < 3) resolve();
      } catch (error) {
        reject(error);
      }
    });
  }
  return res;
}

test("POST /public/order-returns rejects an invalid signature", async () => {
  let serviceCalled = false;
  const router = createOrderReturnRoutes({
    processOrderReturn: async () => {
      serviceCalled = true;
      return {};
    }
  });

  const res = await runRoute(router, "post", "/public/order-returns", {
    method: "POST",
    path: "/public/order-returns",
    originalUrl: "/public/order-returns",
    url: "/public/order-returns",
    ip: "127.0.0.1",
    headers: { "x-signature": "bad-signature" },
    body: {
      businessSlug: "cafe-gt",
      externalReturnId: "ret-1",
      externalOrderId: "ord-1"
    },
    rawBody: JSON.stringify({
      businessSlug: "cafe-gt",
      externalReturnId: "ret-1",
      externalOrderId: "ord-1"
    })
  });

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: "Invalid signature" });
  assert.equal(serviceCalled, false);
});

test("POST /public/order-returns rejects an invalid payload before service access", async () => {
  let serviceCalled = false;
  const router = createOrderReturnRoutes({
    processOrderReturn: async () => {
      serviceCalled = true;
      return {};
    }
  });

  const signedPayload = JSON.stringify({
    businessSlug: "cafe-gt",
    externalReturnId: "ret-1"
  });
  const signature = crypto.createHmac("sha256", "topsecret").update(signedPayload).digest("hex");
  const res = await runRoute(router, "post", "/public/order-returns", {
    method: "POST",
    path: "/public/order-returns",
    originalUrl: "/public/order-returns",
    url: "/public/order-returns",
    ip: "127.0.0.1",
    headers: { "x-signature": signature },
    body: {
      businessSlug: "cafe-gt",
      externalReturnId: "ret-1"
    },
    rawBody: signedPayload
  });

  assert.equal(res.statusCode, 400);
  assert.equal(serviceCalled, false);
});

test("POST /public/order-returns validates and verifies the request before reaching the service", async () => {
  const signedPayload = JSON.stringify({
    businessSlug: "cafe-gt",
    externalReturnId: "ret-1",
    externalOrderId: "ord-1",
    reason: "customer_refund",
    occurred_at: "2026-04-15T10:00:00.000Z",
    meta: { channel: "pos" }
  });
  const signature = crypto.createHmac("sha256", "topsecret").update(signedPayload).digest("hex");
  let serviceInput = null;
  const router = createOrderReturnRoutes({
    processOrderReturn: async (input) => {
      serviceInput = input;
      return {
        ok: true,
        orderReturnId: "11111111-1111-4111-8111-111111111111",
        orderId: "22222222-2222-4222-8222-222222222222",
        customerId: "33333333-3333-4333-8333-333333333333",
        outcome: "POSTED_REVERSED",
        pointsEffect: -12,
        reversalTransactionId: "44444444-4444-4444-8444-444444444444"
      };
    }
  });

  const res = await runRoute(router, "post", "/public/order-returns", {
    method: "POST",
    path: "/public/order-returns",
    originalUrl: "/public/order-returns",
    url: "/public/order-returns",
    ip: "127.0.0.1",
    headers: { "x-signature": signature },
    body: JSON.parse(signedPayload),
    rawBody: signedPayload
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.outcome, "POSTED_REVERSED");
  assert.deepEqual(serviceInput, {
    businessSlug: "cafe-gt",
    externalReturnId: "ret-1",
    externalOrderId: "ord-1",
    reason: "customer_refund",
    occurred_at: "2026-04-15T10:00:00.000Z",
    meta: { channel: "pos" }
  });
});
