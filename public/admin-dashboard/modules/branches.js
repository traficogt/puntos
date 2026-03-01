export function registerBranchesModule(app) {
  const { api, $, toast } = app;

  function renderBranchFilterOptions() {
    const current = app.selectedBranchId();
    const sel = $("#branchFilter");
    if (!sel) return;
    sel.replaceChildren();
    const all = document.createElement("option");
    all.value = "";
    all.textContent = "Todas las sucursales";
    sel.appendChild(all);
    app.state.branchCache.forEach((b) => {
      const opt = document.createElement("option");
      opt.value = b.id;
      opt.textContent = `${b.name}${b.code ? ` (${b.code})` : ""}`;
      sel.appendChild(opt);
    });
    if (current && app.state.branchCache.some((b) => b.id === current)) {
      sel.value = current;
    }
  }

  async function loadBranches() {
    try {
      const out = await api("/api/admin/branches");
      app.setBranches(out.branches || []);
      renderBranchFilterOptions();

      const container = $("#branchesList");
      if (!container) return;
      if (!app.state.branchCache.length) {
        container.textContent = "No hay sucursales creadas.";
        return;
      }

      container.replaceChildren();
      app.state.branchCache.forEach((b) => {
        const line = document.createElement("div");
        const addr = b.address ? ` • ${b.address}` : "";
        const code = b.code ? ` (${b.code})` : "";
        line.textContent = `• ${b.name}${code}${addr}`;
        container.appendChild(line);
      });
    } catch (e) {
      toast("Error cargando sucursales: " + e.message);
    }
  }

  async function createBranch() {
    try {
      const payload = {
        name: $("#branchName").value.trim(),
        address: $("#branchAddress").value.trim() || undefined,
        code: $("#branchCode").value.trim() || undefined
      };
      await api("/api/admin/branches", { method: "POST", body: JSON.stringify(payload) });
      $("#branchName").value = "";
      $("#branchAddress").value = "";
      $("#branchCode").value = "";
      toast("Sucursal creada.");
      await loadBranches();
    } catch (e) {
      toast("Error creando sucursal: " + e.message);
    }
  }

  app.onAfterPlanReady(async () => {
    renderBranchFilterOptions();
    $("#btnCreateBranch")?.addEventListener("click", createBranch);

    if (app.hasFeature("multi_branch")) {
      await loadBranches();
    } else {
      app.setBranches([]);
      renderBranchFilterOptions();
    }
  });

  app.registerTab("branches", {
    feature: "multi_branch",
    allowManager: false,
    load: loadBranches
  });
}

