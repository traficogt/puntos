import {
  applyAutomationTemplateForm,
  buildProgramPayload,
  fillExternalAwardsForm,
  fillProgramForm,
  toggleProgramBoxes,
  updateProgramSummary
} from "./program-form.js";

/** @typedef {import("../types.js").AdminDashboardApp} AdminDashboardApp */

/**
 * @param {AdminDashboardApp} app
 */
export function createProgramActions(app) {
  const { api, $, toast } = app;

  /**
   * @param {string} selector
   * @returns {HTMLInputElement | HTMLTextAreaElement}
   */
  function field(selector) {
    return /** @type {HTMLInputElement | HTMLTextAreaElement} */ ($(selector));
  }

  async function run(task, onError) {
    try {
      return await task();
    } catch (error) {
      onError(error);
      return null;
    }
  }

  async function loadProgramRule() {
    await run(async () => {
      const out = await api("/api/admin/program");
      fillProgramForm($, out);
      toggleProgramBoxes($);
      updateProgramSummary($);
    }, (error) => {
      toast("No se pudo cargar regla de puntos: " + error.message);
    });
  }

  async function loadCampaignRules() {
    if (!app.hasFeature("campaign_rules")) return;
    await run(async () => {
      const out = await api("/api/admin/campaign-rules");
      field("#campaignRulesJson").value = JSON.stringify(out.rules || [], null, 2);
    }, (error) => {
      toast("No se pudieron cargar reglas: " + error.message);
    });
  }

  async function saveCampaignRules() {
    if (!app.hasFeature("campaign_rules")) return;
    await run(async () => {
      const raw = field("#campaignRulesJson").value.trim();
      const rules = raw ? JSON.parse(raw) : [];
      await api("/api/admin/campaign-rules", {
        method: "PUT",
        body: JSON.stringify({ rules })
      });
      toast("Reglas de campaña guardadas.");
    }, (error) => {
      toast("Error guardando reglas: " + (error.message || "JSON inválido"));
    });
  }

  async function loadExternalAwards() {
    if (!app.hasFeature("external_awards")) return;
    await run(async () => {
      const out = await api("/api/admin/external-awards");
      fillExternalAwardsForm($, out.external_awards || {});
    }, (error) => {
      toast("No se pudo cargar integración externa: " + error.message);
    });
  }

  async function saveExternalAwards() {
    if (!app.hasFeature("external_awards")) return;
    await run(async () => {
      const payload = {
        enabled: /** @type {HTMLInputElement} */ ($("#externalAwardsEnabled")).checked
      };
      const apiKey = field("#externalAwardsApiKey").value.trim();
      if (apiKey) payload.api_key = apiKey;
      await api("/api/admin/external-awards", {
        method: "PUT",
        body: JSON.stringify(payload)
      });
      field("#externalAwardsApiKey").value = "";
      await loadExternalAwards();
      toast("Integración externa guardada.");
    }, (error) => {
      toast("Error guardando integración: " + error.message);
    });
  }

  async function loadSuspiciousAwards() {
    await run(async () => {
      const q = app.branchQueryString();
      const out = await api(`/api/admin/awards/suspicious?limit=30${q ? `&${q}` : ""}`);
      const rows = out.awards || [];
      const box = /** @type {HTMLElement} */ ($("#suspiciousAwards"));
      if (!rows.length) {
        box.textContent = "Sin transacciones sospechosas.";
        return;
      }
      const lines = rows.map((r) => {
        const when = new Date(r.created_at).toLocaleString();
        const who = r.staff_name || r.staff_email || r.staff_user_id || "staff";
        const cust = r.customer_name || r.customer_phone || r.customer_id;
        const reasons = (r.guard?.reasons || []).join(",");
        const branch = r.branch_name || (r.branch_id ? `sucursal:${r.branch_id}` : "sin sucursal");
        return `${when} | ${branch} | ${who} -> ${cust} | +${r.points} pts | Q${Number(r.amount_q || 0).toFixed(2)} | ${reasons}`;
      });
      box.textContent = lines.join("\n");
    }, (error) => {
      /** @type {HTMLElement} */ ($("#suspiciousAwards")).textContent = "Error cargando sospechosas: " + error.message;
    });
  }

  async function saveProgramRule() {
    await run(async () => {
      await api("/api/admin/program", {
        method: "POST",
        body: JSON.stringify(buildProgramPayload($))
      });
      updateProgramSummary($);
      toast("Regla de puntos guardada.");
      if (app.hasFeature("fraud_monitoring")) await loadSuspiciousAwards();
    }, (error) => {
      toast("Error guardando regla: " + error.message);
    });
  }

  async function applyAutomationTemplate(template) {
    await run(async () => {
      await app.state.initialProgramLoad.catch(() => {});
      const out = await api("/api/admin/automations/template", {
        method: "PUT",
        body: JSON.stringify({ template })
      });
      applyAutomationTemplateForm($, template, out.lifecycle || {});
      updateProgramSummary($);
      toast("Plantilla aplicada.");
    }, (error) => {
      toast("No se pudo aplicar plantilla: " + error.message);
    });
  }

  return {
    loadProgramRule,
    loadCampaignRules,
    saveCampaignRules,
    loadExternalAwards,
    saveExternalAwards,
    loadSuspiciousAwards,
    saveProgramRule,
    applyAutomationTemplate
  };
}
