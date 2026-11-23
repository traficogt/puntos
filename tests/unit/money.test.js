import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SCALE,
  ROUNDING_MODES,
  add,
  assertMoney,
  compare,
  eq,
  fromMinor,
  isMoney,
  isNegative,
  isPositive,
  isZero,
  mul,
  neg,
  pct,
  sub,
  sum,
  toMinor,
  toNumber,
} from "../../src/utils/money.js";

test("exports: default scale 2 and a frozen list of rounding modes", () => {
  assert.equal(DEFAULT_SCALE, 2);
  assert.ok(Object.isFrozen(ROUNDING_MODES));
  assert.deepEqual([...ROUNDING_MODES], ["half-up", "half-even", "down", "up", "floor", "ceil"]);
});

// ----- toMinor: parsing -----

test("toMinor parses NUMERIC strings from pg exactly", () => {
  assert.equal(toMinor("0.30"), 30);
  assert.equal(toMinor("12.34"), 1234);
  assert.equal(toMinor("-4.00"), -400);
  assert.equal(toMinor("0"), 0);
  assert.equal(toMinor("0.00"), 0);
  assert.equal(toMinor("5"), 500);
  assert.equal(toMinor("9999999999.99"), 999999999999); // NUMERIC(12,2) max
  assert.equal(toMinor("99999999.99"), 9999999999); // NUMERIC(10,2) max
  assert.equal(toMinor("-0.01"), -1);
});

test("toMinor accepts numbers, bigints, null and undefined", () => {
  assert.equal(toMinor(12.34), 1234);
  assert.equal(toMinor(5), 500);
  assert.equal(toMinor(-4), -400);
  assert.equal(toMinor(0), 0);
  assert.equal(toMinor(-0), 0);
  assert.ok(Object.is(toMinor(-0), 0));
  assert.equal(toMinor(5n), 500);
  assert.equal(toMinor(-3n), -300);
  assert.equal(toMinor(null), 0);
  assert.equal(toMinor(undefined), 0);
});

test("toMinor tolerates signs, leading zeros, bare dots and surrounding whitespace", () => {
  assert.equal(toMinor("007.50"), 750);
  assert.equal(toMinor("+1.5"), 150);
  assert.equal(toMinor(".5"), 50);
  assert.equal(toMinor("12."), 1200);
  assert.equal(toMinor(" 7.5 "), 750);
});

test("toMinor understands exponent notation (String(n) emits it for tiny numbers)", () => {
  assert.equal(toMinor("1e2"), 10000);
  assert.equal(toMinor("1.5e-1"), 15);
  assert.equal(toMinor(1.5e-7), 0);
  assert.equal(toMinor("2.5e-3"), 0); // 0.0025 -> 0.00
  assert.equal(toMinor("5e-3"), 1); // 0.005 -> 0.01
});

test("toMinor agrees between a NUMERIC string and the same value as a number", () => {
  for (const s of ["0.30", "19.99", "1234.56", "-4.00", "0.01", "37.50", "100", "0.1"]) {
    assert.equal(toMinor(s), toMinor(Number(s)), s);
  }
});

test("toMinor rejects garbage, non-finite numbers and wrong types", () => {
  for (const bad of ["abc", "", "1.2.3", "12,34", "-", ".", "+", "1e", NaN, Infinity, -Infinity]) {
    assert.throws(() => toMinor(bad), TypeError, String(bad));
  }
  for (const bad of [true, false, {}, [], () => 1, Symbol("x")]) {
    assert.throws(() => toMinor(bad), TypeError);
  }
});

test("toMinor guards the scale, the rounding mode and the magnitude", () => {
  assert.throws(() => toMinor("1", { scale: -1 }), RangeError);
  assert.throws(() => toMinor("1", { scale: 1.5 }), RangeError);
  assert.throws(() => toMinor("1", { scale: 19 }), RangeError);
  assert.throws(() => toMinor("1", { rounding: "nearest" }), RangeError);
  assert.throws(() => toMinor("1e999"), RangeError);
  assert.throws(() => toMinor(1e21), RangeError);
  assert.throws(() => toMinor("90071992547409.92"), RangeError); // one centavo past MAX_SAFE_INTEGER
  assert.equal(toMinor("90071992547409.91"), Number.MAX_SAFE_INTEGER);
});

// ----- toMinor: rounding -----

test("toMinor rounds half away from zero by default, like Postgres round(numeric, 2)", () => {
  // Each pair is (input, what SELECT round(input::numeric, 2) returns in Postgres).
  const table = [
    ["12.345", "12.35"],
    ["-12.345", "-12.35"],
    ["0.125", "0.13"],
    ["-0.125", "-0.13"],
    ["0.005", "0.01"],
    ["-0.005", "-0.01"],
    ["1.005", "1.01"],
    ["2.675", "2.68"],
    ["0.004999", "0.00"],
    ["-0.004999", "0.00"],
    ["0.135", "0.14"],
    ["0.145", "0.15"],
    ["99.995", "100.00"],
  ];
  for (const [input, expected] of table) {
    assert.equal(fromMinor(toMinor(input)), expected, input);
  }
});

test("toMinor at scale 0 rounds half away from zero too (Postgres round(numeric))", () => {
  assert.equal(toMinor("2.5", { scale: 0 }), 3);
  assert.equal(toMinor("-2.5", { scale: 0 }), -3); // Math.round(-2.5) would give -2
  assert.equal(toMinor("2.4999", { scale: 0 }), 2);
  assert.equal(toMinor(1500.5, { scale: 0 }), 1501);
  assert.equal(toMinor("1500", { scale: 0 }), 1500);
});

test("toMinor supports the other rounding modes explicitly", () => {
  const r = (v, rounding) => toMinor(v, { rounding });
  assert.equal(r("0.125", "half-even"), 12);
  assert.equal(r("0.135", "half-even"), 14);
  assert.equal(r("0.145", "half-even"), 14);
  assert.equal(r("-0.125", "half-even"), -12);
  assert.equal(r("0.126", "half-even"), 13);
  assert.equal(r("0.129", "down"), 12);
  assert.equal(r("-0.129", "down"), -12);
  assert.equal(r("0.121", "up"), 13);
  assert.equal(r("-0.121", "up"), -13);
  assert.equal(r("0.129", "floor"), 12);
  assert.equal(r("-0.121", "floor"), -13);
  assert.equal(r("0.121", "ceil"), 13);
  assert.equal(r("-0.129", "ceil"), -12);
  // Exact values never move, whatever the mode.
  for (const mode of ROUNDING_MODES) assert.equal(r("12.34", mode), 1234, mode);
});

// ----- float traps -----

test("float traps: the classic binary-float failures land on the right centavo", () => {
  assert.equal(toMinor(0.1 + 0.2), 30); // 0.30000000000000004
  assert.equal(toMinor(19.99 * 3), 5997); // 59.97 (float says 59.97000000000001 in some engines)
  assert.equal(toMinor(1.005), 101); // (1.005).toFixed(2) === "1.00"
  assert.equal(toMinor(1.005 * 100), 10050); // 100.49999999999999 -> 100.50
  // Once a float product has drifted below .5 nothing can recover it; multiply
  // in minor units instead and the half-up result is the one a human expects.
  assert.equal(toMinor(1.005 * 100, { scale: 0 }), 100);
  assert.equal(mul(toMinor(1.005, { scale: 3 }), 100), 100500); // 100.500 at scale 3
  assert.equal(toMinor(1.255), 126); // Math.round(1.255 * 100) === 125
  assert.equal(toMinor(0.285), 29); // Math.round(0.285 * 100) === 28
  assert.equal(toMinor(8.325), 833); // Math.round(8.325 * 100) === 832
  assert.equal(toMinor(2.675), 268); // (2.675).toFixed(2) === "2.67"
  assert.equal(toMinor(1.1 * 1.1), 121); // 1.2100000000000002
  assert.ok(eq(toMinor(0.1 + 0.2), toMinor("0.30")));
});

test("float traps: percentages that Math.round(amount * pct) / 100 gets wrong", () => {
  // 33.30 at 15% = 4.995 -> 5.00; the float product 33.3 * 15 is 499.49999999999994.
  assert.equal(pct(toMinor("33.30"), 15), 500);
  assert.equal(toNumber(pct(toMinor(33.3), 15)), 5);
  // 4.10 at 15% = 0.615 -> 0.62; 4.1 * 15 is 61.49999999999999.
  assert.equal(pct(toMinor("4.10"), 15), 62);
  assert.equal(pct(toMinor("16.90"), 15), 254);
  assert.equal(pct(toMinor("64.10"), 15), 962);
});

// ----- fromMinor / toNumber -----

test("fromMinor formats fixed two-decimal strings for SQL parameters", () => {
  assert.equal(fromMinor(0), "0.00");
  assert.equal(fromMinor(-0), "0.00");
  assert.equal(fromMinor(5), "0.05");
  assert.equal(fromMinor(-5), "-0.05");
  assert.equal(fromMinor(1234), "12.34");
  assert.equal(fromMinor(-400), "-4.00");
  assert.equal(fromMinor(100), "1.00");
  assert.equal(fromMinor(100000000), "1000000.00");
  assert.equal(fromMinor(999999999999), "9999999999.99");
  assert.equal(fromMinor(Number.MAX_SAFE_INTEGER), "90071992547409.91");
});

test("fromMinor honours other scales", () => {
  assert.equal(fromMinor(1500, { scale: 0 }), "1500");
  assert.equal(fromMinor(0, { scale: 0 }), "0");
  assert.equal(fromMinor(-7, { scale: 0 }), "-7");
  assert.equal(fromMinor(1000001, { scale: 6 }), "1.000001");
  assert.equal(fromMinor(5, { scale: 6 }), "0.000005");
  assert.equal(fromMinor(123456, { scale: 6 }), "0.123456");
});

test("fromMinor refuses anything that is not a safe integer", () => {
  for (const bad of [1.5, "100", NaN, Infinity, 2 ** 53, null, undefined]) {
    assert.throws(() => fromMinor(/** @type {any} */ (bad)), TypeError, String(bad));
  }
});

test("toNumber yields the two-decimal JSON number the API has always returned", () => {
  assert.equal(toNumber(1234), 12.34);
  assert.equal(toNumber(-400), -4);
  assert.equal(toNumber(30), 0.3);
  assert.equal(toNumber(1), 0.01);
  assert.equal(toNumber(0), 0);
  assert.ok(Object.is(toNumber(neg(0)), 0));
  assert.equal(toNumber(1500, { scale: 0 }), 1500);
  assert.equal(toNumber(1000001, { scale: 6 }), 1.000001);
  for (const s of ["12.34", "0.30", "-4.00", "19.99", "1234.56", "0.01"]) {
    assert.equal(toNumber(toMinor(s)), Number(s), s);
  }
});

// ----- numeric(20,6) and zero-decimal scales -----

test("scale 6 handles numeric(20,6) inputs exactly", () => {
  assert.equal(toMinor("0.123456", { scale: 6 }), 123456);
  assert.equal(toMinor("12.5", { scale: 6 }), 12500000);
  assert.equal(toMinor("1.0000005", { scale: 6 }), 1000001);
  assert.equal(toMinor("1.0000005", { scale: 6, rounding: "half-even" }), 1000000);
  assert.equal(toMinor("1.0000004", { scale: 6 }), 1000000);
  // Collapsing a 6-scale value to the 2-scale ledger rounds once, half away from zero.
  assert.equal(toMinor("0.123456"), 12);
  assert.equal(toMinor("0.125000"), 13);
  assert.equal(toMinor("-0.125000"), -13);
  assert.equal(fromMinor(toMinor("2.5000005", { scale: 6 }), { scale: 6 }), "2.500001");
});

// ----- arithmetic -----

test("add / sub / neg / sum are exact and overflow-guarded", () => {
  assert.equal(add(10, 20), 30);
  assert.equal(sub(10, 20), -10);
  assert.equal(sub(1999, 1999), 0);
  assert.equal(neg(500), -500);
  assert.equal(neg(-500), 500);
  assert.ok(Object.is(neg(0), 0));
  assert.equal(sum([100, 200, 30]), 330);
  assert.equal(sum([]), 0);
  assert.equal(sum([toMinor("0.10"), toMinor("0.20")]), toMinor("0.30"));
  assert.throws(() => add(Number.MAX_SAFE_INTEGER, 1), TypeError);
  assert.throws(() => sub(-Number.MAX_SAFE_INTEGER, 1), TypeError);
  assert.throws(() => add(1.5, 1), TypeError);
  assert.throws(() => add(/** @type {any} */ ("1"), 1), TypeError);
  assert.throws(() => sum([1, /** @type {any} */ ("2")]), TypeError);
});

test("mul multiplies by a decimal ratio exactly, then rounds once", () => {
  assert.equal(mul(1999, 3), 5997);
  assert.equal(mul(1000, 0.5), 500);
  assert.equal(mul(1000, "0.333"), 333);
  assert.equal(mul(1001, 0.5), 501); // 500.5 -> away from zero
  assert.equal(mul(-1001, 0.5), -501);
  assert.equal(mul(1001, 0.5, { rounding: "half-even" }), 500);
  assert.equal(mul(1003, 0.5, { rounding: "half-even" }), 502);
  assert.equal(mul(1001, 0.5, { rounding: "down" }), 500);
  assert.equal(mul(-1001, 0.5, { rounding: "down" }), -500);
  assert.equal(mul(1001, 0.5, { rounding: "up" }), 501);
  assert.equal(mul(-1001, 0.5, { rounding: "floor" }), -501);
  assert.equal(mul(-1001, 0.5, { rounding: "ceil" }), -500);
  assert.equal(mul(2, "0.25"), 1);
  assert.equal(mul(300, 1.1 * 1.1), 363);
  assert.equal(mul(1, 1e-7), 0);
  assert.equal(mul(1234, 0), 0);
  assert.equal(mul(1234, 1), 1234);
  assert.equal(mul(1234, -1), -1234);
  assert.equal(mul(1234, null), 0);
  assert.throws(() => mul(Number.MAX_SAFE_INTEGER, 2), RangeError);
  assert.throws(() => mul(1.5, 2), TypeError);
  assert.throws(() => mul(100, "abc"), TypeError);
  assert.throws(() => mul(100, 2, { rounding: "bogus" }), RangeError);
});

test("pct takes a percentage of minor units exactly (cashback, discount, load bonus)", () => {
  assert.equal(pct(1999, 5), 100); // 0.9995 -> 1.00
  assert.equal(pct(3750, 5), 188); // 1.875 -> 1.88
  assert.equal(pct(10000, 5), 500);
  assert.equal(pct(10000, 7.5), 750);
  assert.equal(pct(3300, 7.5), 248); // 2.475 -> 2.48
  assert.equal(pct(12550, 7.5), 941); // 9.4125 -> 9.41
  assert.equal(pct(1234, "12.5"), 154); // 1.5425 -> 1.54
  assert.equal(pct(1000, 33.333333), 333);
  assert.equal(pct(1, 50), 1); // 0.005 -> 0.01
  assert.equal(pct(-1, 50), -1);
  assert.equal(pct(1, 50, { rounding: "half-even" }), 0);
  assert.equal(pct(1, 50, { rounding: "down" }), 0);
  assert.equal(pct(1234, 100), 1234);
  assert.equal(pct(1234, 0), 0);
  assert.equal(pct(1234, "0"), 0);
  assert.equal(pct(1234, null), 0);
  assert.equal(pct(0, 15), 0);
  assert.throws(() => pct(12.5, 10), TypeError);
  assert.throws(() => pct(100, "ten"), TypeError);
});

// ----- comparisons -----

test("compare / eq / isZero / isNegative / isPositive are exact integer comparisons", () => {
  assert.equal(compare(1, 2), -1);
  assert.equal(compare(2, 1), 1);
  assert.equal(compare(7, 7), 0);
  assert.equal(compare(-1, 0), -1);
  assert.ok(eq(30, toMinor("0.30")));
  assert.ok(!eq(30, 31));
  assert.ok(isZero(0));
  assert.ok(isZero(-0));
  assert.ok(!isZero(1));
  assert.ok(isNegative(-1));
  assert.ok(!isNegative(0));
  assert.ok(isPositive(1));
  assert.ok(!isPositive(0));
  assert.ok(!isPositive(-1));
  // A spend of 5.01 against a 5.00 balance is over by exactly one centavo.
  assert.equal(compare(toMinor(5.01), toMinor("5.00")), 1);
  assert.equal(compare(toMinor(5), toMinor("5.00")), 0);
  assert.throws(() => compare(1.5, 1), TypeError);
  assert.throws(() => isZero(/** @type {any} */ ("0")), TypeError);
});

// ----- guards -----

test("isMoney / assertMoney accept safe integers only", () => {
  assert.ok(isMoney(0));
  assert.ok(isMoney(-0));
  assert.ok(isMoney(-400));
  assert.ok(isMoney(Number.MAX_SAFE_INTEGER));
  assert.ok(!isMoney(1.5));
  assert.ok(!isMoney("100"));
  assert.ok(!isMoney(NaN));
  assert.ok(!isMoney(Infinity));
  assert.ok(!isMoney(2 ** 53));
  assert.ok(!isMoney(null));
  assert.ok(!isMoney(undefined));
  assert.ok(!isMoney(5n));
  assert.equal(assertMoney(1234), 1234);
  assert.throws(() => assertMoney(1.5, "bonus"), /bonus/);
  assert.throws(() => assertMoney("1"), TypeError);
});

// ----- negative clawbacks -----

test("negative amounts (refund clawbacks) round-trip exactly", () => {
  assert.equal(toMinor("-4.00"), -400);
  assert.equal(toMinor(-4), -400);
  assert.equal(toMinor("-12.345"), -1235);
  const balance = toMinor("0.01");
  const clawback = toMinor("5.00");
  const after = sub(balance, clawback);
  assert.equal(after, -499);
  assert.ok(isNegative(after));
  assert.equal(fromMinor(after), "-4.99");
  assert.equal(toNumber(after), -4.99);
  assert.equal(fromMinor(neg(clawback)), "-5.00");
  assert.equal(toNumber(toMinor(fromMinor(after))), -4.99);
});
