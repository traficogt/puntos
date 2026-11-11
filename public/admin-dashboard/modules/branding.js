import { createBrandingActions } from "./branding-actions.js";
import { updateBrandingSummary } from "./branding-form.js";
import { createCustomerEnrollment } from "./customer-enrollment.js";

/** @typedef {import("../types.js").AdminDashboardApp} AdminDashboardApp */

/**
 * @param {AdminDashboardApp} app
 */
export function registerBrandingModule(app) {
  const actions = createBrandingActions(app);
  const enrollment = createCustomerEnrollment(app);

  app.registerTab("branding", {
    load: async () => { await Promise.all([actions.loadBranding(), enrollment.load()]); }
  });

  app.onAfterPlanReady(async () => {
    const selectors = [
      "#brandingMode",
      "#brandingProgramName",
      "#brandingLogoUrl",
      "#brandingQrLogoEnabled",
      "#brandingPrimaryColor",
      "#brandingAccentColor",
      "#brandingNeutralTheme",
      "#brandingWalletHeadline",
      "#brandingJoinHeadline"
    ];

    selectors.forEach((selector) => {
      app.$(selector)?.addEventListener("input", () => updateBrandingSummary(app.$, app));
      app.$(selector)?.addEventListener("change", () => updateBrandingSummary(app.$, app));
    });
    app.$("#brandingPoweredByVisible")?.addEventListener("change", () => updateBrandingSummary(app.$, app));
    app.$("#btnSaveBranding")?.addEventListener("click", () => {
      actions.saveBranding().catch(() => {});
    });
    app.$("#btnReloadBranding")?.addEventListener("click", () => {
      actions.loadBranding().catch(() => {});
    });

    await Promise.all([actions.loadBranding(), enrollment.load()]);
  });
}
