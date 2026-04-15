import test from "node:test";
import assert from "node:assert/strict";

const { upsertContactWithDeps } = await import("../../src/app/services/contact-sync-service.js");

test("creates a customer when no phone match exists", async () => {
  let created = null;
  const out = await upsertContactWithDeps({
    randomUUID: () => "cust-1",
    CustomerRepo: {
      getByBusinessAndPhone: async () => null,
      create: async (input) => {
        created = input;
        return { id: input.id, business_id: input.business_id, phone: input.phone, name: input.name };
      },
      updateName: async () => {
        throw new Error("should not update");
      }
    }
  }, {
    businessId: "biz-1",
    phone: "5555-4444",
    name: "Ana"
  });

  assert.equal(created.phone, "50255554444");
  assert.equal(created.business_id, "biz-1");
  assert.equal(out.phone, "50255554444");
  assert.equal(out.name, "Ana");
});

test("updates name when phone match exists", async () => {
  let updateArgs = null;
  const out = await upsertContactWithDeps({
    CustomerRepo: {
      getByBusinessAndPhone: async () => ({ id: "cust-1", business_id: "biz-1", phone: "50255554444", name: "Old" }),
      create: async () => {
        throw new Error("should not create");
      },
      updateName: async (customerId, name) => {
        updateArgs = { customerId, name };
        return { id: customerId, business_id: "biz-1", phone: "50255554444", name };
      }
    }
  }, {
    businessId: "biz-1",
    phone: "50255554444",
    name: "Ana"
  });

  assert.deepEqual(updateArgs, { customerId: "cust-1", name: "Ana" });
  assert.equal(out.name, "Ana");
});

test("rejects when no phone and no customerId are provided", async () => {
  await assert.rejects(
    () => upsertContactWithDeps({
      CustomerRepo: {
        getByBusinessAndPhone: async () => null,
        create: async () => {
          throw new Error("should not create");
        },
        updateName: async () => {
          throw new Error("should not update");
        }
      }
    }, {
      businessId: "biz-1",
      name: "Ana"
    }),
    (err) => err?.statusCode === 400 && /phone/i.test(err.message)
  );
});

test("rejects when phone and customerId point to different customers", async () => {
  await assert.rejects(
    () => upsertContactWithDeps({
      CustomerRepo: {
        getByBusinessAndPhone: async () => ({ id: "cust-phone", business_id: "biz-1", phone: "50255554444", name: "Ana" }),
        getByBusinessAndId: async () => ({ id: "cust-other", business_id: "biz-1", phone: "50255559999", name: "Bea" }),
        create: async () => {
          throw new Error("should not create");
        },
        updateName: async () => {
          throw new Error("should not update");
        }
      }
    }, {
      businessId: "biz-1",
      phone: "5555-4444",
      customerId: "cust-other",
      name: "Ana"
    }),
    (err) => err?.statusCode === 409 && /different customers/i.test(err.message)
  );
});

test("rejects when supplied customerId does not resolve for the business", async () => {
  await assert.rejects(
    () => upsertContactWithDeps({
      CustomerRepo: {
        getByBusinessAndPhone: async () => null,
        getByBusinessAndId: async () => null,
        create: async () => {
          throw new Error("should not create");
        },
        updateName: async () => {
          throw new Error("should not update");
        }
      }
    }, {
      businessId: "biz-1",
      phone: "5555-4444",
      customerId: "cust-missing",
      name: "Ana"
    }),
    (err) => err?.statusCode === 404 && /customer not found/i.test(err.message)
  );
});

test("customerId-only update succeeds", async () => {
  let updateArgs = null;
  const out = await upsertContactWithDeps({
    CustomerRepo: {
      getByBusinessAndId: async () => ({ id: "cust-1", business_id: "biz-1", phone: "50255554444", name: "Old" }),
      updateName: async (customerId, name) => {
        updateArgs = { customerId, name };
        return { id: customerId, business_id: "biz-1", phone: "50255554444", name };
      }
    }
  }, {
    businessId: "biz-1",
    customerId: "cust-1",
    name: "Ana"
  });

  assert.deepEqual(updateArgs, { customerId: "cust-1", name: "Ana" });
  assert.equal(out.name, "Ana");
});

test("customerId-only rejects when not found", async () => {
  await assert.rejects(
    () => upsertContactWithDeps({
      CustomerRepo: {
        getByBusinessAndId: async () => null,
        updateName: async () => {
          throw new Error("should not update");
        }
      }
    }, {
      businessId: "biz-1",
      customerId: "cust-missing",
      name: "Ana"
    }),
    (err) => err?.statusCode === 404 && /customer not found/i.test(err.message)
  );
});

test("customerId-only does nothing when name is unchanged", async () => {
  let updateCalled = false;
  const existing = { id: "cust-1", business_id: "biz-1", phone: "50255554444", name: "Ana" };
  const out = await upsertContactWithDeps({
    CustomerRepo: {
      getByBusinessAndId: async () => existing,
      updateName: async () => {
        updateCalled = true;
        throw new Error("should not update");
      }
    }
  }, {
    businessId: "biz-1",
    customerId: "cust-1",
    name: "Ana"
  });

  assert.equal(out, existing);
  assert.equal(updateCalled, false);
});
