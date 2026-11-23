// PostgreSQL ledger columns use INT for points/counts and NUMERIC(10,2) for money.
import { hasMaxScale } from "./money.js";

export const MAX_LEDGER_INTEGER = 2147483647;
export const MAX_LEDGER_AMOUNT_Q = 99999999.99;

/** @param {unknown} value */
export function isLedgerInteger(value) {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_LEDGER_INTEGER
  );
}

/** @param {unknown} value */
export function isLedgerAmount(value) {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_LEDGER_AMOUNT_Q &&
    hasMaxScale(value, 2)
  );
}
