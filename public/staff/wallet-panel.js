/** @typedef {import("./types.js").StaffPageContext} StaffPageContext */
/** @typedef {import("./types.js").StaffLookupCustomerResponse} StaffLookupCustomerResponse */

/**
 * The selected customer's money wallet (cashback balance or gift-card balance)
 * shown beside the points summary.
 * @param {StaffPageContext} ctx
 */
export function createWalletPanel(ctx) {
  const { state, element, input } = ctx;

  function showBalance() {
    element("#cashbackBalance").textContent =
      `Saldo del cliente: Q${state.lastCashbackBalance.toFixed(2)}`;
    const btn = /** @type {HTMLButtonElement|null} */ (element("#btnCashbackSpend"));
    if (btn) btn.disabled = !(state.lastCashbackBalance > 0);
  }

  /** @param {StaffLookupCustomerResponse["wallet"] | null | undefined} wallet */
  function render(wallet) {
    const block = element("#cashbackActionBlock");
    const loadBlock = element("#giftCardLoadBlock");
    if (!wallet) {
      if (block) block.classList.add("hidden");
      if (loadBlock) loadBlock.classList.add("hidden");
      state.lastCashbackBalance = 0;
      const amt = input("#cashbackAmount");
      if (amt) amt.value = "0";
      const st = element("#cashbackStatus");
      if (st) st.textContent = "—";
      const la = input("#giftCardLoadAmount");
      if (la) la.value = "0";
      const ls = element("#giftCardLoadStatus");
      if (ls) ls.textContent = "—";
      return;
    }
    state.lastCashbackBalance = Number(wallet.balance_q) || 0;
    const isGift = wallet.kind === "GIFT_CARD";
    const title = element("#cashbackActionBlockTitle");
    if (title) title.textContent = isGift ? "Saldo de tarjeta" : "Cashback";
    element("#cashbackBalance").textContent = isGift
      ? `Saldo del cliente: Q${state.lastCashbackBalance.toFixed(2)}`
      : `Saldo del cliente: Q${state.lastCashbackBalance.toFixed(2)} (gana ${Number(wallet.percent)}%)`;
    const btn = /** @type {HTMLButtonElement|null} */ (element("#btnCashbackSpend"));
    if (btn) btn.disabled = !(state.lastCashbackBalance > 0);
    if (block) block.classList.remove("hidden");
    if (loadBlock) {
      loadBlock.classList.toggle("hidden", !isGift);
      const hint = element("#giftCardBonusHint");
      if (hint)
        hint.textContent =
          isGift && Number(wallet.bonus_percent) > 0
            ? `Incluye bono de recarga del ${Number(wallet.bonus_percent)}%.`
            : "";
    }
  }

  return { render, showBalance };
}
