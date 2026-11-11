import test from "node:test";
import assert from "node:assert/strict";
import {
  editableRules,
  serializeRules,
  validateRules,
  campaignTemplate,
} from "../src/campaign-model.js";
test("preserves every supported field and zero minimum/hour values", () => {
  const rule = {
    id: "keep",
    name: "Mañana",
    active: false,
    kind: "bonus_points",
    value: 10,
    max_points: 100,
    program_type: "VISIT",
    condition: {
      weekdays: [0, 6],
      min_amount_q: 0,
      min_visits: 2,
      min_items: 0,
      start_hour: 0,
      end_hour: 23,
    },
  };
  assert.deepEqual(serializeRules(editableRules([rule])), [rule]);
});
test("does not silently discard unsupported rules or conditions", () => {
  assert.throws(
    () =>
      editableRules([
        { name: "Future", kind: "multiplier", value: 2, audience: "vip" },
      ]),
    /avanzada/,
  );
  assert.throws(
    () =>
      editableRules([
        {
          name: "Future",
          kind: "multiplier",
          value: 2,
          condition: { start_date: "2027" },
        },
      ]),
    /avanzada/,
  );
});
test("template is a disabled local draft with independent condition arrays", () => {
  const first = campaignTemplate("weekend"),
    second = campaignTemplate("weekend");
  first.condition.weekdays.push(1);
  assert.deepEqual(second.condition.weekdays, [0, 6]);
  assert.equal(first.active, false);
});
test("rejects nonfinite/negative rewards, inverted hours and invalid weekdays", () => {
  for (const value of [0, -1, Infinity, NaN])
    assert.ok(validateRules([{ ...campaignTemplate("weekend"), value }]));
  assert.ok(
    validateRules([
      {
        ...campaignTemplate("weekend"),
        condition: { start_hour: 18, end_hour: 9 },
      },
    ]),
  );
  assert.ok(
    validateRules([
      { ...campaignTemplate("weekend"), condition: { weekdays: [7] } },
    ]),
  );
  assert.equal(validateRules([campaignTemplate("weekend")]), "");
});
test("empty optional inputs are removed and empty weekdays mean every day", () => {
  const rule = campaignTemplate("weekend");
  rule.condition.weekdays = [];
  rule.max_points = "";
  rule.condition.start_hour = "";
  assert.equal(serializeRules([rule])[0].max_points, undefined);
  assert.equal(serializeRules([rule])[0].condition?.start_hour, undefined);
  assert.equal(serializeRules([rule])[0].condition?.weekdays, undefined);
});
test("fractional supported rewards round-trip; malformed rules require advanced editor", () => {
  const fractional = {
    name: "Fracción",
    kind: "bonus_points",
    value: 0.5,
    condition: { min_visits: 0.5 },
  };
  assert.deepEqual(serializeRules(editableRules([fractional])), [fractional]);
  assert.equal(validateRules([fractional]), "");
  for (const rule of [
    { ...fractional, name: 42 },
    { ...fractional, program_type: "NEW_TYPE" },
    { ...fractional, condition: [] },
  ])
    assert.throws(() => editableRules([rule]), /avanzada/);
});
test('legacy null or string conditions are never silently normalized', () => {
  for (const condition of [null, {end_hour:null}, {end_hour:''}, {min_amount_q:'10'}, {weekdays:null}]) {
    assert.throws(()=>editableRules([{name:'Legacy',kind:'multiplier',value:2,condition}]),/avanzada/);
  }
  assert.throws(()=>editableRules([{name:'Legacy',kind:'multiplier',value:2,max_points:null}]),/avanzada/);
});
