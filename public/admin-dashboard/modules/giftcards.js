export function registerGiftCardsModule(app) {
  const { api, $, toast } = app;

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
        const status = g.status || "ACTIVE";
        line.textContent = `${new Date(g.created_at).toLocaleString()} • ${g.code} • saldo Q${Number(g.balance_q || 0).toFixed(2)} / inicial Q${Number(g.initial_amount_q || 0).toFixed(2)} • ${status}`;
        box.appendChild(line);
      });
    } catch (e) {
      toast("No se pudo cargar gift cards: " + e.message);
    }
  }

  async function createGiftCard() {
    try {
      const payload = {
        amount_q: Number($("#gcAmount").value || 0),
        issued_to_name: $("#gcName").value.trim() || undefined,
        issued_to_phone: $("#gcPhone").value.trim() || undefined
      };
      const out = await api("/api/admin/gift-cards", { method: "POST", body: JSON.stringify(payload) });
      const g = out.gift_card;
      $("#gcLastCreated").textContent =
        `Código: ${g.code}\nToken QR: ${g.qr_token}\nSaldo inicial: Q${Number(g.initial_amount_q).toFixed(2)}\nSaldo actual: Q${Number(g.balance_q).toFixed(2)}`;
      toast("Gift card creada.");
      await loadGiftCards();
    } catch (e) {
      toast("No se pudo crear gift card: " + e.message);
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

