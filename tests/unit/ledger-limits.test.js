import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_LEDGER_AMOUNT_Q,
  MAX_LEDGER_INTEGER,
  isLedgerAmount,
  isLedgerInteger,
} from "../../src/utils/ledger-limits.js";

test("isLedgerAmount accepts non-negative amounts with at most two decimals", () => {
  assert.ok(isLedgerAmount(0));
  assert.ok(isLedgerAmount(48.5));
  assert.ok(isLedgerAmount(19.99));
  assert.ok(isLedgerAmount(MAX_LEDGER_AMOUNT_Q));
  assert.ok(!isLedgerAmount(-0.01));
  assert.ok(!isLedgerAmount(MAX_LEDGER_AMOUNT_Q + 0.01));
  assert.ok(!isLedgerAmount("48.50"));
  assert.ok(!isLedgerAmount(NaN));
  assert.ok(!isLedgerAmount(Infinity));
});

test("isLedgerAmount checks the decimal scale exactly instead of within an epsilon", () => {
  assert.ok(!isLedgerAmount(1.001));
  assert.ok(!isLedgerAmount(1.005));
  // Float noise used to slip through the 1e-5 tolerance and be rounded away.
  assert.ok(!isLedgerAmount(0.1 + 0.2));
  assert.ok(!isLedgerAmount(1.00000001));
  // Large amounts keep the same two-decimal rule (the old epsilon scaled with magnitude).
  assert.ok(isLedgerAmount(99999999.98));
  assert.ok(!isLedgerAmount(99999999.985));
});

test("isLedgerInteger accepts non-negative INT values only", () => {
  assert.ok(isLedgerInteger(0));
  assert.ok(isLedgerInteger(MAX_LEDGER_INTEGER));
  assert.ok(!isLedgerInteger(MAX_LEDGER_INTEGER + 1));
  assert.ok(!isLedgerInteger(-1));
  assert.ok(!isLedgerInteger(1.5));
  assert.ok(!isLedgerInteger("1"));
});
