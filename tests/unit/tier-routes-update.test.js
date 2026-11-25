import test from "node:test";
import assert from "node:assert/strict";
import tierRoutes, { TierUpdateSchema } from "../../src/app/routes/tier-routes.js";
import { TierService } from "../../src/app/services/tier-service.js";
import { validate } from "../../src/utils/validation.js";

// PUT /admin/tiers/:id whitelists `active`, deleteTier tells owners to deactivate a tier
// that still has members, and TierRepository.update accepts `active`. The update schema
// must therefore keep the flag instead of letting zod strip it on the way in.

const UUID = "11111111-1111-4111-8111-111111111111";
const TENANT = "22222222-2222-4222-8222-222222222222";

function putHandler() {
  // Express's layer typings omit route.methods; the stack is inspected structurally here.
  const stack = /** @type {any[]} */ (tierRoutes.stack);
  const layer = stack.find(
    (entry) => entry.route?.path === "/admin/tiers/:id" && entry.route?.methods?.put,
  );
  assert.ok(layer, "Expected PUT /admin/tiers/:id");
  return layer.route.stack.at(-1).handle;
}

function makeRes() {
  return {
    statusCode: 200,
    /** @type {any} */
    body: null,
    /** @param {number} code */
    status(code) {
      this.statusCode = code;
      return this;
    },
    /** @param {unknown} payload */
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test("the tier update schema keeps a boolean active flag and still rejects non-booleans", () => {
  const off = /** @type {any} */ (validate(TierUpdateSchema, { active: false }));
  assert.equal(off.ok, true);
  assert.equal(off.data.active, false);
  const on = /** @type {any} */ (validate(TierUpdateSchema, { active: true, name: "Oro" }));
  assert.equal(on.ok, true);
  assert.deepEqual(on.data, { active: true, name: "Oro" });
  assert.equal(validate(TierUpdateSchema, { active: "no" }).ok, false);
});

test("PUT /admin/tiers/:id forwards active=false to the tier service", async (t) => {
  /** @type {any[]} */
  const calls = [];
  t.mock.method(TierService, "updateTier", async (/** @type {any[]} */ ...args) => {
    calls.push(args);
    return { id: args[0], business_id: args[1], ...args[2] };
  });
  const req = /** @type {any} */ ({
    body: { active: false, name: "Oro", tier_level: 9 },
    tenantId: TENANT,
    validatedParams: { id: UUID },
  });
  const res = makeRes();
  await putHandler()(req, res, (/** @type {unknown} */ err) => {
    throw err;
  });
  assert.equal(res.statusCode, 200);
  // tier_level stays out of an edit (existing whitelist); active now travels with the rest.
  assert.deepEqual(calls, [[UUID, TENANT, { name: "Oro", active: false }]]);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.tier.active, false);
});
