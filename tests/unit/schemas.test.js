import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  awardPointsSchema,
  businessRegisterSchema,
  phoneSchema,
  redeemRewardSchema,
  requestJoinCodeSchema,
  staffCreateSchema,
  staffLoginSchema,
  verifyJoinCodeSchema,
  webhookCreateSchema
} from "../../src/utils/schemas.js";

describe("Validation Schemas", () => {
  describe("phoneSchema", () => {
    it("accepts Guatemala E.164 numbers", () => {
      assert.equal(phoneSchema.safeParse("+50212345678").success, true);
    });

    it("rejects malformed phone numbers", () => {
      assert.equal(phoneSchema.safeParse("12345678").success, false);
      assert.equal(phoneSchema.safeParse("+50112345678").success, false);
      assert.equal(phoneSchema.safeParse("+502abcd5678").success, false);
    });
  });

  describe("businessRegisterSchema", () => {
    const validBusiness = {
      name: "Demo Coffee",
      slug: "demo-coffee",
      email: "owner@example.com",
      password: "SecurePassword123!",
      phone: "+50212345678",
      category: "coffee",
      program_type: "SPEND",
      registration_token: "1234567890abcdef"
    };

    it("accepts the live public registration payload", () => {
      assert.equal(businessRegisterSchema.safeParse(validBusiness).success, true);
    });

    it("rejects invalid slug, email, and short password", () => {
      assert.equal(businessRegisterSchema.safeParse({ ...validBusiness, slug: "Bad Slug!" }).success, false);
      assert.equal(businessRegisterSchema.safeParse({ ...validBusiness, email: "not-an-email" }).success, false);
      assert.equal(businessRegisterSchema.safeParse({ ...validBusiness, password: "short" }).success, false);
    });

    it("allows registration without optional fields", () => {
      const minimal = {
        name: "Demo Coffee",
        slug: "demo-coffee",
        email: "owner@example.com",
        password: "SecurePassword123!",
        phone: "12345678"
      };
      assert.equal(businessRegisterSchema.safeParse(minimal).success, true);
    });
  });

  describe("staffLoginSchema", () => {
    it("accepts valid login input", () => {
      assert.equal(staffLoginSchema.safeParse({
        email: "staff@example.com",
        password: "secret123"
      }).success, true);
    });

    it("rejects missing password", () => {
      assert.equal(staffLoginSchema.safeParse({ email: "staff@example.com" }).success, false);
    });
  });

  describe("staffCreateSchema", () => {
    it("matches the owner-managed admin staff payload", () => {
      assert.equal(staffCreateSchema.safeParse({
        name: "Cashier One",
        email: "cashier@example.com",
        phone: "+50212345678",
        password: "SecurePassword123!",
        role: "CASHIER",
        can_manage_gift_cards: true
      }).success, true);
    });

    it("rejects unsupported staff roles", () => {
      assert.equal(staffCreateSchema.safeParse({
        name: "Owner Clone",
        email: "owner2@example.com",
        password: "SecurePassword123!",
        role: "OWNER"
      }).success, false);
    });
  });

  describe("requestJoinCodeSchema", () => {
    it("accepts the current join-code request shape", () => {
      assert.equal(requestJoinCodeSchema.safeParse({
        phone: "+50212345678",
        name: "John Doe"
      }).success, true);
    });

    it("rejects too-short phone input", () => {
      assert.equal(requestJoinCodeSchema.safeParse({
        phone: "12345"
      }).success, false);
    });
  });

  describe("verifyJoinCodeSchema", () => {
    it("accepts referral code and short verification codes", () => {
      assert.equal(verifyJoinCodeSchema.safeParse({
        phone: "+50212345678",
        code: "1234",
        referralCode: "ABC123"
      }).success, true);
    });

    it("rejects invalid referral code length", () => {
      assert.equal(verifyJoinCodeSchema.safeParse({
        phone: "+50212345678",
        code: "123456",
        referralCode: "SHORT"
      }).success, false);
    });
  });

  describe("awardPointsSchema", () => {
    it("accepts amount, visit, and item awards", () => {
      assert.equal(awardPointsSchema.safeParse({
        customerQrToken: "valid-token-string",
        amount_q: 100.5,
        txId: "11111111-1111-4111-8111-111111111111"
      }).success, true);
      assert.equal(awardPointsSchema.safeParse({
        customerQrToken: "valid-token-string",
        visits: 1,
        txId: "11111111-1111-4111-8111-111111111111"
      }).success, true);
      assert.equal(awardPointsSchema.safeParse({
        customerQrToken: "valid-token-string",
        items: 5,
        txId: "11111111-1111-4111-8111-111111111111"
      }).success, true);
    });

    it("rejects missing txId and negative or zero progress payloads", () => {
      assert.equal(awardPointsSchema.safeParse({
        customerQrToken: "valid-token-string",
        amount_q: 1
      }).success, false);
      assert.equal(awardPointsSchema.safeParse({
        customerQrToken: "valid-token-string",
        amount_q: -1,
        txId: "11111111-1111-4111-8111-111111111111"
      }).success, false);
      assert.equal(awardPointsSchema.safeParse({
        customerQrToken: "valid-token-string",
        visits: 0,
        txId: "11111111-1111-4111-8111-111111111111"
      }).success, false);
      assert.equal(awardPointsSchema.safeParse({
        customerQrToken: "valid-token-string",
        items: 0,
        txId: "11111111-1111-4111-8111-111111111111"
      }).success, false);
    });
  });

  describe("redeemRewardSchema", () => {
    it("requires requestId for reward redemption", () => {
      assert.equal(redeemRewardSchema.safeParse({
        customerId: "11111111-1111-4111-8111-111111111111",
        rewardId: "22222222-2222-4222-8222-222222222222",
        requestId: "33333333-3333-4333-8333-333333333333"
      }).success, true);
      assert.equal(redeemRewardSchema.safeParse({
        customerId: "11111111-1111-4111-8111-111111111111",
        rewardId: "22222222-2222-4222-8222-222222222222"
      }).success, false);
    });
  });

  describe("webhookCreateSchema", () => {
    it("accepts valid webhook definitions", () => {
      assert.equal(webhookCreateSchema.safeParse({
        url: "https://example.com/webhook",
        events: ["customer.created"],
        secret: "1234567890abcdef"
      }).success, true);
    });

    it("rejects invalid webhook URLs and empty event lists", () => {
      assert.equal(webhookCreateSchema.safeParse({
        url: "not-a-url",
        events: ["customer.created"]
      }).success, false);
      assert.equal(webhookCreateSchema.safeParse({
        url: "https://example.com/webhook",
        events: []
      }).success, false);
    });
  });
});
