import test from "node:test";
import assert from "node:assert/strict";

const { resolveCustomerForIntegrationWithDeps } = await import("../../src/app/services/customer-resolution-service.js");

test("resolves by customerId before identifier and phone", async () => {
  let identifierLookupCalled = false;
  let phoneLookupCalled = false;

  const out = await resolveCustomerForIntegrationWithDeps({
    CustomerRepo: {
      getByBusinessAndId: async () => ({ id: "cust-1", business_id: "biz-1" }),
      getByBusinessAndPhone: async () => {
        phoneLookupCalled = true;
        return null;
      }
    },
    ContactIdentifierRepo: {
      getByBusinessTypeAndValue: async () => {
        identifierLookupCalled = true;
        return null;
      }
    }
  }, {
    businessId: "biz-1",
    customerId: "cust-1",
    identifierType: "loyalty_card",
    identifierValue: "ABC123",
    customerPhone: "+50255554444"
  });

  assert.equal(out.id, "cust-1");
  assert.equal(identifierLookupCalled, false);
  assert.equal(phoneLookupCalled, false);
});

test("falls back to identifier when customerId is missing or invalid", async () => {
  let lookupCalls = 0;

  const out = await resolveCustomerForIntegrationWithDeps({
    CustomerRepo: {
      getByBusinessAndId: async (_businessId, customerId) => {
        if (customerId === "cust-2") return { id: "cust-2", business_id: "biz-1" };
        return null;
      },
      getByBusinessAndPhone: async () => null
    },
    ContactIdentifierRepo: {
      getByBusinessTypeAndValue: async (_client, businessId, identifierType, identifierValue) => {
        lookupCalls += 1;
        assert.equal(businessId, "biz-1");
        assert.equal(identifierType, "loyalty_card");
        assert.equal(identifierValue, "ABC123");
        return { customer_id: "cust-2", active: true };
      }
    }
  }, {
    businessId: "biz-1",
    customerId: "cust-missing",
    identifierType: "loyalty_card",
    identifierValue: " ABC123 "
  });

  assert.equal(out.id, "cust-2");
  assert.equal(lookupCalls, 1);
});

test("falls back to normalized phone when identifier is missing", async () => {
  let observedPhone = null;

  const out = await resolveCustomerForIntegrationWithDeps({
    CustomerRepo: {
      getByBusinessAndId: async () => null,
      getByBusinessAndPhone: async (_businessId, phone) => {
        observedPhone = phone;
        return { id: "cust-phone", business_id: "biz-1", phone };
      }
    },
    ContactIdentifierRepo: {
      getByBusinessTypeAndValue: async () => null
    }
  }, {
    businessId: "biz-1",
    customerPhone: "5555-4444"
  });

  assert.equal(out.id, "cust-phone");
  assert.equal(observedPhone, "50255554444");
});

test("rejects when nothing resolves", async () => {
  await assert.rejects(
    () => resolveCustomerForIntegrationWithDeps({
      CustomerRepo: {
        getByBusinessAndId: async () => null,
        getByBusinessAndPhone: async () => null
      },
      ContactIdentifierRepo: {
        getByBusinessTypeAndValue: async () => null
      }
    }, {
      businessId: "biz-1",
      customerId: "cust-missing",
      identifierType: "loyalty_card",
      identifierValue: "ABC123",
      customerPhone: "5555-4444"
    }),
    /Customer not found for this business/
  );
});
