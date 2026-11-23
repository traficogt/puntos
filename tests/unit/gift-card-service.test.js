import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

const { createGiftCardWithDeps, redeemGiftCardWithDeps, giftCardLedgerDetailsWithDeps } =
  await import("../../src/app/services/gift-card-service.js");

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
        withTransaction: async (fn) =>
          fn({
            query: async (sql) => {
              if (sql.includes("pg_advisory_xact_lock")) {
                return { rows: [], rowCount: 1 };
              }
              if (
                sql.includes("FROM gift_card_transactions tx") &&
                sql.includes("tx.request_id = $2")
              ) {
                return {
                  rows: [
                    {
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
                        expires_at: null,
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
                      updated_at: "2026-03-08T00:00:00.000Z",
                    },
                  ],
                  rowCount: 1,
                };
              }
              throw new Error(`Unexpected SQL in gift card create replay test: ${sql}`);
            },
          }),
        assertGiftCardAccess: async (staff, options) => {
          accessCalls.push({ staff, options });
          return { id: "s1", business_id: "b1", branch_id: null, role: "MANAGER" };
        },
      },
      {
        staff: { id: "s1" },
        amount_q: 25,
        issued_to_name: "Cliente",
        issued_to_phone: undefined,
        expires_at: undefined,
        requestId: "11111111-1111-4111-8111-111111111111",
      },
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
        withTransaction: async (fn) =>
          fn({
            query: async (sql) => {
              if (sql.includes("pg_advisory_xact_lock")) {
                return { rows: [], rowCount: 1 };
              }
              if (
                sql.includes("FROM gift_card_transactions tx") &&
                sql.includes("tx.request_id = $2")
              ) {
                return {
                  rows: [
                    {
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
                        expires_at: null,
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
                      updated_at: "2026-03-08T00:10:00.000Z",
                    },
                  ],
                  rowCount: 1,
                };
              }
              throw new Error(`Unexpected SQL in gift card redeem replay test: ${sql}`);
            },
          }),
        assertGiftCardAccess: async (staff, options) => {
          accessCalls.push({ staff, options });
          return { id: "s1", business_id: "b1", branch_id: null, role: "MANAGER" };
        },
      },
      {
        staff: { id: "s1" },
        code_or_token: "GC-123",
        amount_q: 10,
        note: undefined,
        requestId: "22222222-2222-4222-8222-222222222222",
      },
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
            status: "ACTIVE",
          }),
          listTxByCard: async () => [
            {
              tx_type: "ISSUE",
              amount_q: "25.00",
              balance_after_q: "25.00",
              created_at: "2026-03-08T00:00:00.000Z",
            },
            {
              tx_type: "REDEEM",
              amount_q: "10.00",
              balance_after_q: "15.00",
              created_at: "2026-03-08T00:10:00.000Z",
            },
          ],
        },
        assertGiftCardAccess: async (staff, options) => {
          accessCalls.push({ staff, options });
          return { id: "s1", business_id: "b1", branch_id: null, role: "MANAGER" };
        },
      },
      {
        staff: { id: "s1", business_id: "b1" },
        code_or_token: "GC-123",
      },
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

describe("gift card exact centavo arithmetic", () => {
  // Redeem against a card whose balance_q arrives as the NUMERIC string pg
  // returns; capture the SQL writes to check the parameter format.
  async function redeem(balance, amount_q) {
    const writes = [];
    const card = {
      id: "gc-1",
      business_id: "b1",
      code: "GC-123",
      qr_token: "gft_token",
      balance_q: balance,
      initial_amount_q: "10.00",
      status: "ACTIVE",
      expires_at: null,
      issued_to_name: null,
      issued_to_phone: null,
    };
    const out = await redeemGiftCardWithDeps(
      {
        AuditRepo: { log: async () => {} },
        assertGiftCardAccess: async () => ({ id: "s1", business_id: "b1" }),
        withTransaction: (fn) =>
          fn({
            query: async (sql, params) => {
              if (sql.includes("FROM businesses")) return { rows: [{ program_json: {} }] };
              if (sql.includes("FROM gift_cards WHERE")) return { rows: [card] };
              writes.push({ sql, params });
              return { rows: [] };
            },
          }),
      },
      { staff: {}, code_or_token: "GC-123", amount_q, note: null },
    );
    return { out, writes };
  }

  it("redeems to the exact centavo and writes fixed two-decimal SQL params", async () => {
    const first = await redeem("10.00", 9.99);
    assert.equal(first.out.balance_q, 0.01);
    assert.equal(first.out.status, "ACTIVE");
    const update = first.writes.find((w) => w.sql.includes("UPDATE gift_cards"));
    assert.deepEqual(update.params.slice(1), ["0.01", "ACTIVE"]);
    const tx = first.writes.find((w) => w.sql.includes("INSERT INTO gift_card_transactions"));
    assert.equal(tx.params[6], "9.99");
    assert.equal(tx.params[7], "0.01");
    assert.equal(tx.params[8].balance_after_q, 0.01);
    assert.equal(tx.params[8].initial_amount_q, 10);

    const last = await redeem("0.01", 0.01);
    assert.equal(last.out.balance_q, 0);
    assert.equal(last.out.status, "EXHAUSTED");
    assert.equal(last.writes.find((w) => w.sql.includes("UPDATE gift_cards")).params[1], "0.00");

    await assert.rejects(redeem("0.01", 0.02), /insuficiente/i);
  });

  it("ledger details: a one-centavo mismatch is detected exactly, a matching ledger is not", async () => {
    const details = (balance_q) =>
      giftCardLedgerDetailsWithDeps(
        {
          GiftCardRepo: {
            getByCodeOrToken: async () => ({ id: "gc-1", code: "GC-123", balance_q }),
            listTxByCard: async () => [
              { tx_type: "ISSUE", amount_q: "0.10" },
              { tx_type: "ISSUE", amount_q: "0.20" },
              { tx_type: "REDEEM", amount_q: "0.05" },
            ],
          },
          assertGiftCardAccess: async () => ({ id: "s1", business_id: "b1" }),
        },
        { staff: { id: "s1", business_id: "b1" }, code_or_token: "GC-123" },
      );
    const ok = await details("0.25");
    assert.deepEqual(ok.ledger, {
      stored_balance_q: 0.25,
      expected_balance_q: 0.25,
      issue_total_q: 0.3,
      redeem_total_q: 0.05,
      delta_q: 0,
      mismatch: false,
    });
    const off = await details("0.26");
    assert.equal(off.ledger.delta_q, -0.01);
    assert.equal(off.ledger.mismatch, true);
  });
});
