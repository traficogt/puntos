import { registerServiceWorker, setHidden, setBrowserRegion } from "/lib.js";
import { copyCurrentViewUrl } from "./view-state.js";
import { captureDashboardSession, initDashboardLogout, isDashboardSessionBlocked } from "./logout-controller.js";

/** @typedef {import("./types.js").ApiFn} ApiFn */
/** @typedef {import("./types.js").DashboardState} DashboardState */
/** @typedef {import("./types.js").QueryFn} QueryFn */
/** @typedef {import("./types.js").ToastFn} ToastFn */

/** @param {ApiFn} api @param {DashboardState} state */
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
  const isCurrent = captureDashboardSession();
  if (isDashboardSessionBlocked()) {
    setHidden($("#needLogin"), false);
    setHidden($("#main"), true);
    return false;
  }
  try {
    const data = await api("/api/staff/me");
    if (!isCurrent()) return false;
    state.currentStaff = data.staff;

    if (!["OWNER", "MANAGER"].includes(state.currentStaff.role)) {
      setHidden($("#needLogin"), false);
      setHidden($("#main"), true);
      return false;
    }
    const program = await api("/api/staff/program");
    if (!isCurrent()) return false;
    setBrowserRegion(program.region);
    document.querySelectorAll("[data-business-currency]").forEach(node => { node.textContent = program.region?.currency || "GTQ"; });
    document.querySelectorAll("[data-business-money]").forEach(node => { if(node instanceof HTMLInputElement)node.step=program.region?.minorUnits===0?"1":"0.01"; });
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

  initDashboardLogout({ api, $, toast });
  registerServiceWorker().catch(() => {});
}
