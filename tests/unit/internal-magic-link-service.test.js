import { test } from "node:test";
import assert from "node:assert/strict";

import { buildInternalMagicLink, consumeInternalMagicLink } from "../../src/app/services/internal-magic-link-service.js";

test("non-owner staff cannot get admin-dashboard target", async () => {
  await assert.rejects(
    () => buildInternalMagicLink({
      actorType: "staff",
      actor: { id: "staff-1", role: "CASHIER", business_id: "biz-1" },
      target: "admin-dashboard",
      createdBy: "super@test.com",
      origin: "https://app.example.com"
    }),
    /no puede abrir ese destino/i
  );
});

test("buildInternalMagicLink returns staff and customer magic-link URLs with the expected usage mode", async () => {
  const created = [];
  const baseDeps = {
    now: () => new Date("2026-04-03T12:00:00.000Z"),
    randomUUID: () => "link-id",
    randomBytes: () => ({ toString: () => "raw-token" }),
    InternalMagicLinkRepo: {
      create: async (record) => {
        created.push(record);
        return { id: record.id };
      }
    }
  };

  const staffResult = await buildInternalMagicLink({
    actorType: "staff",
    actor: { id: "staff-1", role: "OWNER", business_id: "biz-1" },
    target: "staff",
    createdBy: "super@test.com",
    origin: "https://app.example.com"
  }, baseDeps);

  const customerResult = await buildInternalMagicLink({
    actorType: "customer",
    actor: { id: "customer-1", business_id: "biz-1" },
    target: "customer-wallet",
    createdBy: "super@test.com",
    origin: "https://app.example.com"
  }, baseDeps);

  assert.equal(staffResult.id, "link-id");
  assert.equal(staffResult.usageMode, "single_use");
  assert.match(staffResult.url, /^https:\/\/app\.example\.com\/magic\/staff\/raw-token$/);
  assert.match(staffResult.expiresAt, /^2026-04-03T12:15:00\.000Z$/);

  assert.equal(customerResult.id, "link-id");
  assert.equal(customerResult.usageMode, "reusable_window");
  assert.match(customerResult.url, /^https:\/\/app\.example\.com\/magic\/customer\/raw-token$/);
  assert.match(customerResult.expiresAt, /^2026-04-03T12:15:00\.000Z$/);

  assert.equal(created.length, 2);
  assert.deepEqual(created.map((record) => record.usage_mode), ["single_use", "reusable_window"]);
  assert.deepEqual(created.map((record) => record.purpose), ["internal_test_access", "internal_test_access"]);
});

test("buildInternalMagicLink rejects invalid customer targets in Spanish", async () => {
  await assert.rejects(
    () => buildInternalMagicLink({
      actorType: "customer",
      actor: { id: "customer-1", business_id: "biz-1" },
      target: "admin-dashboard",
      createdBy: "super@test.com",
      origin: "https://app.example.com"
    }),
    /no puede abrir ese destino/i
  );
});

test("consumeInternalMagicLink rejects invalid tokens in Spanish", async () => {
  await assert.rejects(
    () => consumeInternalMagicLink("bad-token", {}, {
      InternalMagicLinkRepo: {
        lookupByTokenHash: async () => null
      }
    }),
    /no es válido/i
  );
});

test("consumeInternalMagicLink rejects already-used single-use tokens in Spanish", async () => {
  await assert.rejects(
    () => consumeInternalMagicLink("bad-token", {}, {
      InternalMagicLinkRepo: {
        lookupByTokenHash: async () => ({
          id: "link-1",
          usage_mode: "single_use",
          used_at: "2026-04-03T11:59:00.000Z"
        })
      }
    }),
    /ya fue usado/i
  );
});

test("consumeInternalMagicLink rejects staff links that cannot be consumed anymore", async () => {
  const signCalls = [];
  await assert.rejects(
    () => consumeInternalMagicLink("race-token", {}, {
      InternalMagicLinkRepo: {
        lookupByTokenHash: async () => ({
          id: "link-1",
          actor_type: "staff",
          actor_id: "staff-1",
          business_id: "biz-1",
          target: "staff",
          usage_mode: "single_use",
          used_at: null
        }),
        consumeSingleUse: async () => null
      },
      StaffRepo: {
        getById: async () => ({
          id: "staff-1",
          business_id: "biz-1",
          branch_id: "branch-1",
          role: "CASHIER"
        })
      },
      signStaffToken: async () => {
        signCalls.push(true);
        return "staff-token";
      }
    }),
    /ya fue usado/i
  );

  assert.equal(signCalls.length, 0);
});

test("consumeInternalMagicLink returns /staff with the pf_staff cookie name", async () => {
  const consumeCalls = [];
  const signCalls = [];
  const result = await consumeInternalMagicLink("staff-token", { ip: "127.0.0.1", ua: "staff-agent" }, {
    InternalMagicLinkRepo: {
      lookupByTokenHash: async () => ({
        id: "link-staff",
        actor_type: "staff",
        actor_id: "staff-1",
        business_id: "biz-1",
        target: "staff",
        usage_mode: "single_use",
        created_by: "super@test.com",
        used_at: null
      }),
      consumeSingleUse: async (id, meta) => {
        consumeCalls.push({ id, meta });
        return { id };
      }
    },
    StaffRepo: {
      getById: async () => ({
        id: "staff-1",
        business_id: "biz-1",
        branch_id: "branch-1",
        role: "CASHIER"
      })
    },
    signStaffToken: async (payload) => {
      signCalls.push(payload);
      return `staff-token:${payload.sid}:${payload.bid}`;
    },
    config: {
      CUSTOMER_COOKIE_NAME: "pf_customer",
      STAFF_COOKIE_NAME: "pf_staff"
    }
  });

  assert.equal(result.actorType, "staff");
  assert.equal(result.cookieName, "pf_staff");
  assert.equal(result.redirectTo, "/staff");
  assert.equal(result.token, "staff-token:staff-1:biz-1");
  assert.deepEqual(consumeCalls, [{
    id: "link-staff",
    meta: { ip: "127.0.0.1", ua: "staff-agent" }
  }]);
  assert.deepEqual(signCalls, [{
    sid: "staff-1",
    bid: "biz-1",
    brid: "branch-1",
    role: "CASHIER",
    imp: "super@test.com"
  }]);
});

test("customer consume returns /c with the pf_customer cookie name", async () => {
  const touchCalls = [];
  const result = await consumeInternalMagicLink("raw-token", { ip: "127.0.0.1", ua: "test-agent" }, {
    InternalMagicLinkRepo: {
      lookupByTokenHash: async () => ({
        id: "link-2",
        actor_type: "customer",
        actor_id: "customer-1",
        business_id: "biz-1",
        target: "customer-wallet",
        usage_mode: "reusable_window"
      }),
      touchReusable: async (id, meta) => {
        touchCalls.push({ id, meta });
        return { id };
      }
    },
    CustomerRepo: {
      getById: async () => ({
        id: "customer-1",
        business_id: "biz-1"
      })
    },
    signCustomerToken: async (payload) => `customer-token:${payload.cid}:${payload.bid}`,
    config: {
      CUSTOMER_COOKIE_NAME: "pf_customer",
      STAFF_COOKIE_NAME: "pf_staff"
    }
  });

  assert.equal(result.actorType, "customer");
  assert.equal(result.cookieName, "pf_customer");
  assert.equal(result.redirectTo, "/c");
  assert.equal(result.token, "customer-token:customer-1:biz-1");
  assert.equal(touchCalls.length, 1);
  assert.deepEqual(touchCalls[0], {
    id: "link-2",
    meta: { ip: "127.0.0.1", ua: "test-agent" }
  });
});

test("customer consume rejects invalid customer targets in Spanish", async () => {
  await assert.rejects(
    () => consumeInternalMagicLink("wrong-target", {}, {
      InternalMagicLinkRepo: {
        lookupByTokenHash: async () => ({
          id: "link-2",
          actor_type: "customer",
          actor_id: "customer-1",
          business_id: "biz-1",
          target: "admin-dashboard",
          usage_mode: "reusable_window"
        })
      },
      CustomerRepo: {
        getById: async () => ({
          id: "customer-1",
          business_id: "biz-1"
        })
      }
    }),
    /no puede abrir ese destino/i
  );
});

test("customer consume does not mint a session when touchReusable fails", async () => {
  const signCalls = [];
  await assert.rejects(
    () => consumeInternalMagicLink("touch-failed", {}, {
      InternalMagicLinkRepo: {
        lookupByTokenHash: async () => ({
          id: "link-3",
          actor_type: "customer",
          actor_id: "customer-1",
          business_id: "biz-1",
          target: "customer-wallet",
          usage_mode: "reusable_window"
        }),
        touchReusable: async () => null
      },
      CustomerRepo: {
        getById: async () => ({
          id: "customer-1",
          business_id: "biz-1"
        })
      },
      signCustomerToken: async () => {
        signCalls.push(true);
        return "customer-token";
      }
    }),
    /no es válido/i
  );

  assert.equal(signCalls.length, 0);
});

test("buildInternalMagicLink rejects invalid staff targets in Spanish", async () => {
  await assert.rejects(
    () => buildInternalMagicLink({
      actorType: "staff",
      actor: { id: "staff-1", role: "OWNER", business_id: "biz-1" },
      target: "customer-wallet",
      createdBy: "super@test.com",
      origin: "https://app.example.com"
    }),
    /no puede abrir ese destino/i
  );
});
