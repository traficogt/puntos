import { setHidden } from "/lib.js";
import { createSessionEpoch, revokeServerSession } from "../session-epoch.js";

/** @typedef {import("./types.js").SuperPageContext} SuperPageContext */

const PRIVATE_CARDS = ["#planes", "#seguridad", "#negocios", "#salud"];

/**
 * Super-admin session: login, logout with the cross-tab pending-logout
 * handshake, and the gate that loads private data only for the current session.
 *
 * @param {SuperPageContext} ctx
 * @param {{ platformHealth: { clear(): void }, loadPrivateData: (current: () => boolean) => Promise<void> }} deps
 */
export function createSuperSession(ctx, { platformHealth, loadPrivateData }) {
  const { api, toast, state, run, element, input } = ctx;
  const epoch = createSessionEpoch("super");
  state.logoutPending = epoch.hasPendingLogout();

  function hidePrivateView() {
    platformHealth.clear();
    for (const selector of PRIVATE_CARDS) setHidden(element(selector), true);
    setHidden(element("#loginCard"), false);
    setHidden(element("#btnLogout"), !state.logoutPending);
    for (const selector of ["#superMfaSecret", "#magicLinkOutput", "#magicLinkCopy"])
      element(selector).textContent = "";
    state.planList = [];
    state.businessList = [];
    state.magicActorRows = [];
  }

  function showPrivateView() {
    setHidden(element("#loginCard"), true);
    for (const selector of PRIVATE_CARDS) setHidden(element(selector), false);
    setHidden(element("#btnLogout"), false);
  }

  async function revokePendingSession() {
    await revokeServerSession(api, "/api/super/logout");
    state.logoutPending = false;
    epoch.clearPendingLogout();
    hidePrivateView();
  }

  async function logout() {
    if (state.sessionActionInProgress) return;
    state.sessionActionInProgress = true;
    state.logoutPending = true;
    state.sessionGeneration += 1;
    epoch.invalidate({ pending: true });
    hidePrivateView();
    try {
      await revokePendingSession();
      toast("Sesión cerrada.");
    } catch {
      toast("No se pudo cerrar la sesión en el servidor. Reconecta e inténtalo de nuevo.");
    } finally {
      state.sessionActionInProgress = false;
    }
  }

  async function loadMe() {
    if (state.logoutPending) {
      hidePrivateView();
      return;
    }
    const generation = state.sessionGeneration;
    const current = () => !state.logoutPending && generation === state.sessionGeneration;
    await run(
      async () => {
        await api("/api/super/me");
        if (!current()) return;
        showPrivateView();
        await loadPrivateData(current);
      },
      () => {
        if (generation === state.sessionGeneration) hidePrivateView();
      },
    );
  }

  async function login() {
    if (state.sessionActionInProgress) return;
    state.sessionActionInProgress = true;
    await run(
      async () => {
        if (state.logoutPending || epoch.hasPendingLogout()) await revokePendingSession();
        await api("/api/super/login", {
          method: "POST",
          body: JSON.stringify({
            email: input("#email").value.trim(),
            password: input("#password").value,
            ...(input("#loginMfaCode").value.trim()
              ? { mfaCode: input("#loginMfaCode").value.trim() }
              : {}),
          }),
        });
        state.sessionGeneration += 1;
        epoch.invalidate();
        input("#password").value = "";
        input("#loginMfaCode").value = "";
        toast("Sesión iniciada.");
        await loadMe();
      },
      (error) => {
        toast(error.message);
      },
    );
    state.sessionActionInProgress = false;
  }

  function bind() {
    element("#btnLogin").addEventListener("click", login);
    element("#btnLogout").addEventListener("click", logout);
    window.addEventListener("online", () => {
      if (state.logoutPending) return logout();
      return undefined;
    });
    window.addEventListener("storage", (event) => {
      if (!epoch.touchedBy(event)) return;
      state.sessionGeneration += 1;
      state.logoutPending = epoch.hasPendingLogout();
      hidePrivateView();
    });
  }

  /** Finishes an interrupted logout before anything else, never reopening the old cookie. */
  async function start() {
    if (state.logoutPending) await logout();
    else await loadMe();
  }

  return { bind, loadMe, start };
}
