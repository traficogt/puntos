import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { planFeatures, planLimits, canUseProgramType } from "../../src/utils/plan.js";

describe("plan matrix contract", () => {
  it("keeps EMPRENDEDOR tight and usable", () => {
    const features = planFeatures("EMPRENDEDOR");
    const limits = planLimits("EMPRENDEDOR");

    assert.equal(features.rewards, true);
    assert.equal(features.redemptions, true);
    assert.equal(features.program_rules, true);
    assert.equal(features.staff_management, true);
    assert.equal(features.basic_reporting, true); // basic participation reporting on every tier

    assert.equal(features.analytics, false);
    assert.equal(features.tiers, false);
    assert.equal(features.referrals, false);
    assert.equal(features.customer_export, true); // own-data export in every tier
    assert.equal(features.branded_qr, false); // branded join QR is an Impulsa+ upsell
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
    assert.equal(features.basic_reporting, true);
    assert.equal(features.tiers, true);
    assert.equal(features.referrals, true);
    assert.equal(features.customer_export, true);
    assert.equal(features.multi_branch, true);
    assert.equal(features.gift_cards, true);
    assert.equal(features.campaign_rules, true);
    assert.equal(features.webhooks, false); // integration surface: Expande-only
    assert.equal(features.lifecycle_automation, true);
    assert.equal(features.rbac_matrix, false); // permission-matrix view: Expande-only

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

describe("program-type gating + fail-closed defaults", () => {
  it("gates the gift-card product to NEGOCIO and above", () => {
    assert.equal(canUseProgramType("EMPRENDEDOR", "GIFT_CARD"), false);
    assert.equal(canUseProgramType("NEGOCIO", "GIFT_CARD"), true);
    assert.equal(canUseProgramType("EMPRESA", "GIFT_CARD"), true);
  });

  it("keeps earning models (incl. CASHBACK/STAMP/DISCOUNT) free on every tier", () => {
    for (const type of ["SPEND", "VISIT", "ITEM", "DISCOUNT", "STAMP", "CASHBACK"]) {
      assert.equal(canUseProgramType("EMPRENDEDOR", type), true, type);
    }
  });

  it("respects platform overrides that grant gift cards to EMPRENDEDOR", () => {
    const overrides = { EMPRENDEDOR: { gift_cards: true } };
    assert.equal(canUseProgramType("EMPRENDEDOR", "GIFT_CARD", overrides), true);
  });

  it("fails closed: an unknown plan gets the lowest tier, not the top one", () => {
    assert.equal(planFeatures("bogus").gift_cards, planFeatures("EMPRENDEDOR").gift_cards);
    assert.equal(planFeatures("bogus").gamification, false);
    assert.equal(planLimits("bogus").activeCustomers, planLimits("EMPRENDEDOR").activeCustomers);
    assert.equal(canUseProgramType("bogus", "GIFT_CARD"), false);
  });
});
