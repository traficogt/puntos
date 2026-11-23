import { setHidden } from "/lib.js";
import { createSessionEpoch, revokeServerSession } from "../session-epoch.js";

const session = createSessionEpoch("staff");
let sessionBlocked = false;
let sessionGeneration = 0;

export function isDashboardSessionBlocked() {
  return sessionBlocked || session.hasPendingLogout();
}

export function captureDashboardSession() {
  const generation = sessionGeneration;
  const epochUnchanged = session.capture();
  return () => !sessionBlocked && generation === sessionGeneration && epochUnchanged();
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
    session.invalidate({ pending: true });
    try {
      await revokeServerSession(api, "/api/staff/logout");
      session.clearPendingLogout();
      location.href = "/equipo/ingresar/";
    } catch {
      toast("No se pudo cerrar la sesión en el servidor. Reconecta e inténtalo de nuevo.");
    } finally {
      logoutInFlight = false;
    }
  }

  $("#btnLogout")?.addEventListener("click", logout);
  window.addEventListener("online", () => {
    if (sessionBlocked && session.hasPendingLogout()) return logout();
    return undefined;
  });
  window.addEventListener("storage", (event) => {
    if (session.supersededBy(event)) hidePrivateView();
  });
  if (session.hasPendingLogout()) void logout();
}
