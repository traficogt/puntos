import { createBrandingActions } from "./branding-actions.js";
import { updateBrandingSummary } from "./branding-form.js";

/** @typedef {import("../types.js").AdminDashboardApp} AdminDashboardApp */

/**
 * @param {AdminDashboardApp} app
 */
export function registerBrandingModule(app) {
  const actions = createBrandingActions(app);

  app.registerTab("branding", {
    load: () => actions.loadBranding()
  });

  app.onAfterPlanReady(async () => {
    const selectors = [
      "#brandingMode",
      "#brandingProgramName",
      "#brandingLogoUrl",
      "#brandingPrimaryColor",
      "#brandingAccentColor",
      "#brandingNeutralTheme",
      "#brandingWalletHeadline",
      "#brandingJoinHeadline"
    ];

    selectors.forEach((selector) => {
      app.$(selector)?.addEventListener("input", () => updateBrandingSummary(app.$));
      app.$(selector)?.addEventListener("change", () => updateBrandingSummary(app.$));
    });
    app.$("#brandingPoweredByVisible")?.addEventListener("change", () => updateBrandingSummary(app.$));
    app.$("#btnSaveBranding")?.addEventListener("click", () => {
      actions.saveBranding().catch(() => {});
    });
    app.$("#btnReloadBranding")?.addEventListener("click", () => {
      actions.loadBranding().catch(() => {});
    });

    await actions.loadBranding();
  });
}
