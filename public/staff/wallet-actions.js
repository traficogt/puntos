/** @typedef {import("./types.js").StaffGiftRedeemResponse} StaffGiftRedeemResponse */
/** @typedef {import("./types.js").StaffPageContext} StaffPageContext */

/**
 * Money-wallet actions: gift-card redemption by code, spending cashback balance
 * and reloading a gift card. All of them require a validated online session.
 * @param {StaffPageContext} ctx
 * @param {{ session: ReturnType<typeof import("./session.js").createStaffSession>, walletPanel: ReturnType<typeof import("./wallet-panel.js").createWalletPanel> }} deps
 */
export function bindWalletActions(ctx, { session, walletPanel }) {
  const { api, toast, state, run, uuidv4, element, input } = ctx;
  let giftRedeemInFlight = false;

  element("#btnGiftRedeem").addEventListener("click", async () => {
    if (!navigator.onLine || !state.sessionOnline)
      return toast("El uso de gift cards requiere conexión.");
    if (giftRedeemInFlight) return;
    giftRedeemInFlight = true;
    await run(
      async () => {
        if (!(await session.ensureAuth()) || !state.sessionOnline || !session.canUseGiftCards())
          return;
        const code_or_token = input("#giftCode").value.trim();
        const amount_q = Number(input("#giftAmount").value || 0);
        if (!code_or_token) return toast("Escribe el código/token de gift card.");
        if (!(amount_q > 0)) return toast("Monto inválido.");
        const out = /** @type {StaffGiftRedeemResponse} */ (
          await api("/api/staff/gift-cards/redeem", {
            method: "POST",
            body: JSON.stringify({ code_or_token, amount_q, requestId: uuidv4() }),
          })
        );
        const g = out.gift_card;
        const region = state.programRule?.region;
        element("#giftStatus").textContent =
          `OK. Saldo restante: ${new Intl.NumberFormat(region?.locale, { style: "currency", currency: region?.currency || "GTQ" }).format(Number(g.balance_q || 0))} (${g.status || "ACTIVE"})`;
        toast("Gift card canjeada.");
      },
      (error) => {
        toast(error.message);
      },
    ).finally(() => {
      giftRedeemInFlight = false;
    });
  });

  element("#btnCashbackSpend")?.addEventListener("click", async () => {
    if (!navigator.onLine || !state.sessionOnline)
      return toast("Usar el saldo de cashback requiere conexión.");
    await run(
      async () => {
        if (!(await session.ensureAuth()) || !state.sessionOnline) return;
        if (!state.lastCustomerToken) return toast("Selecciona al cliente primero.");
        const amount_q = Number(input("#cashbackAmount").value || 0);
        if (!(amount_q > 0)) return toast("Ingresa un monto a usar.");
        const out = await api("/api/staff/cashback/spend", {
          method: "POST",
          body: JSON.stringify({
            customerQrToken: state.lastCustomerToken,
            amount_q,
            requestId: uuidv4(),
          }),
        });
        state.lastCashbackBalance = Number(out.balance_after_q) || 0;
        element("#cashbackStatus").textContent =
          `Aplicado Q${Number(out.spent_q).toFixed(2)}. Nuevo saldo: Q${state.lastCashbackBalance.toFixed(2)}.`;
        walletPanel.showBalance();
        input("#cashbackAmount").value = "0";
        toast("Saldo de cashback aplicado.");
      },
      (error) => {
        toast(error.message);
      },
    );
  });

  element("#btnGiftCardLoad")?.addEventListener("click", async () => {
    if (!navigator.onLine || !state.sessionOnline)
      return toast("Recargar la tarjeta requiere conexión.");
    await run(
      async () => {
        if (!(await session.ensureAuth()) || !state.sessionOnline) return;
        if (!state.lastCustomerToken) return toast("Selecciona al cliente primero.");
        const amount_q = Number(input("#giftCardLoadAmount").value || 0);
        if (!(amount_q > 0)) return toast("Ingresa un monto a recargar.");
        const out = await api("/api/staff/giftcard/load", {
          method: "POST",
          body: JSON.stringify({
            customerQrToken: state.lastCustomerToken,
            amount_q,
            requestId: uuidv4(),
          }),
        });
        state.lastCashbackBalance = Number(out.balance_after_q) || 0;
        const bonusTxt =
          Number(out.bonus_q) > 0 ? ` (incluye Q${Number(out.bonus_q).toFixed(2)} de bono)` : "";
        element("#giftCardLoadStatus").textContent =
          `Recargado Q${Number(out.loaded_q).toFixed(2)}${bonusTxt}. Nuevo saldo: Q${state.lastCashbackBalance.toFixed(2)}.`;
        walletPanel.showBalance();
        input("#giftCardLoadAmount").value = "0";
        toast("Saldo recargado.");
      },
      (error) => {
        toast(error.message);
      },
    );
  });
}
