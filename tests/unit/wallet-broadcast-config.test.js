import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveWalletBroadcast,
  walletBroadcastDelivery,
  WALLET_BROADCAST_DAILY_CEIL,
  WALLET_BROADCAST_MONTHLY_CEIL,
  DEFAULT_CHANNEL_POLICY,
} from "../../src/app/services/wallet-broadcast-config.js";

const BID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

test("a business absent from the settings map is not opted in and gets safe defaults", () => {
  const cfg = resolveWalletBroadcast({}, BID);
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.dailyCap, WALLET_BROADCAST_DAILY_CEIL);
  assert.equal(cfg.monthlyCap, WALLET_BROADCAST_MONTHLY_CEIL);
  assert.equal(cfg.channelPolicy, DEFAULT_CHANNEL_POLICY);
});

test("null or malformed settings never throw and fall back to defaults", () => {
  for (const map of [null, undefined, "x", 42, { [BID]: null }, { [BID]: { enabled: "yes" } }]) {
    const cfg = resolveWalletBroadcast(map, BID);
    assert.equal(cfg.enabled, false);
    assert.equal(cfg.channelPolicy, DEFAULT_CHANNEL_POLICY);
  }
});

test("configured caps are clamped down to the platform ceiling and can never be raised above it", () => {
  const cfg = resolveWalletBroadcast(
    { [BID]: { enabled: true, daily_cap: 999, monthly_cap: 999 } },
    BID,
  );
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.dailyCap, WALLET_BROADCAST_DAILY_CEIL);
  assert.equal(cfg.monthlyCap, WALLET_BROADCAST_MONTHLY_CEIL);
});

test("a lower per-business cap is honored", () => {
  // Only meaningful if the ceiling is above 1; otherwise the clamp already equals the ceiling.
  const lowered = Math.max(1, WALLET_BROADCAST_MONTHLY_CEIL - 1);
  const cfg = resolveWalletBroadcast({ [BID]: { enabled: true, monthly_cap: lowered } }, BID);
  assert.equal(cfg.monthlyCap, Math.min(lowered, WALLET_BROADCAST_MONTHLY_CEIL));
});

test("invalid or zero caps fall back to the ceiling rather than silently disabling sends", () => {
  const cfg = resolveWalletBroadcast(
    { [BID]: { enabled: true, daily_cap: 0, monthly_cap: -5 } },
    BID,
  );
  assert.equal(cfg.dailyCap, WALLET_BROADCAST_DAILY_CEIL);
  assert.equal(cfg.monthlyCap, WALLET_BROADCAST_MONTHLY_CEIL);
});

test("an unknown channel_policy is ignored in favor of the wallet-first default", () => {
  const cfg = resolveWalletBroadcast(
    { [BID]: { enabled: true, channel_policy: "carrier-pigeon" } },
    BID,
  );
  assert.equal(cfg.channelPolicy, DEFAULT_CHANNEL_POLICY);
});

test("wallet_first_sms_fallback tries wallet for opted-in pass holders, else SMS, else suppresses", () => {
  const base = { enabled: true, channelPolicy: "wallet_first_sms_fallback" };
  assert.deepEqual(walletBroadcastDelivery({ ...base, hasPass: true, hasPhone: true }), {
    tryWallet: true,
    smsFallback: true,
  });
  assert.deepEqual(walletBroadcastDelivery({ ...base, hasPass: false, hasPhone: true }), {
    tryWallet: false,
    smsFallback: true,
  });
  assert.deepEqual(walletBroadcastDelivery({ ...base, hasPass: true, hasPhone: false }), {
    tryWallet: true,
    smsFallback: false,
  });
  assert.deepEqual(walletBroadcastDelivery({ ...base, hasPass: false, hasPhone: false }), {
    tryWallet: false,
    smsFallback: false,
  });
});

test("a business not opted in never tries wallet, preserving the existing SMS behavior", () => {
  const plan = walletBroadcastDelivery({
    enabled: false,
    channelPolicy: "wallet_first_sms_fallback",
    hasPass: true,
    hasPhone: true,
  });
  assert.deepEqual(plan, { tryWallet: false, smsFallback: true });
});

test("wallet_only never falls back to paid SMS", () => {
  assert.deepEqual(
    walletBroadcastDelivery({
      enabled: true,
      channelPolicy: "wallet_only",
      hasPass: true,
      hasPhone: true,
    }),
    { tryWallet: true, smsFallback: false },
  );
  assert.deepEqual(
    walletBroadcastDelivery({
      enabled: true,
      channelPolicy: "wallet_only",
      hasPass: false,
      hasPhone: true,
    }),
    { tryWallet: false, smsFallback: false },
  );
});

test("sms_only never uses wallet, even for pass holders", () => {
  assert.deepEqual(
    walletBroadcastDelivery({
      enabled: true,
      channelPolicy: "sms_only",
      hasPass: true,
      hasPhone: true,
    }),
    { tryWallet: false, smsFallback: true },
  );
  assert.deepEqual(
    walletBroadcastDelivery({
      enabled: true,
      channelPolicy: "sms_only",
      hasPass: true,
      hasPhone: false,
    }),
    { tryWallet: false, smsFallback: false },
  );
});
