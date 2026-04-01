import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

const {
  createGiftCardWithDeps,
  redeemGiftCardWithDeps,
  giftCardLedgerDetailsWithDeps
} = await import("../../src/app/services/gift-card-service.js");

describe("gift card idempotency", () => {
  let accessCalls = [];

  beforeEach(() => {
    accessCalls = [];
  });

  it("returns the existing issued gift card on create replay", async () => {
    const out = await createGiftCardWithDeps(
      {
        GiftCardRepo: {},
        StaffRepo: {},
        withTransaction: async (fn) => fn({
          query: async (sql) => {
            if (sql.includes("pg_advisory_xact_lock")) {
              return { rows: [], rowCount: 1 };
            }
            if (sql.includes("FROM gift_card_transactions tx") && sql.includes("tx.request_id = $2")) {
              return {
                rows: [{
                  transaction_id: "tx-1",
                  tx_type: "ISSUE",
                  amount_q: "25.00",
                  balance_after_q: "25.00",
                  meta: {
                    issued_to_name: "Cliente",
                    issued_to_phone: "555",
                    initial_amount_q: 25,
                    balance_after_q: 25,
                    status_after: "ACTIVE",
                    expires_at: null
                  },
                  id: "gc-1",
                  business_id: "b1",
                  branch_id: null,
                  code: "GC-123",
                  qr_token: "gft_token",
                  issued_to_name: "Cliente",
                  issued_to_phone: "555",
                  initial_amount_q: "25.00",
                  balance_q: "25.00",
                  status: "ACTIVE",
                  expires_at: null,
                  created_by: "s1",
                  created_at: "2026-03-08T00:00:00.000Z",
                  updated_at: "2026-03-08T00:00:00.000Z"
                }],
                rowCount: 1
              };
            }
            throw new Error(`Unexpected SQL in gift card create replay test: ${sql}`);
          }
        }),
        assertGiftCardAccess: async (staff, options) => {
          accessCalls.push({ staff, options });
          return { id: "s1", business_id: "b1", branch_id: null, role: "MANAGER" };
        }
      },
      {
        staff: { id: "s1" },
        amount_q: 25,
        issued_to_name: "Cliente",
        requestId: "11111111-1111-4111-8111-111111111111"
      }
    );

    assert.equal(out.id, "gc-1");
    assert.equal(out.balance_q, 25);
    assert.equal(out.code, "GC-123");
    assert.equal(accessCalls.length, 1);
  });

  it("returns the existing redemption snapshot on redeem replay", async () => {
    const out = await redeemGiftCardWithDeps(
      {
        GiftCardRepo: {},
        StaffRepo: {},
        withTransaction: async (fn) => fn({
          query: async (sql) => {
            if (sql.includes("pg_advisory_xact_lock")) {
              return { rows: [], rowCount: 1 };
            }
            if (sql.includes("FROM gift_card_transactions tx") && sql.includes("tx.request_id = $2")) {
              return {
                rows: [{
                  transaction_id: "tx-2",
                  tx_type: "REDEEM",
                  amount_q: "10.00",
                  balance_after_q: "15.00",
                  meta: {
                    note: "redeem",
                    balance_after_q: 15,
                    status_after: "ACTIVE",
                    code: "GC-123",
                    qr_token: "gft_token",
                    initial_amount_q: 25,
                    issued_to_name: "Cliente",
                    issued_to_phone: "555",
                    expires_at: null
                  },
                  id: "gc-1",
                  business_id: "b1",
                  branch_id: null,
                  code: "GC-123",
                  qr_token: "gft_token",
                  issued_to_name: "Cliente",
                  issued_to_phone: "555",
                  initial_amount_q: "25.00",
                  balance_q: "5.00",
                  status: "ACTIVE",
                  expires_at: null,
                  created_by: "s1",
                  created_at: "2026-03-08T00:00:00.000Z",
                  updated_at: "2026-03-08T00:10:00.000Z"
                }],
                rowCount: 1
              };
            }
            throw new Error(`Unexpected SQL in gift card redeem replay test: ${sql}`);
          }
        }),
        assertGiftCardAccess: async (staff, options) => {
          accessCalls.push({ staff, options });
          return { id: "s1", business_id: "b1", branch_id: null, role: "MANAGER" };
        }
      },
      {
        staff: { id: "s1" },
        code_or_token: "GC-123",
        amount_q: 10,
        requestId: "22222222-2222-4222-8222-222222222222"
      }
    );

    assert.equal(out.id, "gc-1");
    assert.equal(out.balance_q, 15);
    assert.equal(out.status, "ACTIVE");
    assert.equal(out.code, "GC-123");
    assert.equal(accessCalls.length, 1);
  });

  it("computes ledger deltas for a gift card from its transaction history", async () => {
    const out = await giftCardLedgerDetailsWithDeps(
      {
        GiftCardRepo: {
          getByCodeOrToken: async () => ({
            id: "gc-1",
            business_id: "b1",
            code: "GC-123",
            balance_q: "15.00",
            initial_amount_q: "25.00",
            status: "ACTIVE"
          }),
          listTxByCard: async () => ([
            { tx_type: "ISSUE", amount_q: "25.00", balance_after_q: "25.00", created_at: "2026-03-08T00:00:00.000Z" },
            { tx_type: "REDEEM", amount_q: "10.00", balance_after_q: "15.00", created_at: "2026-03-08T00:10:00.000Z" }
          ])
        },
        assertGiftCardAccess: async (staff, options) => {
          accessCalls.push({ staff, options });
          return { id: "s1", business_id: "b1", branch_id: null, role: "MANAGER" };
        }
      },
      {
        staff: { id: "s1", business_id: "b1" },
        code_or_token: "GC-123"
      }
    );

    assert.equal(out.card.code, "GC-123");
    assert.equal(out.ledger.stored_balance_q, 15);
    assert.equal(out.ledger.expected_balance_q, 15);
    assert.equal(out.ledger.issue_total_q, 25);
    assert.equal(out.ledger.redeem_total_q, 10);
    assert.equal(out.ledger.delta_q, 0);
    assert.equal(out.ledger.mismatch, false);
    assert.equal(out.transactions.length, 2);
  });
});
