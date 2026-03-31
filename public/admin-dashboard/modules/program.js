import { toggleProgramBoxes, updateProgramSummary } from "./program-form.js";
import { createProgramActions } from "./program-actions.js";
import { initProgramListeners } from "./program-listeners.js";

/** @typedef {import("../types.js").AdminDashboardApp} AdminDashboardApp */

/**
 * @param {AdminDashboardApp} app
 */
export function registerProgramModule(app) {
  const actions = createProgramActions(app);

  app.onAfterPlanReady(async () => {
    initProgramListeners(app, actions);
    toggleProgramBoxes(app.$);
    updateProgramSummary(app.$);

    if (app.hasFeature("program_rules")) {
      app.state.initialProgramLoad = actions.loadProgramRule();
      await app.state.initialProgramLoad;
    }

    if (app.hasFeature("fraud_monitoring")) await actions.loadSuspiciousAwards();
    if (app.hasFeature("campaign_rules")) await actions.loadCampaignRules();
    if (app.hasFeature("external_awards")) await actions.loadExternalAwards();
  });

  app.onBranchFilterChanged(() => {
    if (!app.hasFeature("fraud_monitoring")) return;
    actions.loadSuspiciousAwards().catch(() => {});
  });
}
