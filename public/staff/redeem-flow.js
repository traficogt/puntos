/** @typedef {import("./types.js").StaffPageContext} StaffPageContext */
/** @typedef {import("./types.js").StaffRedeemResponse} StaffRedeemResponse */
/** @typedef {import("./types.js").StaffRewardsResponse} StaffRewardsResponse */

/**
 * Reward catalogue and the online-only redemption action.
 * @param {StaffPageContext} ctx
 * @param {{ session: ReturnType<typeof import("./session.js").createStaffSession>, surface: ReturnType<typeof import("./customer-surface.js").createCustomerSurface> }} deps
 */
export function createRedeemFlow(ctx, { session, surface }) {
  const { api, toast, state, run, uuidv4, element, select } = ctx;
  let redeemInFlight = false;

  async function loadRewards() {
    await run(async () => {
      const out = /** @type {StaffRewardsResponse} */ (await api("/api/staff/rewards"));
      state.rewardOptions = out.rewards || [];
      surface.renderRewardOptions();
      surface.updateCustomerSurfaceState();
    });
  }

  async function redeem() {
    if (!navigator.onLine || !state.sessionOnline)
      return toast("Los canjes requieren conexión. No se pueden guardar sin internet.");
    if (!state.lastCustomerId) return toast("Primero selecciona un cliente.");
    if (redeemInFlight) return;
    const customerAtRequest = state.lastCustomerId;
    const scopeAtRequest = surface.selectionContext();
    const redemptionContextIsCurrent = () =>
      !state.sessionEnded &&
      state.lastCustomerId === customerAtRequest &&
      scopeAtRequest === surface.selectionContext();
    redeemInFlight = true;
    await run(
      async () => {
        if (!(await session.ensureAuth()) || !session.canUseRedeemFlow()) return;
        if (!redemptionContextIsCurrent()) return;
        const rewardId = select("#rewardSelect").value;
        if (!rewardId) return toast("Selecciona una recompensa disponible.");
        surface.updateCustomerSurfaceState("Canjeando recompensa...");
        const out = /** @type {StaffRedeemResponse} */ (
          await api("/api/staff/redeem", {
            method: "POST",
            body: JSON.stringify({
              customerId: state.lastCustomerId,
              rewardId,
              requestId: uuidv4(),
            }),
          })
        );
        if (!redemptionContextIsCurrent()) return;
        element("#redeemCode").textContent = out.redemptionCode;
        element("#lastBalance").textContent = String(out.newBalance);
        state.lastCustomerMovement = `Canje: ${out.redemptionCode}`;
        element("#lastPoints").textContent = state.lastCustomerMovement;
        state.lastCustomerPoints = Number(out.newBalance || 0);
        surface.renderRewardOptions();
        surface.updateCustomerSurfaceState(
          `Canje listo. Código: ${out.redemptionCode}. Nuevo saldo: ${out.newBalance}.`,
        );
        toast("Canje listo. Código: " + out.redemptionCode);
        state.mounts.posRecording?.showRedemption({ ...out, customerId: customerAtRequest });
      },
      (error) => {
        if (!redemptionContextIsCurrent()) return;
        surface.updateCustomerSurfaceState();
        toast(error.message);
        if (error.recoveryCaseId) state.mounts.serviceCases?.showCase(error.recoveryCaseId);
      },
    ).finally(() => {
      redeemInFlight = false;
    });
  }

  function bind() {
    element("#btnRedeem").addEventListener("click", redeem);
  }

  return { bind, loadRewards };
}
