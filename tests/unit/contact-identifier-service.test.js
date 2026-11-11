import test from "node:test";
import assert from "node:assert/strict";

const {
  linkContactIdentifierWithDeps,
  listContactIdentifiersWithDeps,
  unlinkContactIdentifierWithDeps,
  resolveContactIdentifierWithDeps
} = await import("../../src/app/services/contact-identifier-service.js");

test("rejects linking an identifier already assigned to another customer", async () => {
  let lookupArgs = null;
  await assert.rejects(
    () => linkContactIdentifierWithDeps({
      CustomerRepo: {
        getByBusinessAndId: async () => ({ id: "customer-1", business_id: "business-1" })
      },
      ContactIdentifierRepo: {
        getByBusinessTypeAndValue: async (_client, businessId, identifierType, identifierValue) => {
          lookupArgs = { businessId, identifierType, identifierValue };
          return {
            id: "identifier-1",
            business_id: "business-1",
            customer_id: "customer-2",
            identifier_type: "loyalty_card",
            identifier_value: "ABC123",
            active: true
          };
        }
      }
    }, {
      businessId: "business-1",
      customerId: "customer-1",
      identifierType: "loyalty_card",
      identifierValue: " ABC123 "
    }),
    { statusCode: 409, message: /another customer/i }
  );

  assert.deepEqual(lookupArgs, {
    businessId: "business-1",
    identifierType: "loyalty_card",
    identifierValue: "ABC123"
  });
});

test("links a new identifier for the scoped customer with trimmed value and metadata", async () => {
  /** @type {{client: unknown, input: {business_id: string, customer_id: string, identifier_type: string, identifier_value: string, label: string, meta: Record<string, unknown>, active: boolean}} | null} */
  let createArgs = null;
  const out = await linkContactIdentifierWithDeps({
    client: { query: async () => ({ rows: [], rowCount: 0 }) },
    CustomerRepo: {
      getByBusinessAndId: async (businessId, customerId) => ({
        id: customerId,
        business_id: businessId
      })
    },
    ContactIdentifierRepo: {
      getByBusinessTypeAndValue: async () => null,
      getAnyByBusinessTypeAndValue: async () => null,
      create: async (client, input) => {
        createArgs = { client, input };
        return { id: "identifier-1", ...input };
      }
    }
  }, {
    businessId: "business-1",
    customerId: "customer-1",
    identifierType: "loyalty_card",
    identifierValue: " ABC123 ",
    label: "VIP",
    meta: { source: "api" }
  });

  assert.equal(out.id, "identifier-1");
  assert.ok(createArgs, "The identifier must be persisted");
  assert.equal(createArgs.input.business_id, "business-1");
  assert.equal(createArgs.input.customer_id, "customer-1");
  assert.equal(createArgs.input.identifier_type, "loyalty_card");
  assert.equal(createArgs.input.identifier_value, "ABC123");
  assert.equal(createArgs.input.label, "VIP");
  assert.deepEqual(createArgs.input.meta, { source: "api" });
  assert.equal(createArgs.input.active, true);
});

test("resolves an active identifier to a customer", async () => {
  const out = await resolveContactIdentifierWithDeps({
    CustomerRepo: {
      getByBusinessAndId: async (businessId, customerId) => ({
        id: customerId,
        business_id: businessId,
        name: "Ana"
      })
    },
    ContactIdentifierRepo: {
      getByBusinessTypeAndValue: async (_client, businessId, identifierType, identifierValue) => {
        assert.equal(businessId, "business-1");
        assert.equal(identifierType, "loyalty_card");
        assert.equal(identifierValue, "ABC123");
        return {
          id: "identifier-1",
          business_id: "business-1",
          customer_id: "customer-1",
          identifier_type: "loyalty_card",
          identifier_value: "ABC123",
          active: true
        };
      }
    }
  }, {
    businessId: "business-1",
    identifierType: "loyalty_card",
    identifierValue: " ABC123 "
  });

  assert.equal(out.id, "customer-1");
  assert.equal(out.business_id, "business-1");
});

test("unlink deactivates instead of deleting", async () => {
  let deactivateArgs = null;
  const out = await unlinkContactIdentifierWithDeps({
    ContactIdentifierRepo: {
      deactivate: async (client, businessId, identifierType, identifierValue) => {
        deactivateArgs = { client, businessId, identifierType, identifierValue };
        return {
          id: "identifier-1",
          business_id: businessId,
          identifier_type: identifierType,
          identifier_value: identifierValue,
          active: false
        };
      }
    }
  }, {
    businessId: "business-1",
    identifierType: "loyalty_card",
    identifierValue: " ABC123 "
  });

  assert.deepEqual(deactivateArgs, {
    client: null,
    businessId: "business-1",
    identifierType: "loyalty_card",
    identifierValue: "ABC123"
  });
  assert.equal(out.active, false);
});

test("list returns identifiers for a scoped customer", async () => {
  const out = await listContactIdentifiersWithDeps({
    CustomerRepo: {
      getByBusinessAndId: async (businessId, customerId) => ({
        id: customerId,
        business_id: businessId
      })
    },
    ContactIdentifierRepo: {
      listByCustomer: async (_client, businessId, customerId) => ([
        {
          id: "identifier-1",
          business_id: businessId,
          customer_id: customerId,
          identifier_type: "loyalty_card",
          identifier_value: "ABC123",
          active: true
        }
      ])
    }
  }, {
    businessId: "business-1",
    customerId: "customer-1"
  });

  assert.equal(out.length, 1);
  assert.equal(out[0].business_id, "business-1");
  assert.equal(out[0].customer_id, "customer-1");
});

test("rejects relinking an inactive identifier for the same scoped customer", async () => {
  await assert.rejects(
    () => linkContactIdentifierWithDeps({
      client: { query: async () => ({ rows: [], rowCount: 0 }) },
      CustomerRepo: {
        getByBusinessAndId: async (businessId, customerId) => ({
          id: customerId,
          business_id: businessId
        })
      },
      ContactIdentifierRepo: {
        getByBusinessTypeAndValue: async () => null,
        getAnyByBusinessTypeAndValue: async () => ({
          id: "identifier-1",
          business_id: "business-1",
          customer_id: "customer-1",
          identifier_type: "loyalty_card",
          identifier_value: "ABC123",
          active: false
        })
      }
    }, {
      businessId: "business-1",
      customerId: "customer-1",
      identifierType: "loyalty_card",
      identifierValue: " ABC123 "
    }),
    { statusCode: 409, message: /inactive/i }
  );
});

test("list keeps business scope when delegating to the repository", async () => {
  let listArgs = null;
  await listContactIdentifiersWithDeps({
    CustomerRepo: {
      getByBusinessAndId: async (businessId, customerId) => ({
        id: customerId,
        business_id: businessId
      })
    },
    ContactIdentifierRepo: {
      listByCustomer: async (_client, businessId, customerId) => {
        listArgs = { businessId, customerId };
        return [];
      }
    }
  }, {
    businessId: "business-1",
    customerId: "customer-1"
  });

  assert.deepEqual(listArgs, {
    businessId: "business-1",
    customerId: "customer-1"
  });
});
