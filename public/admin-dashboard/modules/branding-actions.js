import {
  buildBrandingPayload,
  fillBrandingForm,
  updateBrandingSummary
} from "./branding-form.js";

/** @typedef {import("../types.js").AdminDashboardApp} AdminDashboardApp */

/**
 * @param {AdminDashboardApp} app
 */
export function createBrandingActions(app) {
  const { api, $, toast } = app;

  async function loadBranding() {
    try {
      const out = await api("/api/admin/branding");
      fillBrandingForm($, out.customer_branding || {});
      updateBrandingSummary($);
    } catch (error) {
      toast("No se pudo cargar branding de clientes: " + error.message);
    }
  }

  async function saveBranding() {
    try {
      const out = await api("/api/admin/branding", {
        method: "PUT",
        body: JSON.stringify(buildBrandingPayload($))
      });
      fillBrandingForm($, out.customer_branding || {});
      updateBrandingSummary($);
      toast("Branding de clientes guardado.");
    } catch (error) {
      toast("No se pudo guardar branding de clientes: " + error.message);
    }
  }

  return {
    loadBranding,
    saveBranding
  };
}
