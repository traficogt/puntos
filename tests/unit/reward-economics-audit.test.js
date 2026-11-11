import test from "node:test";
import assert from "node:assert/strict";
import { updateRewardUnitCost, updateRewardEconomicsSettings } from "../../src/app/services/reward-economics-service.js";

test("cost and assumption audits retain authenticated super-admin impersonation with their own values", async () => {
  const recorded = [];
  const client = { async query(sql, params) {
    if (sql.startsWith("SELECT id,plan")) return { rows: [{ id: "business", plan: "NEGOCIO" }] };
    if (sql.startsWith("SELECT id FROM rewards")) return { rows: [{ id: "reward" }] };
    if (sql.includes("INSERT INTO audit_logs")) recorded.push({ action: params[3], meta: JSON.parse(params[6]) });
    return { rows: [] };
  } };
  const deps = { transaction: fn => fn(client), getPlanFeatureOverrides: async () => ({}) };
  const actor = { businessId: "business", staffId: "owner", impersonated_by: "support@example.invalid" };
  await updateRewardUnitCost({ ...actor, rewardId: "reward", unitCostQ: 4.5 }, deps);
  await updateRewardEconomicsSettings({ ...actor, grossMarginPct: 40, costPerPointQ: 0.1 }, deps);
  assert.equal(recorded.length, 2);
  assert.equal(recorded[0].meta.unit_cost_q, 4.5);
  assert.equal(recorded[1].meta.gross_margin_pct, 40);
  for (const entry of recorded) assert.equal(entry.meta.impersonated_by_super_admin_email, actor.impersonated_by);
});
