import { registerServiceWorker, setHidden } from "/lib.js";
import { copyCurrentViewUrl } from "./view-state.js";

/** @typedef {import("./types.js").ApiFn} ApiFn */
/** @typedef {import("./types.js").DashboardState} DashboardState */
/** @typedef {import("./types.js").QueryFn} QueryFn */
/** @typedef {import("./types.js").ToastFn} ToastFn */

/**
 * @param {ApiFn} api
 * @param {DashboardState} state
 */
export async function loadPlanInfo(api, state) {
  const out = await api("/api/admin/plan");
  state.planInfo = {
    plan: out.plan || "",
    limits: out.limits || {},
    features: out.features || {}
  };
}

/**
 * @param {{ api: ApiFn, $: QueryFn, state: DashboardState }} deps
 */
export async function loadStaffSession({ api, $, state }) {
  try {
    const data = await api("/api/staff/me");
    state.currentStaff = data.staff;

    if (!["OWNER", "MANAGER"].includes(state.currentStaff.role)) {
      setHidden($("#needLogin"), false);
      setHidden($("#main"), true);
      return false;
    }
    state.managerMode = state.currentStaff.role === "MANAGER";
    setHidden($("#needLogin"), true);
    setHidden($("#main"), false);
    const businessName = $("#businessName");
    if (businessName) businessName.textContent = state.managerMode ? "Panel Gerente" : "Panel Admin";
    return true;
  } catch {
    setHidden($("#needLogin"), false);
    setHidden($("#main"), true);
    return false;
  }
}

/**
 * @param {{ api: ApiFn, $: QueryFn, toast: ToastFn, syncDashboardViewToUrl: () => void }} deps
 */
export function initDashboardChrome({ api, $, toast, syncDashboardViewToUrl }) {
  $("#btnShareView")?.addEventListener("click", async () => {
    try {
      await copyCurrentViewUrl(syncDashboardViewToUrl);
      toast("URL de la vista copiada.");
    } catch {
      toast("No se pudo copiar la URL de la vista.");
    }
  });

  $("#btnLogout")?.addEventListener("click", async () => {
    await api("/api/staff/logout", { method: "POST", body: "{}" }).catch(() => {});
    location.href = "/staff/login";
  });

  registerServiceWorker().catch(() => {});
}
