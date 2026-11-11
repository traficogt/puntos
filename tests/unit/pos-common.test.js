import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { normalizePosSale, posEventId, verifyPosCredentials, safePosIntegration } from "../../src/app/services/pos/common.js";

const key = "sandbox-pos-test-key-with-enough-entropy";
const business = { id: "biz-1", slug: "cafe", program_json: {
  external_awards: { enabled: true, api_key: key },
  pos_integration: { enabled: true, mode: "api", loyverse: { access_token: "private-token", merchant_id: "merchant-1" } }
} };
const sale = { saleId: "000123", source: "cash-register", customerPhone: "+502 5555-4444", amountQ: 48.5, currency: "GTQ" };

test("normalizes sale identity without losing leading zeroes", () => {
  const out = normalizePosSale(sale);
  assert.equal(out.saleId, "000123");
  assert.equal(out.customerPhone, "50255554444");
  assert.equal(out.amountQ, 48.5);
  assert.equal(posEventId(out), posEventId({ ...out, amountQ: 99 }));
  assert.notEqual(posEventId(out), posEventId({ ...out, source: "other-register" }));
});

test("rejects ambiguous amounts, foreign currency, and missing customer identity", () => {
  for (const patch of [{ amountQ: -1 }, { amountQ: "48.5" }, { amountQ: Infinity }, { amountQ: 1.001 }, { currency: "USD" }, { customerPhone: "" }, { saleId: "" }]) {
    assert.throws(() => normalizePosSale({ ...sale, ...patch }));
  }
});

test("sale values fit the database money and item-count columns", () => {
  assert.doesNotThrow(() => normalizePosSale({ ...sale, amountQ: 99999999.99, items: 2147483647 }));
  for (const patch of [{ amountQ: 100000000 }, { items: 2147483648 }]) {
    assert.throws(() => normalizePosSale({ ...sale, ...patch }), { statusCode: 400 });
  }
});

test("accepts generated bearer key and exact-body HMAC independently", () => {
  assert.doesNotThrow(() => verifyPosCredentials(business, { authorization: `Bearer ${key}` }));
  const rawBody = Buffer.from(JSON.stringify(sale));
  const signature = crypto.createHmac("sha256", key).update(rawBody).digest("hex");
  assert.doesNotThrow(() => verifyPosCredentials(business, { rawBody, signature }));
  assert.throws(() => verifyPosCredentials(business, { rawBody: Buffer.from("{}"), signature }), { statusCode: 401 });
});

test("accepts the UTF-8 raw body string captured by the production JSON parser", () => {
  const rawBody = JSON.stringify({ ...sale, source: "Café" });
  const signature = crypto.createHmac("sha256", key).update(Buffer.from(rawBody, "utf8")).digest("hex");
  assert.doesNotThrow(() => verifyPosCredentials(business, { rawBody, signature }));
  assert.throws(() => verifyPosCredentials(business, { rawBody: `${rawBody}\n`, signature }), { statusCode: 401 });
  for (const invalidBody of [undefined, null, JSON.parse(rawBody)]) {
    assert.throws(() => verifyPosCredentials(business, { rawBody: invalidBody, signature }), { statusCode: 401 });
  }
});

test("authenticates credentials before exposing a disabled connection", () => {
  const disabled = { ...business, program_json: { ...business.program_json, pos_integration: { enabled: false } } };
  for (const credentials of [{}, { authorization: "Bearer wrong" }, { signature: "wrong" }]) {
    assert.throws(() => verifyPosCredentials(disabled, credentials), { statusCode: 401 });
  }
  assert.throws(() => verifyPosCredentials(disabled, { authorization: `Bearer ${key}` }), { statusCode: 403 });
});

test("fails closed for missing, wrong, conflicting or disabled credentials", () => {
  for (const args of [{}, { authorization: "Bearer wrong" }, { signature: key }, { authorization: `Bearer ${key}`, signature: "wrong", rawBody: Buffer.from("{}") }]) {
    assert.throws(() => verifyPosCredentials(business, args), { statusCode: 401 });
  }
  assert.throws(() => verifyPosCredentials({ ...business, program_json: { ...business.program_json, pos_integration: { enabled: false } } }, { authorization: `Bearer ${key}` }), { statusCode: 403 });
});

test("safe connection responses never expose API or vendor tokens", () => {
  const safe = safePosIntegration(business);
  const serialized = JSON.stringify(safe);
  assert.equal(safe.has_api_key, true);
  assert.equal(safe.loyverse.configured, true);
  assert.equal(serialized.includes(key), false);
  assert.equal(serialized.includes("private-token"), false);
  assert.equal(safe.loyverse.merchant_id, "merchant-1");
});
