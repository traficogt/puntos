import test from "node:test";
import assert from "node:assert/strict";

import { createMagicLinkCli } from "../../src/scripts/create-magic-link.mjs";

test("createMagicLinkCli returns a customer magic-link URL and usage mode", async () => {
  const dbContexts = [];
  const buildCalls = [];
  let closeCount = 0;

  const output = await createMagicLinkCli({
    argv: [
      "--actor",
      "customer",
      "--target",
      "customer-wallet",
      "--customer-id",
      "customer-123"
    ],
    config: {
      APP_ORIGIN: "https://app.example.com",
      PUBLIC_WEB_ORIGIN: "https://public.example.com"
    },
    withDbClientContext: async (ctx, fn) => {
      dbContexts.push(ctx);
      return fn();
    },
    closeDatabase: async () => {
      closeCount += 1;
    },
    CustomerRepo: {
      getById: async (id) => ({
        id,
        business_id: "biz-1"
      })
    },
    StaffRepo: {
      getById: async () => null,
      getByEmail: async () => null
    },
    buildInternalMagicLink: async (payload) => {
      buildCalls.push(payload);
      return {
        url: "https://app.example.com/api/magic/customer/raw-token",
        usageMode: "reusable_window",
        expiresAt: "2026-04-03T12:15:00.000Z"
      };
    }
  });

  assert.match(output, /url:\s*https:\/\/app\.example\.com\/api\/magic\/customer\/raw-token/i);
  assert.match(output, /usage_mode:\s*reusable_window/i);
  assert.match(output, /expires_at:\s*2026-04-03T12:15:00\.000Z/i);
  assert.deepEqual(dbContexts, [{ platformAdmin: true, tenantId: null }]);
  assert.equal(closeCount, 1);
  assert.equal(buildCalls.length, 1);
  assert.equal(buildCalls[0].createdBy, "terminal");
  assert.equal(buildCalls[0].origin, "https://app.example.com");
  assert.equal(buildCalls[0].target, "customer-wallet");
  assert.equal(buildCalls[0].actorType, "customer");
});
