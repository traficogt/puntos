import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  deliverLifecycleWalletMessage,
  WALLET_MESSAGE_TTL_MS,
} from "../../src/app/services/wallet-notification-service.js";
import { walletMessage } from "../../src/app/repositories/native-wallet-repository.js";

describe("walletMessage (transient pass-message gating)", () => {
  it("returns null when there is no pending message", () => {
    assert.equal(walletMessage({ pending_message: null, pending_message_expires_at: null }), null);
    assert.equal(walletMessage(null), null);
  });
  it("returns null when the message has expired", () => {
    assert.equal(
      walletMessage({
        pending_message: "hola",
        pending_message_expires_at: new Date(Date.now() - 1000),
      }),
      null,
    );
  });
  it("renders a live message with a stable id derived from text+expiry", () => {
    const expires = new Date(Date.now() + 60000);
    const a = walletMessage({
      pending_message: "Te extrañamos",
      pending_message_expires_at: expires,
    });
    const b = walletMessage({
      pending_message: "Te extrañamos",
      pending_message_expires_at: expires,
    });
    assert.equal(a.text, "Te extrañamos");
    assert.match(a.id, /^pfm_[0-9a-f]{24}$/);
    assert.equal(a.id, b.id);
    assert.equal(a.end, expires.toISOString());
  });
  it("clips an overlong message to 240 chars", () => {
    const live = walletMessage({
      pending_message: "x".repeat(500),
      pending_message_expires_at: new Date(Date.now() + 60000),
    });
    assert.equal(live.text.length, 240);
  });
});

describe("deliverLifecycleWalletMessage (channel selection)", () => {
  it("returns an accepted wallet result when the customer has an active pass", async () => {
    const calls = [];
    const repo = {
      queueWalletMessage: async (args) => {
        calls.push(args);
        return [{ id: "p1", provider: "apple" }];
      },
    };
    const out = await deliverLifecycleWalletMessage({
      businessId: "b1",
      customerId: "c1",
      body: "hola",
      repo,
      now: () => new Date("2026-11-18T12:00:00Z"),
    });
    assert.deepEqual(
      { ok: out.ok, accepted: out.accepted, provider: out.provider },
      { ok: true, accepted: true, provider: "wallet" },
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].businessId, "b1");
    assert.equal(calls[0].message, "hola");
    assert.equal(
      calls[0].expiresAt.getTime(),
      new Date("2026-11-18T12:00:00Z").getTime() + WALLET_MESSAGE_TTL_MS,
    );
  });
  it("returns null (so the caller falls back to SMS) when the customer has no pass", async () => {
    const repo = { queueWalletMessage: async () => [] };
    const out = await deliverLifecycleWalletMessage({
      businessId: "b1",
      customerId: "c1",
      body: "hola",
      repo,
    });
    assert.equal(out, null);
  });
});
