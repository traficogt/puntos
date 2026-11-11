import { regionalMoney } from "/lib.js";
export function registerGiftCardsModule(app) {
  const { api, $, toast } = app;
  let createInFlight = false;

  function renderLedger(details) {
    const box = $("#giftCardLedger");
    const badge = $("#giftCardLedgerBadge");
    if (!box || !badge) return;
    if (!details?.card || !details?.ledger) {
      badge.textContent = "Selecciona una gift card";
      box.textContent = "Aquí verás el saldo guardado, el saldo esperado por movimientos y el historial reciente.";
      return;
    }

    const { card, ledger, transactions = [] } = details;
    badge.textContent = ledger.mismatch ? "Revisar saldo" : "Saldo consistente";

    const lines = [
      `Código: ${card.code}`,
      `Saldo guardado: ${regionalMoney(ledger.stored_balance_q || 0)}`,
      `Saldo esperado: ${regionalMoney(ledger.expected_balance_q || 0)}`,
      `Emitido: ${regionalMoney(ledger.issue_total_q || 0)} | Redimido: ${regionalMoney(ledger.redeem_total_q || 0)}`,
      `Delta: ${regionalMoney(ledger.delta_q || 0)}${ledger.mismatch ? "  <- revisar" : ""}`,
      "",
      "Movimientos recientes:"
    ];

    transactions.slice(0, 10).forEach((tx) => {
      lines.push(`${new Date(tx.created_at).toLocaleString()} • ${tx.tx_type} • ${regionalMoney(tx.amount_q || 0)} • saldo ${regionalMoney(tx.balance_after_q || 0)}`);
    });

    box.textContent = lines.join("\n");
  }

  async function inspectGiftCard(codeOrToken) {
    try {
      const out = await api(`/api/admin/gift-cards/${encodeURIComponent(codeOrToken)}/ledger`);
      renderLedger(out);
    } catch (e) {
      toast("No se pudo cargar ledger de gift card: " + e.message);
    }
  }

  async function loadGiftCards() {
    try {
      const out = await api("/api/admin/gift-cards?limit=100");
      const rows = out.gift_cards || [];
      const box = $("#giftCardList");
      box.replaceChildren();
      if (!rows.length) {
        app.setSmallMessage(box, "No hay gift cards creadas.");
        return;
      }
      rows.forEach((g) => {
        const line = document.createElement("div");
        line.className = "row justify-between align-center gap-8";
        const status = g.status || "ACTIVE";
        const text = document.createElement("div");
        text.textContent = `${new Date(g.created_at).toLocaleString()} • ${g.code} • saldo ${regionalMoney(g.balance_q || 0)} / inicial ${regionalMoney(g.initial_amount_q || 0)} • ${status}`;
        const button = document.createElement("button");
        button.textContent = "Ver ledger";
        button.addEventListener("click", () => inspectGiftCard(g.code).catch(() => {}));
        line.append(text, button);
        box.appendChild(line);
      });
      renderLedger(null);
    } catch (e) {
      toast("No se pudo cargar gift cards: " + e.message);
    }
  }

  async function createGiftCard() {
    if (createInFlight) return;
    createInFlight = true;
    try {
      const payload = {
        amount_q: Number($("#gcAmount").value || 0),
        issued_to_name: $("#gcName").value.trim() || undefined,
        issued_to_phone: $("#gcPhone").value.trim() || undefined,
        requestId: globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : String(Date.now())
      };
      const out = await api("/api/admin/gift-cards", { method: "POST", body: JSON.stringify(payload) });
      const g = out.gift_card;
      $("#gcLastCreated").textContent =
        `Código: ${g.code}\nToken QR: ${g.qr_token}\nSaldo inicial: ${regionalMoney(g.initial_amount_q)}\nSaldo actual: ${regionalMoney(g.balance_q)}`;
      toast("Gift card creada.");
      await loadGiftCards();
      await inspectGiftCard(g.code);
    } catch (e) {
      toast("No se pudo crear gift card: " + e.message);
    } finally {
      createInFlight = false;
    }
  }

  app.onAfterPlanReady(() => {
    $("#btnCreateGiftCard")?.addEventListener("click", () => createGiftCard().catch(() => {}));
    $("#btnRefreshGiftCards")?.addEventListener("click", () => loadGiftCards().catch(() => {}));
  });

  app.registerTab("giftcards", {
    feature: "gift_cards",
    allowManager: true,
    load: loadGiftCards
  });
}
