import test from "node:test";
import assert from "node:assert/strict";
import { CustomerRepo } from "../../src/app/repositories/customer-repository.js";
import { runWithDbContext } from "../../src/app/database.js";

const input = {
  id: "new-id",
  business_id: "business-a",
  phone: "50255555555",
  name: "New customer",
};

function database(existing = null) {
  let customer = existing;
  let balanceWrites = 0;
  return {
    get balanceWrites() {
      return balanceWrites;
    },
    client: {
      query: async (sql) => {
        if (/INSERT INTO customers/.test(sql)) {
          if (customer) {
            if (/ON CONFLICT.*DO NOTHING/.test(sql)) return { rows: [] };
            throw Object.assign(new Error("customers_business_id_phone_key"), { code: "23505" });
          }
          customer = { ...input, deleted_at: null };
          return { rows: [{ id: input.id }] };
        }
        if (/INSERT INTO customer_balances/.test(sql)) {
          balanceWrites += 1;
          return { rows: [] };
        }
        if (/FROM customers/.test(sql)) {
          if (!customer || (/deleted_at IS NULL/.test(sql) && customer.deleted_at))
            return { rows: [] };
          // Only the joined lookups carry the counters, as in the real schema.
          const joined = /JOIN customer_balances/.test(sql);
          return {
            rows: [
              joined
                ? { ...customer, points: 0, pending_points: 0, lifetime_points: 0, tier: null }
                : customer,
            ],
          };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    },
  };
}

test("enrollment of a deleted phone returns an explicit conflict without resurrecting old data", async () => {
  const db = database({ ...input, id: "deleted-id", deleted_at: new Date(), points: 1000 });
  await assert.rejects(
    runWithDbContext({ client: db.client }, () => CustomerRepo.create(input)),
    (error) => {
      const httpError = /** @type {Error & {statusCode: number}} */ (error);
      assert.equal(httpError.statusCode, 409);
      assert.match(httpError.message, /eliminada|desactivada/);
      return true;
    },
  );
  assert.equal(db.balanceWrites, 0);
});

test("enrollment creates a zero balance once and repeated enrollment returns the existing identity", async () => {
  const db = database();
  const first = await runWithDbContext({ client: db.client }, () => CustomerRepo.create(input));
  const second = await runWithDbContext({ client: db.client }, () =>
    CustomerRepo.create({ ...input, id: "other-id" }),
  );
  assert.equal(first.id, input.id);
  assert.equal(second.id, input.id);
  assert.equal(db.balanceWrites, 1);
});

test("repeated enrollment returns the same joined shape as a fresh enrollment", async () => {
  const db = database();
  const first = await runWithDbContext({ client: db.client }, () => CustomerRepo.create(input));
  const second = await runWithDbContext({ client: db.client }, () =>
    CustomerRepo.create({ ...input, id: "other-id" }),
  );
  // Callers project the balance counters from this result (mobile join/login response), so
  // the conflicting path must not hand back a bare customers row.
  assert.deepEqual(Object.keys(second).sort(), Object.keys(first).sort());
  assert.equal(second.points, 0);
  assert.equal(second.pending_points, 0);
  assert.equal(second.lifetime_points, 0);
});

test("concurrent enrollment converges on one phone identity without a database uniqueness error", async () => {
  const db = database();
  const results = await Promise.all([
    runWithDbContext({ client: db.client }, () => CustomerRepo.create(input)),
    runWithDbContext({ client: db.client }, () =>
      CustomerRepo.create({ ...input, id: "other-id" }),
    ),
  ]);
  assert.equal(results[0].id, results[1].id);
  assert.equal(db.balanceWrites, 1);
});
