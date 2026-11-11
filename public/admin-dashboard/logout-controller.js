import { setHidden } from "/lib.js";

let sessionBlocked = false;
let sessionGeneration = 0;

function readSessionStorage(key) {
  try { return localStorage.getItem(key) || ""; } catch { return ""; }
}

export function isDashboardSessionBlocked() {
  return sessionBlocked || readSessionStorage("pf_staff_logout_pending") === "1";
}

export function captureDashboardSession() {
  const generation = sessionGeneration;
  const epoch = readSessionStorage("pf_staff_epoch");
  return () => !sessionBlocked && generation === sessionGeneration && epoch === readSessionStorage("pf_staff_epoch");
}

/**
 * @param {{ api: import("./types.js").ApiFn, $: import("./types.js").QueryFn, toast: import("./types.js").ToastFn }} deps
 */
export function initDashboardLogout({ api, $, toast }) {
  let logoutInFlight = false;

  function hidePrivateView() {
    sessionBlocked = true;
    sessionGeneration += 1;
    setHidden($("#main"), true);
    setHidden($("#needLogin"), false);
  }

  async function logout() {
    if (logoutInFlight) return;
    logoutInFlight = true;
    hidePrivateView();
    try {
      localStorage.setItem("pf_staff_logout_pending", "1");
      localStorage.removeItem("pf_staff_snapshot");
      localStorage.setItem("pf_staff_epoch", crypto.randomUUID());
    } catch { /* The current page stays blocked even when storage is unavailable. */ }
    try {
      try { await api("/api/staff/logout", { method: "POST", body: "{}" }); }
      catch (error) { if (error.status !== 401) throw error; }
      try { localStorage.removeItem("pf_staff_logout_pending"); } catch {}
      location.href = "/equipo/ingresar/";
    } catch {
      toast("No se pudo cerrar la sesión en el servidor. Reconecta e inténtalo de nuevo.");
    } finally {
      logoutInFlight = false;
    }
  }

  $("#btnLogout")?.addEventListener("click", logout);
  window.addEventListener("online", () => {
    if (sessionBlocked && readSessionStorage("pf_staff_logout_pending") === "1") return logout();
  });
  window.addEventListener("storage", event => {
    if (event.key === "pf_staff_epoch" || event.key === "pf_staff_logout_pending" && event.newValue === "1") hidePrivateView();
  });
  if (readSessionStorage("pf_staff_logout_pending") === "1") void logout();
}
