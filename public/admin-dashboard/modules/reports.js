import { regionalMoney } from "/lib.js";

/**
 * Reportes - basic participation reporting, available on every plan via the
 * `basic_reporting` feature. Reads /api/admin/analytics/overview (owner-only,
 * basic_reporting-gated) and shows a compact KPI view. The deep analytics suite
 * stays on the paid "Analitica" tab.
 * @param {import("../types.js").AdminDashboardApp} app
 */
export function registerReportsModule(app) {
  const { api, $ } = app;
  let days = 30;

  const intFmt = (n) =>
    new Intl.NumberFormat("es-GT", { maximumFractionDigits: 0 }).format(Number(n) || 0);

  function tile(value, label) {
    const t = document.createElement("div");
    t.className = "metric-tile";
    const v = document.createElement("div");
    v.className = "metric-value";
    v.textContent = String(value);
    const l = document.createElement("div");
    l.className = "metric-label";
    l.textContent = label;
    t.append(v, l);
    return t;
  }

  function render(out) {
    const box = $("#reportesKpis");
    if (box) {
      const cur = (out && out.current) || {};
      box.replaceChildren();
      const grid = document.createElement("div");
      grid.className = "analytics-kpi-grid";
      const repeatRate =
        cur.repeat_rate_pct == null ? "-" : `${Number(cur.repeat_rate_pct).toFixed(0)}%`;
      [
        tile(intFmt(cur.active_customers), "Clientes activos"),
        tile(intFmt(cur.repeat_customers), "Clientes que volvieron"),
        tile(repeatRate, "Tasa de regreso"),
        tile(intFmt(cur.purchases), "Compras registradas"),
        tile(regionalMoney(cur.recorded_sales_q || 0), "Ventas registradas"),
        tile(regionalMoney(cur.average_ticket_q || 0), "Ticket promedio"),
        tile(intFmt(cur.redemptions), "Premios usados"),
      ].forEach((el) => grid.appendChild(el));
      box.appendChild(grid);
    }

    const topBox = $("#reportesTopRewards");
    if (topBox) {
      const rewards = Array.isArray(out && out.rewards) ? out.rewards : [];
      topBox.replaceChildren();
      if (!rewards.length) {
        topBox.textContent = "Aun no hay premios canjeados en el periodo.";
      } else {
        const title = document.createElement("strong");
        title.textContent = "Premios mas usados";
        topBox.appendChild(title);
        rewards.slice(0, 5).forEach((r) => {
          const line = document.createElement("div");
          line.className = "small";
          line.textContent = `${r.name || "Premio"} - ${intFmt(r.redemptions)} usos - ${intFmt(r.points_redeemed)} pts`;
          topBox.appendChild(line);
        });
      }
    }
  }

  // Soft-cap headroom. The active-customer cap never blocks a sale at the counter; this is the
  // calm, out-of-band place where the owner sees how much room is left and can plan an upgrade.
  function renderPlanUsage() {
    const box = $("#reportesPlanUsage");
    if (!box) return;
    const info = app.state.planInfo || { plan: "", limits: {}, features: {} };
    const limit = Number(info.limits && info.limits.activeCustomers);
    const used = info.usage ? info.usage.active_customers : null;
    box.replaceChildren();
    if (used == null || !Number.isFinite(limit) || limit <= 0) {
      box.textContent = "Capacidad del plan no disponible por el momento.";
      return;
    }
    const unlimited = limit >= 999999;
    const pct = unlimited ? 0 : Math.round((Number(used) / limit) * 100);
    const title = document.createElement("strong");
    title.textContent = unlimited
      ? `${intFmt(used)} clientes activos (sin limite en tu plan)`
      : `${intFmt(used)} de ${intFmt(limit)} clientes activos (${pct}%)`;
    const bar = document.createElement("progress");
    bar.className = "onboarding-progress-bar";
    bar.max = 100;
    bar.value = Math.min(100, Math.max(0, pct));
    const note = document.createElement("div");
    note.className = "small";
    if (unlimited) note.textContent = "Clientes con visita o inscripcion en los ultimos 90 dias.";
    else if (pct > 100)
      note.textContent =
        "Superaste el limite de clientes activos de tu plan. Tu programa sigue funcionando con normalidad y ningun cliente es rechazado en caja; para seguir creciendo con holgura, considera el siguiente plan.";
    else if (pct >= 80)
      note.textContent =
        "Te estas acercando al limite de clientes activos de tu plan. Nada se bloquea en caja; es un buen momento para revisar el siguiente plan.";
    else
      note.textContent =
        "Clientes con visita o inscripcion en los ultimos 90 dias. Tu plan tiene holgura.";
    box.append(title, bar, note);
    if (!unlimited && pct >= 80) {
      const link = document.createElement("a");
      link.href = "/precios";
      link.target = "_blank";
      link.rel = "noopener";
      link.className = "text-link";
      link.textContent = "Ver planes";
      box.appendChild(link);
    }
  }

  async function load() {
    renderPlanUsage();
    const box = $("#reportesKpis");
    if (box) box.textContent = "Cargando reporte...";
    try {
      const bq = typeof app.branchQueryString === "function" ? app.branchQueryString() : "";
      const out = await api(`/api/admin/analytics/overview?days=${days}${bq ? "&" + bq : ""}`);
      render(out);
    } catch (e) {
      if (box)
        box.textContent = "No se pudo cargar el reporte: " + (e && e.message ? e.message : "error");
    }
  }

  app.onAfterPlanReady(() => {
    const sel = /** @type {HTMLSelectElement|null} */ ($("#reportesPeriod"));
    if (sel)
      sel.addEventListener("change", () => {
        days = Number(sel.value) || 30;
        load().catch(() => {});
      });
    $("#btnRefreshReportes")?.addEventListener("click", () => load().catch(() => {}));
  });

  app.onBranchFilterChanged(() => {
    if (!app.hasFeature("basic_reporting")) return;
    load().catch(() => {});
  });

  app.registerTab("reportes", {
    feature: "basic_reporting",
    allowManager: false,
    load,
  });
}
