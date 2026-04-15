import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

process.env.NODE_ENV = "test";
process.env.PAYMENT_WEBHOOK_HMAC_SECRETS = JSON.stringify({ "cafe-gt": "topsecret" });

const { createContactSyncRoutes } = await import("../../src/app/routes/contact-sync-routes.js");

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

test("POST /public/contacts rejects an invalid signature", async () => {
  let upsertCalled = false;
  const router = createContactSyncRoutes({
    BusinessRepo: {
      getPublicBySlug: async () => ({ id: "biz-1", slug: "cafe-gt" })
    },
    withDbClientContext: async (_ctx, task) => task({}),
    upsertContactWithDeps: async () => {
      upsertCalled = true;
      return { id: "customer-1" };
    },
    listContactIdentifiersWithDeps: async () => []
  });

  const res = await runRoute(router, "post", "/public/contacts", {
    method: "POST",
    path: "/public/contacts",
    originalUrl: "/public/contacts",
    url: "/public/contacts",
    ip: "127.0.0.1",
    headers: { "x-signature": "bad-signature" },
    body: { businessSlug: "cafe-gt", phone: "5555-4444", name: "Ana" },
    rawBody: JSON.stringify({ businessSlug: "cafe-gt", phone: "5555-4444", name: "Ana" })
  });

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: "Invalid signature" });
  assert.equal(upsertCalled, false);
});

test("POST /public/contacts/lookup returns the scoped contact and identifiers", async () => {
  const customerId = "11111111-1111-4111-8111-111111111111";
  const router = createContactSyncRoutes({
    BusinessRepo: {
      getPublicBySlug: async (slug) => ({ id: "biz-1", slug })
    },
    CustomerRepo: {
      getByBusinessAndId: async (businessId, customerId) => ({
        id: customerId,
        business_id: businessId,
        phone: "50255554444",
        name: "Ana",
        points: 10,
        pending_points: 0,
        lifetime_points: 20
      })
    },
    ContactIdentifierRepo: {},
    withDbClientContext: async (_ctx, task) => task({ query: async () => ({ rows: [] }) }),
    listContactIdentifiersWithDeps: async (_deps, input) => {
      assert.deepEqual(input, { businessId: "biz-1", customerId });
      return [{
        id: "identifier-1",
        business_id: "biz-1",
        customer_id: customerId,
        identifier_type: "loyalty_card",
        identifier_value: "ABC123",
        active: true
      }];
    }
  });

  const signedPayload = JSON.stringify({
    businessSlug: "cafe-gt",
    customerId
  });
  const signature = crypto.createHmac("sha256", "topsecret").update(signedPayload).digest("hex");
  const res = await runRoute(router, "post", "/public/contacts/lookup", {
    method: "POST",
    path: "/public/contacts/lookup",
    originalUrl: "/public/contacts/lookup",
    url: "/public/contacts/lookup",
    ip: "127.0.0.1",
    headers: { "x-signature": signature },
    body: { businessSlug: "cafe-gt", customerId },
    rawBody: signedPayload
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.contact.id, customerId);
  assert.equal(res.body.identifiers.length, 1);
  assert.equal(res.body.identifiers[0].identifier_value, "ABC123");
});

test("POST /public/contacts/lookup rejects an invalid customerId before repo access", async () => {
  let repoCalled = false;
  const router = createContactSyncRoutes({
    BusinessRepo: {
      getPublicBySlug: async (slug) => ({ id: "biz-1", slug })
    },
    CustomerRepo: {
      getByBusinessAndId: async () => {
        repoCalled = true;
        return null;
      }
    },
    withDbClientContext: async (_ctx, task) => task({ query: async () => ({ rows: [] }) }),
    listContactIdentifiersWithDeps: async () => []
  });

  const signedPayload = JSON.stringify({
    businessSlug: "cafe-gt",
    customerId: "not-a-uuid"
  });
  const signature = crypto.createHmac("sha256", "topsecret").update(signedPayload).digest("hex");
  const res = await runRoute(router, "post", "/public/contacts/lookup", {
    method: "POST",
    path: "/public/contacts/lookup",
    originalUrl: "/public/contacts/lookup",
    url: "/public/contacts/lookup",
    ip: "127.0.0.1",
    headers: { "x-signature": signature },
    body: { businessSlug: "cafe-gt", customerId: "not-a-uuid" },
    rawBody: signedPayload
  });

  assert.equal(res.statusCode, 400);
  assert.equal(repoCalled, false);
});

test("POST /public/contacts/lookup rejects an invalid signature", async () => {
  let repoCalled = false;
  const customerId = "11111111-1111-4111-8111-111111111111";
  const router = createContactSyncRoutes({
    BusinessRepo: {
      getPublicBySlug: async (slug) => ({ id: "biz-1", slug })
    },
    CustomerRepo: {
      getByBusinessAndId: async () => {
        repoCalled = true;
        return null;
      }
    },
    withDbClientContext: async (_ctx, task) => task({ query: async () => ({ rows: [] }) }),
    listContactIdentifiersWithDeps: async () => []
  });

  const res = await runRoute(router, "post", "/public/contacts/lookup", {
    method: "POST",
    path: "/public/contacts/lookup",
    originalUrl: "/public/contacts/lookup",
    url: "/public/contacts/lookup",
    ip: "127.0.0.1",
    headers: { "x-signature": "bad-signature" },
    body: { businessSlug: "cafe-gt", customerId },
    rawBody: JSON.stringify({ businessSlug: "cafe-gt", customerId })
  });

  assert.equal(res.statusCode, 401);
  assert.equal(repoCalled, false);
});
