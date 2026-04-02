import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { planFeatures, planLimits } from "../../src/utils/plan.js";

describe("plan matrix contract", () => {
  it("keeps EMPRENDEDOR tight and usable", () => {
    const features = planFeatures("EMPRENDEDOR");
    const limits = planLimits("EMPRENDEDOR");

    assert.equal(features.rewards, true);
    assert.equal(features.redemptions, true);
    assert.equal(features.program_rules, true);
    assert.equal(features.staff_management, true);

    assert.equal(features.analytics, false);
    assert.equal(features.tiers, false);
    assert.equal(features.referrals, false);
    assert.equal(features.customer_export, false);
    assert.equal(features.multi_branch, false);
    assert.equal(features.gift_cards, false);
    assert.equal(features.webhooks, false);
    assert.equal(features.campaign_rules, false);
    assert.equal(features.lifecycle_automation, false);
    assert.equal(features.rbac_matrix, false);
    assert.equal(features.external_awards, false);
    assert.equal(features.gamification, false);

    assert.equal(limits.branches, 1);
  });

  it("makes NEGOCIO the practical target plan", () => {
    const features = planFeatures("NEGOCIO");
    const limits = planLimits("NEGOCIO");

    assert.equal(features.analytics, true);
    assert.equal(features.tiers, true);
    assert.equal(features.referrals, true);
    assert.equal(features.customer_export, true);
    assert.equal(features.multi_branch, true);
    assert.equal(features.gift_cards, true);
    assert.equal(features.campaign_rules, true);
    assert.equal(features.webhooks, true);
    assert.equal(features.lifecycle_automation, true);
    assert.equal(features.rbac_matrix, true);

    assert.equal(features.external_awards, false);
    assert.equal(features.gamification, false);
    assert.equal(limits.branches, 3);
  });

  it("keeps EMPRESA as the strategic integration tier", () => {
    const features = planFeatures("EMPRESA");

    assert.equal(features.analytics, true);
    assert.equal(features.tiers, true);
    assert.equal(features.referrals, true);
    assert.equal(features.customer_export, true);
    assert.equal(features.multi_branch, true);
    assert.equal(features.gift_cards, true);
    assert.equal(features.campaign_rules, true);
    assert.equal(features.webhooks, true);
    assert.equal(features.lifecycle_automation, true);
    assert.equal(features.rbac_matrix, true);
    assert.equal(features.external_awards, true);
    assert.equal(features.gamification, true);
  });
});
