import { createSessionEpoch } from "../session-epoch.js";

/** @typedef {import("./types.js").StaffMeResponse} StaffMeResponse */
/** @typedef {import("./types.js").StaffOfflineSnapshot} StaffOfflineSnapshot */
/** @typedef {import("./types.js").StaffPageContext} StaffPageContext */
/** @typedef {import("./types.js").StaffPermissionsResponse} StaffPermissionsResponse */
/** @typedef {import("./types.js").StaffProgramRule} StaffProgramRule */
/** @typedef {import("./types.js").StaffSessionHooks} StaffSessionHooks */

const SNAPSHOT_MAX_AGE_MS = 86400000;
const PENDING_LOGOUT_MESSAGE =
  "Sesión bloqueada en este dispositivo. El cierre en el servidor está pendiente de conexión; tus ventas siguen guardadas para su cuenta original.";

export function isAuthError(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "");
  return (
    error?.status === 401 ||
    error?.status === 403 ||
    code === "AUTH_REQUIRED" ||
    code === "AUTH_INVALID_TOKEN" ||
    code === "FORBIDDEN" ||
    /No autenticado|Token invalido|No autorizado|no auth/i.test(message)
  );
}

export function isNetworkFailure(error) {
  if (error?.status || error?.code) return false;
  const message = String(error?.message || "");
  return !navigator.onLine || /NetworkError|Failed to fetch|fetch|abort/i.test(message);
}

/**
 * Staff session lifecycle: server validation, the 24 h offline snapshot, role
 * permissions, plan features, the offline award grant, and the cross-tab
 * logout handshake shared with the owner dashboard and the login page.
 *
 * @param {StaffPageContext} ctx
 * @param {StaffSessionHooks} hooks UI reactions owned by other modules.
 */
export function createStaffSession(ctx, hooks) {
  const { api, toast, state, run, element } = ctx;
  const epoch = createSessionEpoch("staff");
  let authFlight = null;
  let logoutPending = false;
  let logoutFlight = null;

  function currentScope() {
    return state.staff?.id && state.staff?.business_id
      ? { businessId: state.staff.business_id, staffId: state.staff.id }
      : null;
  }

  function hasOfflineGrant() {
    return (
      !state.sessionEnded &&
      typeof state.offlineGrant?.grant === "string" &&
      Date.parse(state.offlineGrant.expiresAt) > Date.now()
    );
  }

  /** @returns {StaffOfflineSnapshot | null} */
  function readOfflineSnapshot() {
    try {
      const raw = localStorage.getItem("pf_staff_snapshot");
      const snapshot = raw ? JSON.parse(raw) : null;
      return snapshot?.staff?.id &&
        snapshot?.staff?.business_id &&
        Date.now() - Date.parse(snapshot.updatedAt) < SNAPSHOT_MAX_AGE_MS
        ? snapshot
        : null;
    } catch {
      return null;
    }
  }

  function writeOfflineSnapshot() {
    try {
      localStorage.setItem(
        "pf_staff_snapshot",
        JSON.stringify({
          staff: state.staff,
          permissions: state.permissionSet ? [...state.permissionSet] : [],
          planFeatures: state.planFeatures,
          programRule: state.programRule,
          offlineGrant: state.offlineGrant,
          updatedAt: new Date().toISOString(),
        }),
      );
    } catch {}
  }

  function clearOfflineSnapshot() {
    try {
      localStorage.removeItem("pf_staff_snapshot");
    } catch {}
  }

  function hasPendingLogout() {
    return logoutPending || epoch.hasPendingLogout();
  }

  function redirectToLogin(message = "Necesitas iniciar sesión.") {
    toast(message);
    setTimeout(() => (location.href = "/equipo/ingresar/"), 600);
    return null;
  }

  function blockLocalSession() {
    hooks.destroyMounts();
    state.sessionEnded = true;
    state.sessionOnline = false;
    state.permissionSet = new Set();
    state.offlineGrant = null;
    state.staff = null;
    state.scanning = false;
    hooks.stopCamera();
    hooks.clearSelectedCustomer();
    hooks.applyUiPermissions();
  }

  async function completePendingLogout() {
    if (logoutFlight) return logoutFlight;
    if (!navigator.onLine) {
      toast(PENDING_LOGOUT_MESSAGE);
      return false;
    }
    logoutFlight = run(
      async () => {
        await api("/api/staff/logout", {
          method: "POST",
          body: "{}",
          signal: AbortSignal.timeout(10000),
        });
        logoutPending = false;
        epoch.clearPendingLogout();
        redirectToLogin(
          "Sesión cerrada. Las ventas pendientes siguen guardadas para su cuenta original.",
        );
        return true;
      },
      () => {
        toast(PENDING_LOGOUT_MESSAGE);
        return false;
      },
    ).finally(() => {
      logoutFlight = null;
    });
    return logoutFlight;
  }

  function hasPerm(permission) {
    return !state.sessionEnded && state.permissionSet ? state.permissionSet.has(permission) : false;
  }

  function hasFeature(feature) {
    return Object.prototype.hasOwnProperty.call(state.planFeatures, feature)
      ? Boolean(state.planFeatures[feature])
      : true;
  }

  function canUseRedeemFlow() {
    return (
      navigator.onLine &&
      state.sessionOnline &&
      hasPerm("staff.redeem") &&
      hasFeature("redemptions")
    );
  }

  function canUseGiftCards() {
    return hasFeature("gift_cards") && Boolean(state.staff?.can_manage_gift_cards);
  }

  async function loadPermissions() {
    const out = /** @type {StaffPermissionsResponse} */ (await api("/api/staff/permissions"));
    const matrix = out.matrix || {};
    const perms = Array.isArray(matrix[state.staff.role]) ? matrix[state.staff.role] : [];
    state.permissionSet = new Set(perms);
    hooks.applyUiPermissions();
  }

  async function loadProgramRule() {
    const out = /** @type {StaffProgramRule} */ (await api("/api/staff/program"));
    state.programRule = out;
    hooks.renderProgramInfo();
    hooks.updateInputsForRule();
  }

  async function ensureAuth() {
    if (hasPendingLogout()) {
      blockLocalSession();
      await completePendingLogout();
      return false;
    }
    if (state.sessionEnded) return false;
    if (authFlight) return authFlight;
    authFlight = run(
      async () => {
        const me = /** @type {StaffMeResponse} */ (await api("/api/staff/me"));
        if (state.sessionEnded) return false;
        if (!me.staff?.id || !me.staff?.business_id)
          throw new Error("La sesión no identifica el negocio. Vuelve a iniciar sesión.");
        if (
          state.staff &&
          (state.staff.id !== me.staff.id || state.staff.business_id !== me.staff.business_id)
        ) {
          state.permissionSet = null;
          state.programRule = null;
          state.offlineGrant = null;
          hooks.clearSelectedCustomer();
          clearOfflineSnapshot();
        }
        state.staff = me.staff;
        state.planFeatures = me.features || {};
        await loadPermissions();
        await loadProgramRule();
        if (
          hasPerm("staff.award") &&
          (!hasOfflineGrant() || Date.parse(state.offlineGrant.expiresAt) < Date.now() + 300000)
        ) {
          try {
            const grant = await api("/api/staff/offline-grant");
            if (typeof grant?.grant === "string" && Date.parse(grant.expiresAt) > Date.now())
              state.offlineGrant = { grant: grant.grant, expiresAt: grant.expiresAt };
          } catch (error) {
            if (isAuthError(error)) throw error;
          }
        }
        if (state.sessionEnded) return false;
        state.sessionOnline = true;
        writeOfflineSnapshot();
        hooks.applyUiPermissions();
        return true;
      },
      async (error) => {
        state.sessionOnline = false;
        if (isAuthError(error)) {
          clearOfflineSnapshot();
          state.staff = null;
          state.permissionSet = new Set();
          state.offlineGrant = null;
          hooks.clearSelectedCustomer();
          return redirectToLogin();
        }
        if (isNetworkFailure(error)) {
          const snapshot = readOfflineSnapshot();
          if (
            snapshot?.staff &&
            (!state.staff ||
              (state.staff.id === snapshot.staff.id &&
                state.staff.business_id === snapshot.staff.business_id))
          ) {
            state.staff = snapshot.staff;
            state.permissionSet = new Set(snapshot.permissions || []);
            state.planFeatures = snapshot.planFeatures || {};
            state.programRule = snapshot.programRule || null;
            state.offlineGrant = snapshot.offlineGrant || null;
            hooks.renderProgramInfo();
            hooks.updateInputsForRule();
            hooks.applyUiPermissions();
            toast("Modo sin conexión: usando la última sesión guardada.");
            return true;
          }
          return redirectToLogin("Sin conexión y sin sesión guardada.");
        }

        toast(error?.message || "No se pudo validar la sesión.");
        return null;
      },
    ).finally(() => {
      authFlight = null;
    });
    return authFlight;
  }

  async function logout() {
    logoutPending = true;
    epoch.invalidate({ pending: true });
    blockLocalSession();
    await completePendingLogout();
  }

  /** @param {StorageEvent} event */
  function onStorage(event) {
    if (epoch.pendingClearedBy(event) && state.sessionEnded) {
      redirectToLogin("La sesión se cerró o cambió en otra pestaña.");
      return;
    }
    let changed = event.key === null || epoch.supersededBy(event);
    if (event.key === epoch.keys.snapshot) {
      const snapshot = readOfflineSnapshot();
      changed ||=
        !snapshot ||
        Boolean(
          state.staff &&
          (snapshot.staff.id !== state.staff.id ||
            snapshot.staff.business_id !== state.staff.business_id),
        );
    }
    if (!changed) return;
    blockLocalSession();
    if (hasPendingLogout()) completePendingLogout();
    else redirectToLogin("La sesión cambió en otra pestaña. Vuelve a iniciar sesión.");
  }

  function bind() {
    element("#btnLogout").addEventListener("click", logout);
    window.addEventListener("storage", onStorage);
  }

  return {
    bind,
    canUseGiftCards,
    canUseRedeemFlow,
    clearOfflineSnapshot,
    completePendingLogout,
    currentScope,
    ensureAuth,
    hasFeature,
    hasOfflineGrant,
    hasPendingLogout,
    hasPerm,
  };
}
