/** @typedef {import("../../types.js").AdminDashboardApp} AdminDashboardApp */
/** @typedef {import("../../types.js").AnalyticsAuditController} AnalyticsAuditController */

/**
 * @param {AdminDashboardApp} app
 * @returns {AnalyticsAuditController}
 */
export function createAnalyticsAuditController(app) {
  const { api, $ } = app;

  /**
   * @param {string} selector
   * @returns {HTMLInputElement | HTMLElement}
   */
  function field(selector) {
    return /** @type {HTMLInputElement | HTMLElement} */ ($(selector));
  }

  function readAuditFiltersFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return {
      from: params.get("audit_from") || "",
      to: params.get("audit_to") || "",
      impersonatedOnly: params.get("audit_impersonated") === "1"
    };
  }

  function applyAuditFiltersFromUrl() {
    const { from, to, impersonatedOnly } = readAuditFiltersFromUrl();
    if ($("#auditFrom")) /** @type {HTMLInputElement} */ (field("#auditFrom")).value = from;
    if ($("#auditTo")) /** @type {HTMLInputElement} */ (field("#auditTo")).value = to;
    if ($("#auditShowImpersonatedOnly")) /** @type {HTMLInputElement} */ (field("#auditShowImpersonatedOnly")).checked = impersonatedOnly;
  }

  function syncAuditFiltersToUrl() {
    const params = new URLSearchParams(window.location.search);
    const from = /** @type {HTMLInputElement | null} */ ($("#auditFrom"))?.value || "";
    const to = /** @type {HTMLInputElement | null} */ ($("#auditTo"))?.value || "";
    const impersonatedOnly = Boolean(/** @type {HTMLInputElement | null} */ ($("#auditShowImpersonatedOnly"))?.checked);

    if (from) params.set("audit_from", from);
    else params.delete("audit_from");

    if (to) params.set("audit_to", to);
    else params.delete("audit_to");

    if (impersonatedOnly) params.set("audit_impersonated", "1");
    else params.delete("audit_impersonated");

    const query = params.toString();
    const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash || ""}`;
    window.history.replaceState(null, "", nextUrl);
  }

  function formatAuditDateLabel(value) {
    if (!value) return "";
    return new Date(`${value}T00:00:00`).toLocaleDateString();
  }

  function renderAuditScopeHint() {
    const hint = $("#auditScopeHint");
    if (!hint) return;

    const from = /** @type {HTMLInputElement | null} */ ($("#auditFrom"))?.value || "";
    const to = /** @type {HTMLInputElement | null} */ ($("#auditTo"))?.value || "";
    const impersonatedOnly = Boolean(/** @type {HTMLInputElement | null} */ ($("#auditShowImpersonatedOnly"))?.checked);

    let rangeLabel = "eventos recientes";
    if (from && to) rangeLabel = `del ${formatAuditDateLabel(from)} al ${formatAuditDateLabel(to)}`;
    else if (from) rangeLabel = `desde ${formatAuditDateLabel(from)}`;
    else if (to) rangeLabel = `hasta ${formatAuditDateLabel(to)}`;

    hint.textContent = impersonatedOnly
      ? `Vista actual: ${rangeLabel} • solo acciones en impersonación.`
      : `Vista actual: ${rangeLabel} • todos los eventos visibles.`;
  }

  function exportAuditCsv() {
    const params = new URLSearchParams();
    const from = /** @type {HTMLInputElement | null} */ ($("#auditFrom"))?.value;
    const to = /** @type {HTMLInputElement | null} */ ($("#auditTo"))?.value;
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (/** @type {HTMLInputElement | null} */ ($("#auditShowImpersonatedOnly"))?.checked) params.set("impersonated_only", "1");
    params.set("limit", "5000");
    const q = params.toString();
    window.open(`/api/admin/audit.csv${q ? `?${q}` : ""}`, "_blank");
  }

  async function loadAuditTimeline() {
    const box = $("#auditTimeline");
    const from = /** @type {HTMLInputElement | null} */ ($("#auditFrom"))?.value;
    const to = /** @type {HTMLInputElement | null} */ ($("#auditTo"))?.value;
    const impersonatedOnly = Boolean(/** @type {HTMLInputElement | null} */ ($("#auditShowImpersonatedOnly"))?.checked);
    try {
      syncAuditFiltersToUrl();
      renderAuditScopeHint();
      const params = new URLSearchParams({ limit: "80" });
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (impersonatedOnly) params.set("impersonated_only", "1");
      const out = await api(`/api/admin/audit?${params.toString()}`);
      const rows = out.events || [];
      box.replaceChildren();
      if (!rows.length) {
        box.textContent = impersonatedOnly
          ? "Sin eventos recientes en modo impersonación."
          : "Sin eventos de auditoría recientes.";
        return;
      }

      rows.forEach((ev) => {
        const row = document.createElement("div");
        row.style.marginBottom = "8px";
        const when = ev.created_at ? new Date(ev.created_at).toLocaleString() : "—";
        const actor = ev.actor_name || ev.actor_email || ev.actor_type || "sistema";
        const impersonatedBy = ev.meta?.impersonated_by_super_admin_email;

        const summaryRow = document.createElement("div");
        summaryRow.className = "row";
        summaryRow.style.gap = "8px";
        summaryRow.style.alignItems = "center";

        const summary = document.createElement("div");
        summary.textContent = `${when} • ${actor} • ${ev.action}`;
        summaryRow.appendChild(summary);

        if (impersonatedBy) {
          const badge = document.createElement("span");
          badge.className = "badge";
          badge.style.padding = "4px 8px";
          badge.style.fontSize = "11px";
          badge.textContent = "Impersonación";
          summaryRow.appendChild(badge);
        }

        row.appendChild(summaryRow);

        if (impersonatedBy) {
          const detail = document.createElement("div");
          detail.className = "small";
          detail.textContent = `Ejecutado en modo impersonación por ${impersonatedBy}`;
          row.appendChild(detail);
        }
        box.appendChild(row);
      });
    } catch (e) {
      box.textContent = "Error cargando auditoría: " + e.message;
    }
  }

  function init() {
    applyAuditFiltersFromUrl();
    renderAuditScopeHint();
    $("#btnExportAuditCsv")?.addEventListener("click", exportAuditCsv);
    $("#btnRefreshAudit")?.addEventListener("click", () => loadAuditTimeline().catch(() => {}));
    $("#auditFrom")?.addEventListener("change", () => loadAuditTimeline().catch(() => {}));
    $("#auditTo")?.addEventListener("change", () => loadAuditTimeline().catch(() => {}));
    $("#auditShowImpersonatedOnly")?.addEventListener("change", () => loadAuditTimeline().catch(() => {}));
    window.addEventListener("popstate", () => {
      applyAuditFiltersFromUrl();
      loadAuditTimeline().catch(() => {});
    });
  }

  return {
    init,
    loadAuditTimeline
  };
}
