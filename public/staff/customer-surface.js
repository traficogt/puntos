import { setHidden } from "/lib.js";
import { SELECTION_PROMPT_COPY } from "./page-context.js";

/** @typedef {import("./types.js").StaffLookupCustomerResponse} StaffLookupCustomerResponse */
/** @typedef {import("./types.js").StaffPageContext} StaffPageContext */
/** @typedef {import("./types.js").StaffSelectedCustomer} StaffSelectedCustomer */

/**
 * The "Cliente activo" surface: which customer is selected, what the cashier may
 * do with them right now, and the reward list sorted by eligibility.
 * @param {StaffPageContext} ctx
 * @param {{ session: ReturnType<typeof import("./session.js").createStaffSession>, rules: ReturnType<typeof import("./program-rules.js").createProgramRules>, walletPanel: ReturnType<typeof import("./wallet-panel.js").createWalletPanel> }} deps
 */
export function createCustomerSurface(ctx, { session, rules, walletPanel }) {
  const { api, toast, state, run, element, select } = ctx;

  function getEligibleRewardCount() {
    return state.rewardOptions.reduce((count, reward) => {
      return count + (state.lastCustomerPoints >= Number(reward.points_cost || 0) ? 1 : 0);
    }, 0);
  }

  function applyUiPermissions() {
    const canAward = session.hasPerm("staff.award");
    const canRedeem = session.canUseRedeemFlow();
    const canSync = session.hasPerm("staff.sync");
    const canGiftCards = session.canUseGiftCards();

    /** @type {HTMLButtonElement} */ (element("#btnStart")).disabled = !canAward;
    /** @type {HTMLButtonElement} */ (element("#btnAward")).disabled = !canAward;
    /** @type {HTMLButtonElement} */ (element("#btnRedeem")).disabled = !canRedeem;
    /** @type {HTMLButtonElement} */ (element("#btnSync")).disabled = !canSync;
    /** @type {HTMLButtonElement} */ (element("#btnGiftRedeem")).disabled =
      !canGiftCards || !navigator.onLine || !state.sessionOnline;
    setHidden(element("#giftCardActionBlock"), !canGiftCards);

    // Analytics quick panel remains owner-only because endpoint is owner-only.
    setHidden(element("#ownerAnalyticsCard"), state.staff?.role !== "OWNER");
    updateCustomerSurfaceState();
  }

  function updateCustomerSurfaceState(statusMessage = "") {
    const hasCustomer = Boolean(state.lastCustomerId || state.unverifiedSelection);
    const canRedeem = session.canUseRedeemFlow();
    const customerState = hasCustomer ? "ready" : "waiting";
    const readyChip = element("#customerReadyChip");
    const customerSummary = element("#staffCustomerSummary");
    const actionRail = element("#staffActionRail");
    const customerActionStatus = element("#customerActionStatus");
    const customerRewardState = element("#customerRewardState");
    const rewardHint = element("#rewardSelectionHint");
    const selectionStatus = element("#selectionStatus");
    const awardButton = /** @type {HTMLButtonElement} */ (element("#btnAward"));
    const redeemButton = /** @type {HTMLButtonElement} */ (element("#btnRedeem"));
    const rewardSelectEl = select("#rewardSelect");
    const eligibleRewardCount = getEligibleRewardCount();
    const hasRedeemableReward = canRedeem && hasCustomer && eligibleRewardCount > 0;

    if (readyChip) readyChip.textContent = hasCustomer ? "Cliente listo" : "Esperando cliente";
    if (customerSummary) customerSummary.dataset.customerState = customerState;
    if (actionRail) {
      actionRail.dataset.customerState = customerState;
      actionRail.classList.toggle("is-customer-ready", hasCustomer);
      actionRail.classList.toggle("is-customer-waiting", !hasCustomer);
    }

    if (selectionStatus) {
      selectionStatus.textContent = hasCustomer
        ? `Cliente seleccionado: ${state.lastCustomerId}. ${
            canRedeem
              ? eligibleRewardCount > 0
                ? "Ahora puedes registrar o canjear."
                : "Ahora puedes registrar puntos; no hay recompensas canjeables ahora."
              : "Ahora puedes registrar puntos."
          }`
        : SELECTION_PROMPT_COPY;
    }

    if (customerActionStatus) {
      customerActionStatus.textContent =
        statusMessage ||
        (hasCustomer
          ? canRedeem
            ? eligibleRewardCount > 0
              ? "Cliente listo. Ahora puedes registrar puntos o canjear una recompensa."
              : "Cliente listo. Ahora puedes registrar puntos; no hay recompensas canjeables ahora."
            : "Cliente listo. Ahora puedes registrar puntos."
          : SELECTION_PROMPT_COPY);
    }

    if (customerRewardState) {
      if (!navigator.onLine || !state.sessionOnline) {
        customerRewardState.textContent = "Los canjes requieren conexión y sesión validada";
      } else if (!hasCustomer) {
        customerRewardState.textContent = "Aún no disponible";
      } else if (!session.hasFeature("redemptions")) {
        customerRewardState.textContent = "Canjes no disponibles en este plan";
      } else if (!session.hasPerm("staff.redeem")) {
        customerRewardState.textContent = "Canje no disponible para tu rol";
      } else if (!state.rewardOptions.length) {
        customerRewardState.textContent = "Sin recompensas activas";
      } else if (eligibleRewardCount === 1) {
        customerRewardState.textContent = "1 recompensa disponible";
      } else {
        customerRewardState.textContent = `${eligibleRewardCount} recompensas disponibles`;
      }
    }

    if (rewardHint) {
      rewardHint.textContent = hasCustomer
        ? !canRedeem
          ? !session.hasFeature("redemptions")
            ? "Los canjes no están disponibles en el plan actual."
            : "Tu rol no permite canjear recompensas."
          : state.rewardOptions.length
            ? "Las recompensas disponibles aparecen primero. Las que faltan puntos quedan deshabilitadas."
            : "No hay recompensas activas para este programa."
        : SELECTION_PROMPT_COPY;
    }

    if (state.unverifiedSelection && customerActionStatus && !statusMessage)
      customerActionStatus.textContent =
        "Código capturado sin conexión. El cliente y sus puntos se verificarán en el servidor al sincronizar.";
    if (awardButton)
      awardButton.disabled =
        state.awardInFlight ||
        state.storageFailed ||
        !session.hasPerm("staff.award") ||
        !hasCustomer ||
        (!navigator.onLine && !session.hasOfflineGrant());
    if (redeemButton) redeemButton.disabled = !hasRedeemableReward;
    rewardSelectEl.disabled = !hasRedeemableReward;
    state.mounts.serviceCases?.contextChanged();
    state.mounts.rewardEntitlements?.contextChanged();
    state.mounts.posRecording?.contextChanged();
  }

  function renderRewardOptions() {
    const sel = select("#rewardSelect");
    const hint = element("#rewardSelectionHint");
    sel.replaceChildren();

    if (!state.rewardOptions.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "No hay recompensas activas";
      sel.appendChild(opt);
      sel.disabled = true;
      if (hint) hint.textContent = "No hay recompensas activas para este programa.";
      return;
    }

    const sortedRewards = [...state.rewardOptions].sort((a, b) => {
      const aEligible = state.lastCustomerPoints >= Number(a.points_cost || 0);
      const bEligible = state.lastCustomerPoints >= Number(b.points_cost || 0);
      if (aEligible !== bEligible) return aEligible ? -1 : 1;
      return Number(a.points_cost || 0) - Number(b.points_cost || 0);
    });

    for (const reward of sortedRewards) {
      const pointsCost = Number(reward.points_cost || 0);
      const eligible = state.lastCustomerPoints >= pointsCost;
      const opt = document.createElement("option");
      opt.value = reward.id;
      opt.disabled = !eligible;
      opt.textContent = eligible
        ? `${reward.name} (${pointsCost} pts)`
        : `${reward.name} (${pointsCost} pts • faltan ${Math.max(0, pointsCost - state.lastCustomerPoints)})`;
      sel.appendChild(opt);
    }

    sel.disabled =
      !session.canUseRedeemFlow() || !state.lastCustomerId || !getEligibleRewardCount();
    if (hint && !state.lastCustomerId) {
      hint.textContent = SELECTION_PROMPT_COPY;
    }
    updateCustomerSurfaceState();
  }

  /**
   * @param {StaffSelectedCustomer | null} customer
   * @param {string} token
   */
  function applySelectedCustomer(customer, token, { silent = true } = {}) {
    state.unverifiedSelection = false;
    state.lastCustomerId = customer?.id || null;
    state.lastCustomerToken = token || "";
    state.lastCustomerPoints = Number(customer?.points || 0);
    element("#lastCustomer").textContent = customer?.id || "—";
    element("#lastCustomerName").textContent = customer?.name || "—";
    element("#lastCustomerPhone").textContent = customer?.phone || "—";
    element("#lastBalance").textContent = customer ? String(Number(customer.points || 0)) : "—";
    state.lastCustomerMovement = "Sin movimientos recientes";
    element("#lastPoints").textContent = state.lastCustomerMovement;
    rules.updateAwardPreview();
    renderRewardOptions();
    updateCustomerSurfaceState();
    if (!silent && state.lastCustomerId) {
      toast("Cliente seleccionado.");
    }
  }

  function clearSelectedCustomer() {
    state.customerSelectionRevision += 1;
    applySelectedCustomer(null, "", { silent: true });
    element("#redeemCode").textContent = "—";
    walletPanel.render(null);
  }

  /** The selection, scope and branch at request time still describe the current screen. */
  function selectionContext() {
    return JSON.stringify([session.currentScope(), state.staff?.branch_id ?? null]);
  }

  async function selectCustomerFromToken(token, { silent = true } = {}) {
    const trimmed = String(token || "").trim();
    if (!trimmed) {
      toast(SELECTION_PROMPT_COPY);
      return false;
    }

    const selectionAtRequest = ++state.customerSelectionRevision;
    const scopeAtRequest = selectionContext();
    const selectionIsCurrent = () =>
      !state.sessionEnded &&
      selectionAtRequest === state.customerSelectionRevision &&
      scopeAtRequest === selectionContext();

    if (!navigator.onLine || !state.sessionOnline) {
      if (!session.hasOfflineGrant()) {
        toast("Conéctate y valida tu sesión antes de capturar ventas sin conexión.");
        return false;
      }
      clearSelectedCustomer();
      state.lastCustomerToken = trimmed;
      state.unverifiedSelection = true;
      element("#lastCustomer").textContent = "Pendiente de verificación";
      updateCustomerSurfaceState();
      return true;
    }

    return run(
      async () => {
        const out = /** @type {StaffLookupCustomerResponse} */ (
          await api("/api/staff/customer/lookup", {
            method: "POST",
            body: JSON.stringify({ customerQrToken: trimmed }),
          })
        );
        if (!selectionIsCurrent()) return false;
        applySelectedCustomer(out.customer, trimmed, { silent });
        walletPanel.render(out.wallet);
        return true;
      },
      (error) => {
        if (!selectionIsCurrent()) return false;
        clearSelectedCustomer();
        updateCustomerSurfaceState();
        toast(error.message);
        return false;
      },
    );
  }

  return {
    applyUiPermissions,
    clearSelectedCustomer,
    renderRewardOptions,
    selectCustomerFromToken,
    selectionContext,
    updateCustomerSurfaceState,
  };
}
