import test from "node:test";
import assert from "node:assert/strict";
const definition = () => ({ window_days: 90, include: { match: "all", rules: [{ field: "purchase_count", operator: "gte", value: 3 }] }, exclude: { match: "any", rules: [] } });
let model;
try { model = await import("../../src/app/services/customer-audience-definition.js"); } catch { /* initial missing feature */ }

test("audience definition supports bounded include/exclude groups without coercion", () => {
  assert.equal(typeof model?.parseAudienceDefinition, "function", "Audience validation must exist");
  const value = definition();
  assert.deepEqual(model.parseAudienceDefinition(value), value);
  for (const patch of [{ window_days: 7 }, { window_days: "90" }, { include: { match: "all", rules: [] } }, { exclude: { match: "any", rules: Array(9).fill(value.include.rules[0]) } }, { customer_ids: ["arbitrary"] }])
    assert.throws(() => model.parseAudienceDefinition({ ...value, ...patch }), { statusCode: 400 });
});
test("rules accept only typed allowlisted fields and operators", () => {
  assert.equal(typeof model?.parseAudienceDefinition, "function", "Audience validation must exist");
  const invalid = [
    { field: "phone", operator: "eq", value: "55554444" }, { field: "purchase_count", operator: "gte", value: "3" },
    { field: "purchase_count", operator: "gte", value: 0.5 }, { field: "spend_q", operator: "gte", value: 0.001 },
    { field: "points_balance", operator: "gte", value: -1 }, { field: "joined_days", operator: "sql", value: 10 },
    { field: "has_purchase", operator: "gte", value: true }, { field: "marketing_opt_in", operator: "eq", value: 1 },
    { field: "last_purchase_days", operator: "eq", value: null }, { field: "spend_q", operator: "lte", value: Infinity },
    { field: "has_purchase", operator: "eq", value: false, expression: "arbitrary" },
  ];
  for (const rule of invalid) assert.throws(() => model.parseAudienceDefinition({ ...definition(), include: { match: "all", rules: [rule] } }));
  assert.equal(model.parseAudienceDefinition({ ...definition(), include: { match: "any", rules: [{ field: "has_purchase", operator: "eq", value: false }, { field: "spend_q", operator: "lte", value: 25.75 }] } }).include.rules[0].value, false);
});
