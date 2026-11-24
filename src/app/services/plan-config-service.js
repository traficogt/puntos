import { PlatformSettingsRepo } from "../repositories/platform-settings-repository.js";
import { listPlans, mergePlanFeatures } from "../../utils/plan.js";

const PLAN_FEATURES_KEY = "plan_features";

export const PlanConfigService = {
  async getPlanFeatureOverrides() {
    return PlatformSettingsRepo.getPlanFeatures();
  },

  /** @param {Record<string, unknown> | undefined} overrides plan→feature map (stored or submitted); mergePlanFeatures sanitizes it */
  async setPlanFeatureOverrides(overrides) {
    const sanitized = mergePlanFeatures(overrides);
    return PlatformSettingsRepo.setJson(PLAN_FEATURES_KEY, sanitized);
  },

  /**
   * @param {string} plan
   * @param {Record<string, boolean>} featurePatch
   */
  async updatePlanFeatures(plan, featurePatch) {
    const current = await this.getPlanFeatureOverrides();
    const merged = mergePlanFeatures(current);
    if (!merged[plan]) return null;
    merged[plan] = { ...merged[plan], ...featurePatch };
    const saved = await this.setPlanFeatureOverrides(merged);
    return saved[plan] || null;
  },

  async listPlans() {
    const overrides = await this.getPlanFeatureOverrides();
    return listPlans(overrides);
  },
};
