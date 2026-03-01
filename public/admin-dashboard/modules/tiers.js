export function registerTiersModule(app) {
  const { api, $, toast, confirm } = app;

  let editingTierId = null;

  async function loadTiers() {
    try {
      const data = await api("/api/admin/tiers");
      const container = $("#tiersList");
      container.replaceChildren();

      if (!data.tiers || data.tiers.length === 0) {
        app.setSmallMessage(container, "No hay niveles configurados.");
        return;
      }

      data.tiers.forEach((tier) => {
        const div = document.createElement("div");
        div.className = "card";
        div.style.marginBottom = "12px";

        const color = app.safeColor(tier.color, "#ddd");
        const top = document.createElement("div");
        top.className = "row";
        top.style.alignItems = "center";
        top.style.justifyContent = "space-between";

        const badge = document.createElement("div");
        badge.className = "tier-badge";
        badge.style.background = color;
        badge.style.color = "#000";

        const icon = document.createElement("span");
        icon.style.fontSize = "24px";
        icon.textContent = tier.icon_url || "⭐";
        badge.appendChild(icon);

        const textWrap = document.createElement("div");
        const name = document.createElement("strong");
        name.textContent = tier.name;
        const meta = document.createElement("div");
        meta.className = "small";
        meta.textContent = `Nivel ${tier.tier_level} • ${tier.min_points}+ puntos • ${tier.points_multiplier}x multiplicador`;
        textWrap.append(name, meta);
        badge.appendChild(textWrap);

        const actions = document.createElement("div");
        actions.className = "row";
        actions.style.gap = "8px";

        const count = document.createElement("span");
        count.className = "badge";
        count.textContent = `${tier.customer_count || 0} clientes`;

        const edit = document.createElement("button");
        edit.className = "secondary btn-edit-tier";
        edit.dataset.id = tier.id;
        edit.textContent = "Editar";

        const del = document.createElement("button");
        del.className = "btn-delete-tier";
        del.dataset.id = tier.id;
        del.textContent = "Eliminar";

        actions.append(count, edit, del);
        top.append(badge, actions);
        div.appendChild(top);

        if (Array.isArray(tier.perks) && tier.perks.length > 0) {
          const perks = document.createElement("div");
          perks.className = "small";
          perks.style.marginTop = "8px";
          const strong = document.createElement("strong");
          strong.textContent = "Beneficios: ";
          perks.appendChild(strong);
          perks.appendChild(document.createTextNode(tier.perks.join(", ")));
          div.appendChild(perks);
        }

        container.appendChild(div);
      });

      document.querySelectorAll(".btn-edit-tier").forEach((btn) => {
        btn.addEventListener("click", () => editTier(btn.dataset.id));
      });
      document.querySelectorAll(".btn-delete-tier").forEach((btn) => {
        btn.addEventListener("click", () => deleteTier(btn.dataset.id));
      });
    } catch (e) {
      toast("Error cargando niveles: " + e.message);
    }
  }

  async function editTier(tierId) {
    try {
      const data = await api("/api/admin/tiers");
      const tier = data.tiers.find((t) => t.id === tierId);
      if (!tier) return;

      editingTierId = tierId;
      $("#tierModalTitle").textContent = "Editar Nivel";
      $("#tierName").value = tier.name;
      $("#tierLevel").value = tier.tier_level;
      $("#tierMinPoints").value = tier.min_points;
      $("#tierMultiplier").value = tier.points_multiplier;
      $("#tierColor").value = tier.color || "";
      $("#tierIcon").value = tier.icon_url || "";
      $("#tierPerks").value = tier.perks ? tier.perks.join("\n") : "";
      $("#tierModal").style.display = "block";
    } catch (e) {
      toast("Error: " + e.message);
    }
  }

  async function saveTier() {
    try {
      const tierData = {
        name: $("#tierName").value.trim(),
        tier_level: parseInt($("#tierLevel").value, 10),
        min_points: parseInt($("#tierMinPoints").value, 10),
        points_multiplier: parseFloat($("#tierMultiplier").value),
        color: $("#tierColor").value.trim() || null,
        icon_url: $("#tierIcon").value.trim() || null,
        perks: $("#tierPerks").value.split("\n").map((p) => p.trim()).filter(Boolean)
      };

      if (editingTierId) {
        await api(`/api/admin/tiers/${editingTierId}`, {
          method: "PUT",
          body: JSON.stringify(tierData)
        });
        toast("Nivel actualizado");
      } else {
        await api("/api/admin/tiers", {
          method: "POST",
          body: JSON.stringify(tierData)
        });
        toast("Nivel creado");
      }

      $("#tierModal").style.display = "none";
      await loadTiers();
    } catch (e) {
      toast("Error: " + e.message);
    }
  }

  async function deleteTier(tierId) {
    const ok = await confirm("¿Eliminar este nivel? Solo se puede eliminar si no tiene clientes asignados.", {
      title: "Eliminar nivel"
    });
    if (!ok) return;
    try {
      await api(`/api/admin/tiers/${tierId}`, { method: "DELETE" });
      toast("Nivel eliminado");
      await loadTiers();
    } catch (e) {
      toast("Error: " + e.message);
    }
  }

  function openNewTierModal() {
    editingTierId = null;
    $("#tierModalTitle").textContent = "Nuevo Nivel";
    $("#tierName").value = "";
    $("#tierLevel").value = "4";
    $("#tierMinPoints").value = "5000";
    $("#tierMultiplier").value = "2.0";
    $("#tierColor").value = "";
    $("#tierIcon").value = "";
    $("#tierPerks").value = "";
    $("#tierModal").style.display = "block";
  }

  app.onAfterPlanReady(() => {
    $("#btnAddTier")?.addEventListener("click", openNewTierModal);
    $("#btnSaveTier")?.addEventListener("click", () => saveTier().catch(() => {}));
    $("#btnCancelTier")?.addEventListener("click", () => { $("#tierModal").style.display = "none"; });
  });

  app.registerTab("tiers", {
    feature: "tiers",
    allowManager: false,
    load: loadTiers
  });
}
