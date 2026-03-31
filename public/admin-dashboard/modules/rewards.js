export function registerRewardsModule(app) {
  const { api, $, toast, prompt } = app;

  function renderRewardLedger(details) {
    const box = $("#rewardLedger");
    const badge = $("#rewardLedgerBadge");
    if (!box || !badge) return;
    if (!details?.redemption || !details?.ledger) {
      badge.textContent = "Selecciona una recompensa";
      box.textContent = "Aquí verás el detalle de un canje y si el movimiento de puntos asociado es consistente.";
      return;
    }

    const { redemption, ledger, transactions = [] } = details;
    badge.textContent = ledger.consistent ? "Canje consistente" : "Revisar canje";
    const lines = [
      `Canje: ${redemption.code} • ${new Date(redemption.created_at).toLocaleString()}`,
      `Cliente: ${redemption.customer_name || "—"} • ${redemption.customer_phone || "—"}`,
      `Recompensa: ${redemption.reward_name}`,
      `Costo esperado: ${Number(redemption.points_cost || 0)} pts`,
      `Movimiento vinculado: ${Number(ledger.linked_points_total || 0)} pts`,
      `Delta: ${Number(ledger.delta_points || 0)} pts${ledger.consistent ? "" : "  <- revisar"}`,
      ""
    ];

    if (!transactions.length) {
      lines.push("No hay transacciones vinculadas.");
    } else {
      lines.push("Transacciones vinculadas:");
      transactions.forEach((tx) => {
        lines.push(`${new Date(tx.created_at).toLocaleString()} • ${tx.source} • ${Number(tx.points || 0)} pts • ${tx.status}`);
      });
    }

    box.textContent = lines.join("\n");
  }

  async function inspectRewardRedemption(redemptionId) {
    try {
      const out = await api(`/api/admin/analytics/redemptions/${encodeURIComponent(redemptionId)}`);
      renderRewardLedger(out);
    } catch (e) {
      toast("No se pudo cargar ledger del canje: " + e.message);
    }
  }

  function toApiDateTime(value) {
    if (!value) return undefined;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }

  function renderRewardBranchOptions() {
    const sel = $("#rewardBranchIds");
    if (!sel) return;
    sel.replaceChildren();
    if (!app.state.branchCache.length) {
      sel.disabled = true;
      return;
    }
    sel.disabled = false;
    app.state.branchCache.forEach((b) => {
      const opt = document.createElement("option");
      opt.value = b.id;
      opt.textContent = `${b.name}${b.code ? ` (${b.code})` : ""}`;
      sel.appendChild(opt);
    });
  }

  async function loadRewards() {
    try {
      const out = await api("/api/admin/rewards");
      const rows = out.rewards || [];
      const box = $("#rewardsList");
      box.replaceChildren();

      const limit = Number(app.state.planInfo?.limits?.rewards ?? 0);
      const used = rows.length;
      $("#rewardLimitsInfo").textContent = limit > 0
        ? `${used} / ${limit} recompensas usadas en tu plan.`
        : `${used} recompensas configuradas.`;

      if (!rows.length) {
        app.setSmallMessage(box, "No hay recompensas configuradas.");
        return;
      }

      const sorted = [...rows].sort((a, b) => Number(a.points_cost) - Number(b.points_cost));
      sorted.forEach((r) => {
        const card = document.createElement("div");
        card.className = "card compact-card";

        const title = document.createElement("strong");
        title.textContent = r.name;
        const meta = document.createElement("div");
        meta.className = "small";
        const stockText = r.stock === null || r.stock === undefined ? "Stock: ilimitado" : `Stock: ${r.stock}`;
        const expText = r.valid_until ? `Vence: ${new Date(r.valid_until).toLocaleString()}` : "Sin vencimiento";
        const scopeLabels = Array.isArray(r.branch_labels) ? r.branch_labels : [];
        const scopeText = scopeLabels.length ? `Sucursales: ${scopeLabels.join(", ")}` : "Todas las sucursales";
        meta.textContent = `${r.active ? "✅ Activa" : "❌ Inactiva"} • ${r.points_cost} pts • ${stockText} • ${expText} • ${scopeText}`;
        card.append(title, meta);

        if (r.description) {
          const desc = document.createElement("div");
          desc.className = "small mt-6";
          desc.textContent = r.description;
          card.appendChild(desc);
        }

        const row = document.createElement("div");
        row.className = "row mt-8";

        const toggleBtn = document.createElement("button");
        toggleBtn.textContent = r.active ? "Desactivar" : "Activar";
        toggleBtn.addEventListener("click", async () => {
          try {
            await api(`/api/admin/rewards/${encodeURIComponent(r.id)}`, {
              method: "PATCH",
              body: JSON.stringify({ active: !r.active })
            });
            toast("Recompensa actualizada.");
            await loadRewards();
          } catch (e) {
            toast("No se pudo actualizar: " + e.message);
          }
        });

        const editCostBtn = document.createElement("button");
        editCostBtn.className = "secondary";
        editCostBtn.textContent = "Cambiar costo";
        editCostBtn.addEventListener("click", async () => {
          const raw = await prompt(`Nuevo costo en puntos para "${r.name}":`, {
            title: "Cambiar costo",
            inputType: "number",
            value: String(r.points_cost),
            placeholder: "Ej: 150"
          });
          const trimmed = raw ? String(raw).trim() : "";
          if (!trimmed) return;
          const value = Math.floor(Number(trimmed));
          if (!Number.isFinite(value) || value <= 0) {
            toast("Costo inválido.");
            return;
          }
          try {
            await api(`/api/admin/rewards/${encodeURIComponent(r.id)}`, {
              method: "PATCH",
              body: JSON.stringify({ points_cost: value })
            });
            toast("Costo actualizado.");
            await loadRewards();
          } catch (e) {
            toast("No se pudo actualizar costo: " + e.message);
          }
        });

        const inspectBtn = document.createElement("button");
        inspectBtn.className = "secondary";
        inspectBtn.textContent = "Ver canje";
        inspectBtn.addEventListener("click", async () => {
          try {
            const detail = await api(`/api/admin/analytics/rewards/${encodeURIComponent(r.id)}/redemptions`);
            const redemption = (detail.recent_redemptions || [])[0];
            if (!redemption?.id) {
              toast("No hay canjes recientes para esta recompensa.");
              renderRewardLedger(null);
              return;
            }
            await inspectRewardRedemption(redemption.id);
          } catch (e) {
            toast("No se pudo buscar canjes recientes: " + e.message);
          }
        });

        row.append(toggleBtn, editCostBtn, inspectBtn);
        card.appendChild(row);
        box.appendChild(card);
      });
      renderRewardLedger(null);
    } catch (e) {
      toast("Error cargando recompensas: " + e.message);
    }
  }

  async function createReward() {
    try {
      const stockRaw = $("#rewardStock").value.trim();
      const nameRaw = $("#rewardName").value.trim();
      const pointsCost = Math.floor(Number($("#rewardPointsCost").value || 0));
      if (!nameRaw) {
        toast("El nombre de la recompensa es obligatorio.");
        $("#rewardName").focus();
        return;
      }
      if (!Number.isFinite(pointsCost) || pointsCost <= 0) {
        toast("El costo en puntos debe ser mayor a 0.");
        $("#rewardPointsCost").focus();
        return;
      }
      const payload = {
        name: nameRaw,
        description: $("#rewardDescription").value.trim() || undefined,
        points_cost: pointsCost,
        stock: stockRaw ? Math.floor(Number(stockRaw)) : undefined,
        valid_until: toApiDateTime($("#rewardValidUntil").value)
      };
      const branchSel = $("#rewardBranchIds");
      if (branchSel && !branchSel.disabled) {
        payload.branch_ids = [...branchSel.selectedOptions].map((o) => o.value);
      }
      await api("/api/admin/rewards", { method: "POST", body: JSON.stringify(payload) });
      $("#rewardName").value = "";
      $("#rewardDescription").value = "";
      $("#rewardPointsCost").value = "100";
      $("#rewardStock").value = "";
      $("#rewardValidUntil").value = "";
      if (branchSel) {
        [...branchSel.options].forEach((o) => { o.selected = false; });
      }
      toast("Recompensa creada.");
      await loadRewards();
    } catch (e) {
      toast("No se pudo crear recompensa: " + e.message);
    }
  }

  app.onBranchesUpdated(() => renderRewardBranchOptions());

  app.onAfterPlanReady(() => {
    renderRewardBranchOptions();
    $("#btnCreateReward")?.addEventListener("click", createReward);
    $("#btnRefreshRewards")?.addEventListener("click", loadRewards);
  });

  app.registerTab("rewards", {
    feature: "rewards",
    allowManager: false,
    load: loadRewards
  });
}
