import {
  addAward as storeAward,
  deleteAward as removeAward,
  getAwardQueueStats,
  requeueSyncingAwards,
  updateAward,
  listAwards as listStoredAwards,
} from "/idb.js";
import { createAwardQueue } from "./award-queue.js";
import { isNetworkFailure } from "./session.js";

/** @typedef {import("./types.js").StaffAwardResponse} StaffAwardResponse */
/** @typedef {import("./types.js").StaffPageContext} StaffPageContext */

/**
 * Awarding points: validation, the offline-first award queue, the queue badge,
 * background synchronisation and the lifecycle events that drive it.
 * @param {StaffPageContext} ctx
 * @param {{ session: ReturnType<typeof import("./session.js").createStaffSession>, surface: ReturnType<typeof import("./customer-surface.js").createCustomerSurface> }} deps
 */
export function createAwardFlow(ctx, { session, surface }) {
  const { api, toast, state, run, uuidv4, element, input } = ctx;
  const queue = createAwardQueue({
    store: {
      addAward: storeAward,
      listAwards: listStoredAwards,
      updateAward,
      deleteAward: removeAward,
    },
    api,
    canSend: () => state.sessionOnline && !state.sessionEnded,
    authenticate: async (permission) => {
      if (!(await session.ensureAuth()) || !session.hasPerm(permission)) return null;
      if (!navigator.onLine && !session.hasOfflineGrant()) return null;
      if (permission === "staff.sync" && !state.sessionOnline) return null;
      return session.currentScope();
    },
    onChange: refreshQueue,
    withLock: (scope, fn) =>
      navigator.locks?.request
        ? navigator.locks.request(`pf-awards:${scope.businessId}:${scope.staffId}`, fn)
        : fn(),
  });

  async function refreshQueue() {
    const scope = session.currentScope();
    const q = await listStoredAwards(scope || {});
    const stats = await getAwardQueueStats(scope || undefined);
    element("#queueBadge").textContent = `Cola: ${stats.total}`;
    element("#queueMeta").textContent =
      `Pendientes: ${stats.queued} • Fallidos: ${stats.failed} • Última actividad: ${stats.lastQueuedAt ? new Date(stats.lastQueuedAt).toLocaleTimeString() : "—"}${stats.quarantined ? ` • ${stats.quarantined} operaciones antiguas sin identidad: requieren revisión; no se enviarán.` : ""}${session.hasOfflineGrant() ? " • Captura sin conexión disponible por 24 h desde la validación." : " • Conéctate para habilitar la captura sin conexión."}`;
    element("#queueList").textContent = q.length
      ? q
          .slice(-5)
          .reverse()
          .map((award) => {
            const base = `${new Date(award.updated_at || award.created_at || Date.now()).toLocaleTimeString()} • ${award.status || "queued"} • tx ${award.txId}`;
            return award.last_error ? `${base} • ${award.last_error}` : base;
          })
          .join("\n")
      : "(sin operaciones pendientes)";
  }

  /** Re-adopts awards left mid-sync by a previous page and paints the queue. */
  async function prepareQueue() {
    await requeueSyncingAwards(session.currentScope());
    await refreshQueue();
  }

  async function award(token, scope) {
    const selectionAtRequest = state.customerSelectionRevision;
    const scopeAtRequest = JSON.stringify([scope, state.staff?.branch_id ?? null]);
    const selectionIsCurrent = () =>
      !state.sessionEnded &&
      selectionAtRequest === state.customerSelectionRevision &&
      token === state.lastCustomerToken &&
      scopeAtRequest === surface.selectionContext();
    const payload = {
      customerQrToken: token,
      amount_q: Number(input("#amount").value || 0),
      visits: Number(input("#visits").value || 1),
      items: Number(input("#items").value || 1),
      txId: uuidv4(),
      meta: { ui: "staff" },
      client_ts: new Date().toISOString(),
      ...(session.hasOfflineGrant() ? { offlineGrant: state.offlineGrant.grant } : {}),
    };
    if (
      !Number.isFinite(payload.amount_q) ||
      payload.amount_q < 0 ||
      payload.amount_q > 1000000 ||
      Math.abs(payload.amount_q * 100 - Math.round(payload.amount_q * 100)) > 0.00001 ||
      !Number.isSafeInteger(payload.visits) ||
      payload.visits < 1 ||
      payload.visits > 1000 ||
      !Number.isSafeInteger(payload.items) ||
      payload.items < 1 ||
      payload.items > 10000
    ) {
      const message = `Revisa el monto (0 a 1,000,000 ${state.programRule?.region?.currency || "GTQ"}) y las cantidades enteras de visitas y artículos.`;
      surface.updateCustomerSurfaceState(message);
      toast(message);
      return false;
    }
    navigator.storage?.persist?.().catch(() => {});

    return run(
      async () => {
        const sent = await queue.submit(payload, scope);
        if (sent.queued) {
          if (selectionIsCurrent())
            surface.updateCustomerSurfaceState(
              "Guardado sin conexión. Pendiente de verificar y sumar puntos al sincronizar.",
            );
          toast("Venta guardada en este dispositivo; los puntos aún no se han confirmado.");
          return true;
        }
        const out = /** @type {StaffAwardResponse} */ (sent.response);
        if (!selectionIsCurrent()) {
          toast("Venta anterior confirmada. Se conserva el cliente seleccionado actualmente.");
          return true;
        }
        state.unverifiedSelection = false;
        element("#lastCustomer").textContent = out.customerId;
        const selectionStatus = element("#selectionStatus");
        if (selectionStatus) {
          selectionStatus.textContent = `Cliente seleccionado: ${out.customerId}. Ahora puedes registrar o canjear.`;
        }
        state.lastCustomerMovement =
          out.status === "PENDING"
            ? `Puntos pendientes: +${out.pointsAwarded}`
            : `Puntos: +${out.pointsAwarded}`;
        element("#lastPoints").textContent = state.lastCustomerMovement;
        element("#lastBalance").textContent = String(out.newBalance);
        state.lastCustomerId = out.customerId;
        state.lastCustomerToken = token;
        state.lastCustomerPoints = Number(out.newBalance || 0);
        surface.renderRewardOptions();
        surface.updateCustomerSurfaceState(
          out.status === "PENDING"
            ? `Puntos pendientes: +${out.pointsAwarded} (se liberan después).`
            : `Puntos registrados: +${out.pointsAwarded}. Nuevo saldo: ${out.newBalance}.`,
        );
        if (out.status === "PENDING") {
          toast("Puntos pendientes: +" + out.pointsAwarded + " (se liberan después).");
        } else {
          toast("Listo: +" + out.pointsAwarded + " puntos");
        }
        return true;
      },
      async (error) => {
        if (error.code === "OFFLINE_STORAGE_ERROR") {
          state.storageFailed = true;
          surface.updateCustomerSurfaceState(error.message);
          toast(error.message);
          return false;
        }
        if (isNetworkFailure(error)) {
          if (selectionIsCurrent())
            surface.updateCustomerSurfaceState(
              "Guardado y pendiente de confirmación. Se reintentará automáticamente; no registres esta venta otra vez.",
            );
          toast("Venta pendiente de confirmación. No la registres otra vez.");
          return true;
        }
        surface.updateCustomerSurfaceState();
        toast(error.message);
        return false;
      },
    );
  }

  async function requestSync(manual = false) {
    if (state.sessionEnded) return;
    await run(
      async () => {
        const result = await queue.sync();
        await refreshQueue();
        if (manual)
          toast(
            result.attempted
              ? `Sincronizados: ${result.synced}/${result.attempted}`
              : navigator.onLine
                ? "Nada que sincronizar para esta cuenta."
                : "La sincronización requiere conexión.",
          );
      },
      (error) => {
        if (error.code === "OFFLINE_STORAGE_ERROR") state.storageFailed = true;
        if (manual || state.storageFailed) toast(error.message);
        surface.updateCustomerSurfaceState(
          state.storageFailed
            ? error.message
            : "Las ventas siguen guardadas. Se reintentará la sincronización.",
        );
      },
    );
  }

  function syncOrFinishLogout() {
    if (session.hasPendingLogout()) session.completePendingLogout();
    else requestSync();
  }

  function bind() {
    element("#btnAward").addEventListener("click", async () => {
      if (state.awardInFlight || state.storageFailed) return;
      if ((!state.lastCustomerId && !state.unverifiedSelection) || !state.lastCustomerToken)
        return toast("Primero selecciona un cliente.");
      state.awardInFlight = true;
      await run(async () => {
        surface.updateCustomerSurfaceState("Registrando puntos...");
        await award(state.lastCustomerToken, session.currentScope());
      }).finally(() => {
        state.awardInFlight = false;
        const button = /** @type {HTMLButtonElement} */ (element("#btnAward"));
        button.disabled =
          state.storageFailed ||
          !session.hasPerm("staff.award") ||
          (!state.lastCustomerId && !state.unverifiedSelection) ||
          (!navigator.onLine && !session.hasOfflineGrant());
      });
    });
    element("#btnSync").addEventListener("click", () => requestSync(true));

    window.addEventListener("online", () => {
      if (session.hasPendingLogout()) {
        session.completePendingLogout();
        return;
      }
      surface.applyUiPermissions();
      requestSync();
    });
    window.addEventListener("offline", () => {
      state.sessionOnline = false;
      surface.applyUiPermissions();
      refreshQueue().catch(() => {});
    });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && navigator.onLine) syncOrFinishLogout();
    });
    const syncTimer = setInterval(() => {
      if (!document.hidden && navigator.onLine) syncOrFinishLogout();
    }, 30000);
    window.addEventListener("pagehide", () => clearInterval(syncTimer));
  }

  return { bind, prepareQueue, requestSync };
}
