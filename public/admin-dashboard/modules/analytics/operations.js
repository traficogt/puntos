/** @typedef {import("../../types.js").AdminDashboardApp} AdminDashboardApp */
/** @typedef {import("../../types.js").AnalyticsOperationsController} AnalyticsOperationsController */

/**
 * @param {AdminDashboardApp} app
 * @returns {AnalyticsOperationsController}
 */
export function createAnalyticsOperationsController(app) {
  const { api, $, toast } = app;

  /**
   * @template T
   * @param {() => Promise<T>} task
   * @param {(error: Error) => void} onError
   * @returns {Promise<T | null>}
   */
  async function run(task, onError) {
    try {
      return await task();
    } catch (error) {
      onError(error);
      return null;
    }
  }

  /**
   * @param {() => Promise<unknown>} loader
   * @returns {() => void}
   */
  function refresh(loader) {
    return () => {
      loader().catch(() => {});
    };
  }

  /**
   * @param {string} selector
   * @returns {HTMLInputElement}
   */
  function input(selector) {
    return /** @type {HTMLInputElement} */ ($(selector));
  }

  /**
   * @param {string} selector
   * @returns {HTMLElement}
   */
  function element(selector) {
    return /** @type {HTMLElement} */ ($(selector));
  }

  function exportIvaCsv() {
    const from = input("#ivaFrom").value;
    const to = input("#ivaTo").value;
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const q = params.toString();
    window.open(`/api/admin/billing/iva.csv${q ? `?${q}` : ""}`, "_blank");
  }

  async function loadOpsSummary() {
    const box = element("#opsSummary");
    const failedJobsBox = element("#opsFailedJobs");
    await run(async () => {
      const out = await api("/api/admin/ops/summary");
      const summary = out.summary || {};
      box.replaceChildren();
      failedJobsBox.replaceChildren();

      const grid = document.createElement("div");
      grid.className = "analytics-kpi-grid";
      [
        [`${Math.round(Number(summary.health_score || 0))}/100`, "Salud operativa"],
        [Number(summary.failed_jobs || 0), "Jobs fallidos"],
        [Number(summary.pending_jobs || 0), "Jobs pendientes"],
        [Number(summary.failed_webhooks || 0), "Webhooks fallidos"],
        [Number(summary.payment_pending_mapping || 0), "Pagos sin cliente"],
        [Number(summary.suspicious_awards_24h || 0), "Sospechosas (24h)"]
      ].forEach(([value, label]) => {
        const tile = document.createElement("div");
        tile.className = "metric-tile";
        const metricValue = document.createElement("div");
        metricValue.className = "metric-value";
        metricValue.textContent = String(value);
        const metricLabel = document.createElement("div");
        metricLabel.className = "metric-label";
        metricLabel.textContent = String(label);
        tile.append(metricValue, metricLabel);
        grid.appendChild(tile);
      });
      box.appendChild(grid);

      const failedJobs = out.recent_failed_jobs || [];
      if (!failedJobs.length) {
        failedJobsBox.textContent = "No hay jobs fallidos recientes.";
        return;
      }
      const title = document.createElement("strong");
      title.textContent = "Últimos jobs fallidos";
      failedJobsBox.appendChild(title);
      failedJobs.forEach((job) => {
        const line = document.createElement("div");
        const when = job.created_at ? new Date(job.created_at).toLocaleString() : "—";
        line.textContent = `${when} • ${job.job_type || "job"} • ${job.error || "sin detalle"}`;
        failedJobsBox.appendChild(line);
      });
    }, (error) => {
      box.textContent = "Error cargando resumen operativo: " + error.message;
      failedJobsBox.textContent = "";
    });
  }

  async function loadRoiReport() {
    const box = element("#roiReport");
    await run(async () => {
      const out = await api("/api/admin/roi?days=30");
      const roi = out.roi || {};
      box.replaceChildren();
      const grid = document.createElement("div");
      grid.className = "analytics-kpi-grid";
      [
        { label: "Ingresos 30d", value: `Q${Number(roi.revenue_current_q || 0).toFixed(2)}`, delta: roi.revenue_growth_pct },
        { label: "Transacciones 30d", value: String(Number(roi.tx_current || 0)), delta: roi.tx_growth_pct },
        { label: "Tasa repetición", value: `${Number(roi.repeat_rate_pct || 0).toFixed(1)}%` },
        { label: "Tasa canje", value: `${Number(roi.redemption_rate_pct || 0).toFixed(1)}%` }
      ].forEach((card) => {
        const tile = document.createElement("div");
        tile.className = "metric-tile";
        const value = document.createElement("div");
        value.className = "metric-value";
        value.textContent = card.value;
        const label = document.createElement("div");
        label.className = "metric-label";
        label.textContent = card.label;
        tile.append(value, label);
        if (card.delta !== undefined && card.delta !== null) {
          const delta = Number(card.delta || 0);
          const deltaNode = document.createElement("div");
          deltaNode.className = `metric-delta ${delta >= 0 ? "positive" : "negative"}`;
          deltaNode.textContent = `${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta).toFixed(1)}%`;
          tile.appendChild(deltaNode);
        }
        grid.appendChild(tile);
      });
      box.appendChild(grid);
    }, (error) => {
      box.textContent = "Error cargando ROI: " + error.message;
    });
  }

  async function loadJobsStatus() {
    const box = element("#jobsStatus");
    await run(async () => {
      const out = await api("/api/admin/jobs?limit=12");
      const jobs = out.jobs || [];
      box.replaceChildren();
      if (!jobs.length) {
        box.textContent = "No hay trabajos recientes.";
        return;
      }

      jobs.forEach((job) => {
        const row = document.createElement("div");
        row.className = "row";
        row.style.justifyContent = "space-between";
        row.style.marginBottom = "6px";

        const left = document.createElement("div");
        const type = document.createElement("strong");
        type.textContent = job.job_type;
        const meta = document.createElement("div");
        meta.className = "small";
        const created = job.created_at ? new Date(job.created_at).toLocaleString() : "—";
        meta.textContent = `Creado: ${created} • Intentos: ${job.attempts ?? 0}`;
        left.append(type, meta);

        const right = document.createElement("div");
        right.className = "badge";
        right.textContent = job.status || "—";
        if (job.status === "DONE") right.style.background = "rgba(54,211,153,.16)";
        if (job.status === "FAILED") right.style.background = "rgba(255,91,110,.14)";
        if (job.status === "RUNNING") right.style.background = "rgba(79,124,255,.16)";
        row.append(left, right);
        box.appendChild(row);

        if (job.error) {
          const err = document.createElement("div");
          err.className = "small";
          err.style.margin = "-2px 0 8px";
          err.textContent = `Error: ${job.error}`;
          box.appendChild(err);
        }
      });
    }, (error) => {
      box.textContent = "Error cargando trabajos: " + error.message;
    });
  }

  async function loadPaymentPending() {
    const box = element("#paymentPendingList");
    await run(async () => {
      const out = await api("/api/admin/payment-webhooks?status=PENDING_MAPPING&limit=20");
      const events = out.events || [];
      box.replaceChildren();
      if (!events.length) {
        box.textContent = "No hay pagos pendientes por asignar.";
        return;
      }

      events.forEach((event) => {
        const card = document.createElement("div");
        card.className = "card";
        card.style.marginBottom = "8px";
        card.style.padding = "10px";

        const top = document.createElement("div");
        top.className = "small";
        const when = event.created_at ? new Date(event.created_at).toLocaleString() : "—";
        const amount = Number(event.amount_q || 0).toFixed(2);
        top.textContent = `${when} • ${event.provider || "—"} • Ref: ${event.provider_event_id || event.id} • Q${amount}`;
        card.appendChild(top);

        const row = document.createElement("div");
        row.className = "row";
        row.style.marginTop = "8px";

        const input = document.createElement("input");
        input.placeholder = "Teléfono cliente (502...)";
        input.value = event.customer_phone || "";
        input.style.maxWidth = "240px";

        const btn = document.createElement("button");
        btn.className = "primary";
        btn.textContent = "Asignar";
        btn.addEventListener("click", async () => {
          await run(async () => {
            const phone = input.value.trim();
            if (!phone) return toast("Escribe un teléfono.");
            await api(`/api/admin/payment-webhooks/${encodeURIComponent(event.id)}/resolve`, {
              method: "POST",
              body: JSON.stringify({ customerPhone: phone })
            });
            toast("Pago asignado y puntos otorgados.");
            await loadPaymentPending();
          }, (error) => {
            toast("No se pudo asignar: " + error.message);
          });
        });

        row.append(input, btn);
        card.appendChild(row);
        box.appendChild(card);
      });
    }, (error) => {
      box.textContent = "Error cargando pendientes: " + error.message;
    });
  }

  async function loadAlertsCenter() {
    const box = element("#alertsCenter");
    await run(async () => {
      const out = await api("/api/admin/alerts?limit=60");
      const rows = out.alerts || [];
      box.replaceChildren();
      if (!rows.length) {
        box.textContent = "Sin alertas recientes.";
        return;
      }
      rows.forEach((alertRow) => {
        const line = document.createElement("div");
        line.style.marginBottom = "8px";
        const when = alertRow.created_at ? new Date(alertRow.created_at).toLocaleString() : "—";
        const details = alertRow.details && typeof alertRow.details === "object" ? JSON.stringify(alertRow.details) : "";
        line.textContent = `[${alertRow.severity}] ${when} • ${alertRow.alert_type}${details ? ` • ${details}` : ""}`;
        box.appendChild(line);
      });
    }, (error) => {
      box.textContent = "Error cargando alertas: " + error.message;
    });
  }

  function initDefaultDates() {
    if (input("#ivaFrom").value && input("#ivaTo").value) return;
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const yyyy = (value) => value.toISOString().slice(0, 10);
    input("#ivaFrom").value = yyyy(from);
    input("#ivaTo").value = yyyy(now);
  }

  function init() {
    initDefaultDates();
    $("#btnExportIvaCsv")?.addEventListener("click", exportIvaCsv);
    $("#btnRefreshOpsSummary")?.addEventListener("click", refresh(loadOpsSummary));
    $("#btnRefreshRoi")?.addEventListener("click", refresh(loadRoiReport));
    $("#btnRefreshJobs")?.addEventListener("click", refresh(loadJobsStatus));
    $("#btnRefreshPaymentPending")?.addEventListener("click", refresh(loadPaymentPending));
    $("#btnRefreshAlerts")?.addEventListener("click", refresh(loadAlertsCenter));
  }

  return {
    init,
    loadOpsSummary,
    loadRoiReport,
    loadJobsStatus,
    loadPaymentPending,
    loadAlertsCenter
  };
}
