import { toggleProgramBoxes, updateProgramSummary } from "./program-form.js";

/** @typedef {import("../types.js").AdminDashboardApp} AdminDashboardApp */

const SUMMARY_FIELDS = [
  "#programPointsPerQ",
  "#programRound",
  "#programPointsPerVisit",
  "#programPointsPerItem",
  "#guardMaxAmount",
  "#guardMaxPoints",
  "#guardMaxVisits",
  "#guardMaxItems",
  "#guardSuspiciousPoints",
  "#guardSuspiciousAmount",
  "#pendingHoldDays",
  "#pointsExpirationDays",
  "#redeemMaxPerDay",
  "#redeemMaxPerRewardDay",
  "#redeemCooldownHours"
];

/**
 * @param {AdminDashboardApp} app
 * @param {{
 *   loadCampaignRules: () => Promise<void>,
 *   saveCampaignRules: () => Promise<void>,
 *   loadExternalAwards: () => Promise<void>,
 *   saveExternalAwards: () => Promise<void>,
 *   loadSuspiciousAwards: () => Promise<void>,
 *   saveProgramRule: () => Promise<void>,
 *   applyAutomationTemplate: (template: string) => Promise<void>
 * }} actions
 */
export function initProgramListeners(app, actions) {
  const { $ } = app;

  function fire(task) {
    return () => {
      task().catch(() => {});
    };
  }

  $("#programType")?.addEventListener("change", () => {
    toggleProgramBoxes($);
    updateProgramSummary($);
  });

  SUMMARY_FIELDS.forEach((selector) => {
    const element = document.querySelector(selector);
    if (!element) return;
    element.addEventListener("input", () => updateProgramSummary($));
    element.addEventListener("change", () => updateProgramSummary($));
  });

  $("#btnSaveProgram")?.addEventListener("click", () => actions.saveProgramRule().catch(() => {}));
  $("#btnRefreshSuspicious")?.addEventListener("click", fire(actions.loadSuspiciousAwards));
  $("#btnLoadCampaignRules")?.addEventListener("click", () => actions.loadCampaignRules().catch(() => {}));
  $("#btnSaveCampaignRules")?.addEventListener("click", () => actions.saveCampaignRules().catch(() => {}));
  $("#btnLoadExternalAwards")?.addEventListener("click", () => actions.loadExternalAwards().catch(() => {}));
  $("#btnSaveExternalAwards")?.addEventListener("click", () => actions.saveExternalAwards().catch(() => {}));
  $("#btnTplCafeBasico")?.addEventListener("click", () => actions.applyAutomationTemplate("cafeteria_basico").catch(() => {}));
  $("#btnTplReactivacion")?.addEventListener("click", () => actions.applyAutomationTemplate("reactivacion_fuerte").catch(() => {}));
  $("#btnTplSoloAlertas")?.addEventListener("click", () => actions.applyAutomationTemplate("solo_alertas").catch(() => {}));
}
