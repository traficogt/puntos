import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  businessRegisterSchema,
  staffLoginSchema,
  customerJoinSchema,
  customerVerifySchema,
  awardPointsSchema,
  rewardCreateSchema,
  webhookCreateSchema,
  phoneSchema
} from "../../src/utils/schemas.js";

describe("Validation Schemas", () => {
  describe("Phone number validation", () => {
    it("should accept valid Guatemala phone number", () => {
      const result = phoneSchema.safeParse("+50212345678");
      assert.ok(result.success);
    });

    it("should reject phone without +502 prefix", () => {
      const result = phoneSchema.safeParse("12345678");
      assert.ok(!result.success);
    });

    it("should reject phone with wrong country code", () => {
      const result = phoneSchema.safeParse("+50112345678");
      assert.ok(!result.success);
    });

    it("should reject phone with wrong length", () => {
      const result = phoneSchema.safeParse("+5021234567");
      assert.ok(!result.success);
    });

    it("should reject phone with non-digits after prefix", () => {
      const result = phoneSchema.safeParse("+502abcd5678");
      assert.ok(!result.success);
    });
  });

  describe("Business registration", () => {
    const validBusiness = {
      name: "Test Business",
      slug: "test-business",
      email: "test@example.com",
      password: "SecurePass123!",
      phone: "+50212345678",
      program_type: "SPEND"
    };

    it("should accept valid business registration", () => {
      const result = businessRegisterSchema.safeParse(validBusiness);
      assert.ok(result.success);
    });

    it("should reject business with short name", () => {
      const result = businessRegisterSchema.safeParse({
        ...validBusiness,
        name: "X"
      });
      assert.ok(!result.success);
    });

    it("should reject business with invalid slug", () => {
      const result = businessRegisterSchema.safeParse({
        ...validBusiness,
        slug: "Invalid Slug!"
      });
      assert.ok(!result.success);
    });

    it("should reject business with invalid email", () => {
      const result = businessRegisterSchema.safeParse({
        ...validBusiness,
        email: "not-an-email"
      });
      assert.ok(!result.success);
    });

    it("should reject business with short password", () => {
      const result = businessRegisterSchema.safeParse({
        ...validBusiness,
        password: "short"
      });
      assert.ok(!result.success);
    });

    it("should reject business with invalid program type", () => {
      const result = businessRegisterSchema.safeParse({
        ...validBusiness,
        program_type: "INVALID"
      });
      assert.ok(!result.success);
    });

    it("should accept business without optional fields", () => {
      const minimal = {
        name: "Test Business",
        slug: "test-business",
        email: "test@example.com",
        password: "SecurePass123!",
        phone: "+50212345678"
      };
      const result = businessRegisterSchema.safeParse(minimal);
      assert.ok(result.success);
    });

    it("should reject negative points_per_quetzal", () => {
      const result = businessRegisterSchema.safeParse({
        ...validBusiness,
        points_per_quetzal: -1
      });
      assert.ok(!result.success);
    });

    it("should reject excessively high points_per_quetzal", () => {
      const result = businessRegisterSchema.safeParse({
        ...validBusiness,
        points_per_quetzal: 10000
      });
      assert.ok(!result.success);
    });
  });

  describe("Staff login", () => {
    it("should accept valid staff login", () => {
      const result = staffLoginSchema.safeParse({
        email: "staff@example.com",
        password: "password123"
      });
      assert.ok(result.success);
    });

    it("should reject invalid email", () => {
      const result = staffLoginSchema.safeParse({
        email: "not-an-email",
        password: "password123"
      });
      assert.ok(!result.success);
    });

    it("should reject empty password", () => {
      const result = staffLoginSchema.safeParse({
        email: "staff@example.com",
        password: ""
      });
      assert.ok(!result.success);
    });

    it("should reject missing fields", () => {
      const result = staffLoginSchema.safeParse({
        email: "staff@example.com"
      });
      assert.ok(!result.success);
    });
  });

  describe("Customer join", () => {
    it("should accept valid customer join", () => {
      const result = customerJoinSchema.safeParse({
        slug: "test-business",
        name: "John Doe",
        phone: "+50212345678"
      });
      assert.ok(result.success);
    });

    it("should reject invalid slug", () => {
      const result = customerJoinSchema.safeParse({
        slug: "Invalid Slug!",
        name: "John Doe",
        phone: "+50212345678"
      });
      assert.ok(!result.success);
    });

    it("should reject short name", () => {
      const result = customerJoinSchema.safeParse({
        slug: "test-business",
        name: "X",
        phone: "+50212345678"
      });
      assert.ok(!result.success);
    });

    it("should reject invalid phone", () => {
      const result = customerJoinSchema.safeParse({
        slug: "test-business",
        name: "John Doe",
        phone: "12345678"
      });
      assert.ok(!result.success);
    });
  });

  describe("Customer verify", () => {
    it("should accept valid verification", () => {
      const result = customerVerifySchema.safeParse({
        phone: "+50212345678",
        code: "123456",
        slug: "test-business"
      });
      assert.ok(result.success);
    });

    it("should reject non-6-digit code", () => {
      const result = customerVerifySchema.safeParse({
        phone: "+50212345678",
        code: "12345",
        slug: "test-business"
      });
      assert.ok(!result.success);
    });

    it("should reject code with letters", () => {
      const result = customerVerifySchema.safeParse({
        phone: "+50212345678",
        code: "12345a",
        slug: "test-business"
      });
      assert.ok(!result.success);
    });
  });

  describe("Award points", () => {
    it("should accept valid award with amount", () => {
      const result = awardPointsSchema.safeParse({
        customerQrToken: "valid-token-string",
        amount_q: 100.50
      });
      assert.ok(result.success);
    });

    it("should accept valid award with visits", () => {
      const result = awardPointsSchema.safeParse({
        customerQrToken: "valid-token-string",
        visits: 1
      });
      assert.ok(result.success);
    });

    it("should accept valid award with items", () => {
      const result = awardPointsSchema.safeParse({
        customerQrToken: "valid-token-string",
        items: 5
      });
      assert.ok(result.success);
    });

    it("should reject negative amount", () => {
      const result = awardPointsSchema.safeParse({
        customerQrToken: "valid-token-string",
        amount_q: -10
      });
      assert.ok(!result.success);
    });

    it("should reject excessively high amount", () => {
      const result = awardPointsSchema.safeParse({
        customerQrToken: "valid-token-string",
        amount_q: 2000000
      });
      assert.ok(!result.success);
    });

    it("should reject negative visits", () => {
      const result = awardPointsSchema.safeParse({
        customerQrToken: "valid-token-string",
        visits: -1
      });
      assert.ok(!result.success);
    });

    it("should reject fractional visits", () => {
      const result = awardPointsSchema.safeParse({
        customerQrToken: "valid-token-string",
        visits: 1.5
      });
      assert.ok(!result.success);
    });

    it("should accept valid source", () => {
      const result = awardPointsSchema.safeParse({
        customerQrToken: "valid-token-string",
        amount_q: 100,
        source: "offline"
      });
      assert.ok(result.success);
    });

    it("should reject invalid source", () => {
      const result = awardPointsSchema.safeParse({
        customerQrToken: "valid-token-string",
        amount_q: 100,
        source: "invalid"
      });
      assert.ok(!result.success);
    });
  });

  describe("Reward creation", () => {
    it("should accept valid reward", () => {
      const result = rewardCreateSchema.safeParse({
        name: "Free Coffee",
        description: "One free coffee of any size",
        points_cost: 10
      });
      assert.ok(result.success);
    });

    it("should reject reward with short name", () => {
      const result = rewardCreateSchema.safeParse({
        name: "X",
        points_cost: 10
      });
      assert.ok(!result.success);
    });

    it("should reject reward with zero points", () => {
      const result = rewardCreateSchema.safeParse({
        name: "Free Coffee",
        points_cost: 0
      });
      assert.ok(!result.success);
    });

    it("should reject reward with negative points", () => {
      const result = rewardCreateSchema.safeParse({
        name: "Free Coffee",
        points_cost: -10
      });
      assert.ok(!result.success);
    });

    it("should reject reward with fractional points", () => {
      const result = rewardCreateSchema.safeParse({
        name: "Free Coffee",
        points_cost: 10.5
      });
      assert.ok(!result.success);
    });

    it("should accept reward with stock", () => {
      const result = rewardCreateSchema.safeParse({
        name: "Limited Edition Mug",
        points_cost: 100,
        stock: 50
      });
      assert.ok(result.success);
    });

    it("should reject negative stock", () => {
      const result = rewardCreateSchema.safeParse({
        name: "Limited Edition Mug",
        points_cost: 100,
        stock: -1
      });
      assert.ok(!result.success);
    });

    it("should accept reward with expiration date", () => {
      const result = rewardCreateSchema.safeParse({
        name: "Holiday Special",
        points_cost: 20,
        valid_until: "2025-12-31T23:59:59Z"
      });
      assert.ok(result.success);
    });

    it("should reject invalid date format", () => {
      const result = rewardCreateSchema.safeParse({
        name: "Holiday Special",
        points_cost: 20,
        valid_until: "2025-12-31"
      });
      assert.ok(!result.success);
    });
  });

  describe("Webhook creation", () => {
    it("should accept valid webhook", () => {
      const result = webhookCreateSchema.safeParse({
        url: "https://example.com/webhook",
        events: ["points.awarded", "reward.redeemed"]
      });
      assert.ok(result.success);
    });

    it("should reject invalid URL", () => {
      const result = webhookCreateSchema.safeParse({
        url: "not-a-url",
        events: ["points.awarded"]
      });
      assert.ok(!result.success);
    });

    it("should reject empty events array", () => {
      const result = webhookCreateSchema.safeParse({
        url: "https://example.com/webhook",
        events: []
      });
      assert.ok(!result.success);
    });

    it("should accept wildcard event", () => {
      const result = webhookCreateSchema.safeParse({
        url: "https://example.com/webhook",
        events: ["*"]
      });
      assert.ok(result.success);
    });

    it("should accept optional secret", () => {
      const result = webhookCreateSchema.safeParse({
        url: "https://example.com/webhook",
        events: ["points.awarded"],
        secret: "my-very-secure-secret-key"
      });
      assert.ok(result.success);
    });

    it("should reject short secret", () => {
      const result = webhookCreateSchema.safeParse({
        url: "https://example.com/webhook",
        events: ["points.awarded"],
        secret: "short"
      });
      assert.ok(!result.success);
    });
  });

  describe("Security boundaries", () => {
    it("should reject excessively long strings", () => {
      const veryLongString = "a".repeat(10000);
      const result = businessRegisterSchema.safeParse({
        name: veryLongString,
        slug: "test",
        email: "test@example.com",
        password: "password123",
        phone: "+50212345678"
      });
      assert.ok(!result.success);
    });

    it("should enforce reasonable limits on numeric values", () => {
      const result = rewardCreateSchema.safeParse({
        name: "Test",
        points_cost: 999999999
      });
      assert.ok(!result.success);
    });

    it("should validate data types strictly", () => {
      const result = awardPointsSchema.safeParse({
        customerQrToken: "token",
        amount_q: "not a number" // Should be number
      });
      assert.ok(!result.success);
    });
  });
});
