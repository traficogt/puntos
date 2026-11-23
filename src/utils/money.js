// Money in integer minor units (centavos).
//
// JavaScript numbers are binary floats, so decimal money arithmetic drifts
// (0.1 + 0.2 !== 0.3) and the usual Math.round(n * 100) / 100 lands on the
// wrong centavo near .xx5 boundaries (1.255 * 100 === 125.49999999999999).
// Postgres NUMERIC columns are exact decimals and `pg` hands them to us as
// strings. This helper parses those strings exactly, keeps every intermediate
// value as a safe JavaScript integer of minor units, and formats fixed-decimal
// strings back for SQL parameters. The default rounding is half away from zero,
// which is what Postgres round(numeric, n) and NUMERIC(p, s) assignment do, so
// app-side and DB-side arithmetic agree to the centavo.
//
// Dependency-free. `scale` is the column's decimal scale: 2 for the
// NUMERIC(10,2) / NUMERIC(12,2) Q ledgers, 0 for a zero-decimal currency such
// as CLP, 6 for the numeric(20,6) cost columns. Minor-unit values are plain
// numbers that must stay within Number.isSafeInteger; every operation checks.

export const DEFAULT_SCALE = 2;

/** Rounding modes. "half-up" is half away from zero (Postgres NUMERIC). */
export const ROUNDING_MODES = Object.freeze([
  "half-up", // nearest; ties away from zero (Postgres round(), NUMERIC(p,s) assignment)
  "half-even", // nearest; ties to the even neighbour (banker's rounding)
  "down", // toward zero (truncate)
  "up", // away from zero
  "floor", // toward negative infinity
  "ceil", // toward positive infinity
]);

const MAX_SCALE = 18;
const MAX_EXPONENT = 400;
const MAX_SAFE_BIG = BigInt(Number.MAX_SAFE_INTEGER);
const DECIMAL_RE = /^([+-])?(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

/** @param {unknown} scale */
function normalizeScale(scale) {
  if (typeof scale !== "number" || !Number.isInteger(scale) || scale < 0 || scale > MAX_SCALE) {
    throw new RangeError(`money: scale must be an integer between 0 and ${MAX_SCALE}`);
  }
  return scale;
}

/** @param {unknown} mode */
function normalizeRounding(mode) {
  if (typeof mode !== "string" || !ROUNDING_MODES.includes(mode)) {
    throw new RangeError(`money: unknown rounding mode ${JSON.stringify(mode)}`);
  }
  return mode;
}

/**
 * Parse a decimal exactly: the result means `(neg ? -1 : 1) * unscaled / 10^scale`.
 * Numbers go through their shortest round-trip decimal form (String(n)), so a
 * value a human typed as 1.005 is read as 1.005, not as the binary
 * 1.00499999999999989. null and undefined read as zero.
 *
 * @param {unknown} value
 * @param {string} what
 * @returns {{ neg: boolean, unscaled: bigint, scale: number }}
 */
function parseDecimal(value, what) {
  if (value === null || value === undefined) return { neg: false, unscaled: 0n, scale: 0 };
  if (typeof value === "bigint") {
    return { neg: value < 0n, unscaled: value < 0n ? -value : value, scale: 0 };
  }
  let text;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`money: ${what} must be a finite number`);
    text = String(value);
  } else if (typeof value === "string") {
    text = value.trim();
  } else {
    throw new TypeError(`money: ${what} must be a number or a numeric string`);
  }
  const m = DECIMAL_RE.exec(text);
  if (!m || ((m[2] ?? "") === "" && (m[3] ?? "") === "")) {
    throw new TypeError(`money: ${what} is not a decimal number: ${JSON.stringify(value)}`);
  }
  const neg = m[1] === "-";
  const intDigits = m[2] ?? "";
  const fracDigits = m[3] ?? "";
  const exponent = m[4] ? Number(m[4]) : 0;
  if (Math.abs(exponent) > MAX_EXPONENT) {
    throw new RangeError(`money: ${what} exponent out of range: ${JSON.stringify(value)}`);
  }
  let unscaled = BigInt(`${intDigits}${fracDigits}` || "0");
  let scale = fracDigits.length - exponent;
  if (scale < 0) {
    unscaled *= 10n ** BigInt(-scale);
    scale = 0;
  }
  return { neg, unscaled, scale };
}

/**
 * Integer division with an explicit rounding mode.
 * @param {bigint} numerator signed
 * @param {bigint} denominator positive
 * @param {string} mode one of ROUNDING_MODES
 */
function divRound(numerator, denominator, mode) {
  const neg = numerator < 0n;
  const abs = neg ? -numerator : numerator;
  let quotient = abs / denominator;
  const remainder = abs % denominator;
  if (remainder !== 0n) {
    const twice = remainder * 2n;
    let bump = false;
    switch (mode) {
      case "half-up":
        bump = twice >= denominator;
        break;
      case "half-even":
        bump = twice > denominator || (twice === denominator && quotient % 2n === 1n);
        break;
      case "down":
        bump = false;
        break;
      case "up":
        bump = true;
        break;
      case "floor":
        bump = neg;
        break;
      case "ceil":
        bump = !neg;
        break;
      default:
        throw new RangeError(`money: unknown rounding mode ${JSON.stringify(mode)}`);
    }
    if (bump) quotient += 1n;
  }
  return neg ? -quotient : quotient;
}

/**
 * @param {bigint} big
 * @param {string} what
 */
function toSafeInteger(big, what) {
  if (big > MAX_SAFE_BIG || big < -MAX_SAFE_BIG) {
    throw new RangeError(`money: ${what} exceeds the safe integer range in minor units`);
  }
  return Number(big);
}

/** @param {unknown} value */
export function isMoney(value) {
  return typeof value === "number" && Number.isSafeInteger(value);
}

/**
 * Assert `value` is an amount in minor units (a safe integer). Returns it.
 * @param {unknown} value
 * @param {string} [name]
 * @returns {number}
 */
export function assertMoney(value, name = "amount") {
  if (!isMoney(value)) {
    throw new TypeError(
      `money: ${name} must be a safe integer in minor units, got ${String(value)}`,
    );
  }
  return /** @type {number} */ (value);
}

/**
 * Convert a decimal amount (number, NUMERIC string, bigint, null) to integer
 * minor units at `scale`, rounding any extra decimals with `rounding`.
 *
 *   toMinor("12.34")            -> 1234
 *   toMinor(0.1 + 0.2)          -> 30
 *   toMinor("12.345")           -> 1235     (half away from zero, like Postgres)
 *   toMinor("1500", {scale: 0}) -> 1500
 *   toMinor(null)               -> 0
 *
 * @param {unknown} value
 * @param {{ scale?: number, rounding?: string }} [options]
 * @returns {number}
 */
export function toMinor(value, { scale = DEFAULT_SCALE, rounding = "half-up" } = {}) {
  const targetScale = normalizeScale(scale);
  const mode = normalizeRounding(rounding);
  const parsed = parseDecimal(value, "amount");
  const signed = parsed.neg ? -parsed.unscaled : parsed.unscaled;
  const minor =
    targetScale >= parsed.scale
      ? signed * 10n ** BigInt(targetScale - parsed.scale)
      : divRound(signed, 10n ** BigInt(parsed.scale - targetScale), mode);
  return toSafeInteger(minor, "amount");
}

/**
 * Format minor units as a fixed-decimal string for SQL parameters:
 * fromMinor(1234) -> "12.34", fromMinor(-5) -> "-0.05", fromMinor(0) -> "0.00".
 * @param {number} minor
 * @param {{ scale?: number }} [options]
 * @returns {string}
 */
export function fromMinor(minor, { scale = DEFAULT_SCALE } = {}) {
  const s = normalizeScale(scale);
  assertMoney(minor);
  const digits = String(Math.abs(minor)).padStart(s + 1, "0");
  const head = digits.slice(0, digits.length - s);
  const tail = digits.slice(digits.length - s);
  return `${minor < 0 ? "-" : ""}${head}${s > 0 ? `.${tail}` : ""}`;
}

/**
 * Minor units as a JS number with `scale` decimals, for JSON output:
 * toNumber(1234) -> 12.34. The nearest double to the exact decimal, identical
 * to what Number("12.34") on the NUMERIC string would give.
 * @param {number} minor
 * @param {{ scale?: number }} [options]
 * @returns {number}
 */
export function toNumber(minor, { scale = DEFAULT_SCALE } = {}) {
  return Number(fromMinor(minor, { scale }));
}

/**
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
export function add(a, b) {
  assertMoney(a, "augend");
  assertMoney(b, "addend");
  return assertMoney(a + b, "sum");
}

/**
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
export function sub(a, b) {
  assertMoney(a, "minuend");
  assertMoney(b, "subtrahend");
  return assertMoney(a - b, "difference");
}

/**
 * Negate without producing -0.
 * @param {number} a
 * @returns {number}
 */
export function neg(a) {
  assertMoney(a);
  return a === 0 ? 0 : -a;
}

/**
 * Sum of minor-unit amounts.
 * @param {Iterable<number>} values
 * @returns {number}
 */
export function sum(values) {
  let total = 0;
  for (const value of values) total = add(total, value);
  return total;
}

/**
 * Multiply minor units by a decimal ratio (number or string) exactly, then
 * round to a whole minor unit: mul(1999, 3) -> 5997, mul(1001, "0.5") -> 501.
 * @param {number} minor
 * @param {unknown} ratio
 * @param {{ rounding?: string }} [options]
 * @returns {number}
 */
export function mul(minor, ratio, { rounding = "half-up" } = {}) {
  assertMoney(minor);
  const mode = normalizeRounding(rounding);
  const r = parseDecimal(ratio, "ratio");
  const numerator = BigInt(minor) * (r.neg ? -r.unscaled : r.unscaled);
  return toSafeInteger(divRound(numerator, 10n ** BigInt(r.scale), mode), "product");
}

/**
 * `percent` % of `minor`, exactly, rounded to a whole minor unit:
 * pct(1999, 5) -> 100 (19.99 at 5% is 0.9995 -> 1.00), pct(12550, 7.5) -> 941.
 * @param {number} minor
 * @param {unknown} percent
 * @param {{ rounding?: string }} [options]
 * @returns {number}
 */
export function pct(minor, percent, { rounding = "half-up" } = {}) {
  assertMoney(minor);
  const mode = normalizeRounding(rounding);
  const p = parseDecimal(percent, "percent");
  const numerator = BigInt(minor) * (p.neg ? -p.unscaled : p.unscaled);
  const denominator = 100n * 10n ** BigInt(p.scale);
  return toSafeInteger(divRound(numerator, denominator, mode), "percentage");
}

/**
 * Divide minor units by a non-zero decimal divisor (number or string) exactly,
 * then round once to a whole minor unit: div(5997, "1.12") -> 5354 (59.97 of
 * IVA-inclusive sales is 53.5446... before tax), div(1000, 3) -> 333.
 * @param {number} minor
 * @param {unknown} divisor
 * @param {{ rounding?: string }} [options]
 * @returns {number}
 */
export function div(minor, divisor, { rounding = "half-up" } = {}) {
  assertMoney(minor);
  const mode = normalizeRounding(rounding);
  const d = parseDecimal(divisor, "divisor");
  if (d.unscaled === 0n) throw new RangeError("money: divisor must not be zero");
  const numerator = BigInt(minor) * 10n ** BigInt(d.scale) * (d.neg ? -1n : 1n);
  return toSafeInteger(divRound(numerator, d.unscaled, mode), "quotient");
}

/**
 * True when `value` is a decimal with at most `scale` fractional digits, read
 * exactly: hasMaxScale(12.34, 2), hasMaxScale("1.500", 2) and hasMaxScale(5, 0)
 * are true; hasMaxScale(1.005, 2), hasMaxScale(0.1 + 0.2, 2) and
 * hasMaxScale(1e-7, 6) are false. Replaces the epsilon test
 * Math.abs(x * 100 - Math.round(x * 100)) < 1e-9, which accepted float noise and
 * whose tolerance depended on the magnitude of x. Anything that is not a finite
 * number, a numeric string or a bigint is false; null and undefined are false.
 * @param {unknown} value
 * @param {number} [scale]
 * @returns {boolean}
 */
export function hasMaxScale(value, scale = DEFAULT_SCALE) {
  const maxScale = normalizeScale(scale);
  if (typeof value !== "number" && typeof value !== "string" && typeof value !== "bigint") {
    return false;
  }
  let parsed;
  try {
    parsed = parseDecimal(value, "value");
  } catch {
    return false;
  }
  if (parsed.scale <= maxScale) return true;
  return parsed.unscaled % 10n ** BigInt(parsed.scale - maxScale) === 0n;
}

/**
 * @param {number} a
 * @param {number} b
 * @returns {-1 | 0 | 1}
 */
export function compare(a, b) {
  assertMoney(a, "left");
  assertMoney(b, "right");
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * @param {number} a
 * @param {number} b
 */
export function eq(a, b) {
  return compare(a, b) === 0;
}

/** @param {number} a */
export function isZero(a) {
  return assertMoney(a) === 0;
}

/** @param {number} a */
export function isNegative(a) {
  return assertMoney(a) < 0;
}

/** @param {number} a */
export function isPositive(a) {
  return assertMoney(a) > 0;
}
