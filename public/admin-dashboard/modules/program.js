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
export function registerProgramModule(app) {
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

  function fire(task) {
    return () => {
      task().catch(() => {});
    };
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
      if (!rows.length) {
        /** @type {HTMLElement} */ ($("#suspiciousAwards")).textContent = "Sin transacciones sospechosas.";
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
      /** @type {HTMLElement} */ ($("#suspiciousAwards")).textContent = lines.join("\n");
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

  function initProgramListeners() {
    $("#programType")?.addEventListener("change", () => {
      toggleProgramBoxes($);
      updateProgramSummary($);
    });

    [
      "#programPointsPerQ",
      "#programRound",
      "#programPointsPerVisit",
      "#programPointsPerItem",
      "#guardMaxAmount",
      "#guardMaxPoints",
      "#guardMaxVisits",
      "#guardMaxItems",
      "#guardSuspiciousPoints",
      "#guardSuspiciousAmount",
      "#pendingHoldDays",
      "#pointsExpirationDays",
      "#redeemMaxPerDay",
      "#redeemMaxPerRewardDay",
      "#redeemCooldownHours"
    ].forEach((sel) => {
      const el = document.querySelector(sel);
      if (!el) return;
      el.addEventListener("input", () => updateProgramSummary($));
      el.addEventListener("change", () => updateProgramSummary($));
    });

    $("#btnSaveProgram")?.addEventListener("click", saveProgramRule);
    $("#btnRefreshSuspicious")?.addEventListener("click", fire(loadSuspiciousAwards));
    $("#btnLoadCampaignRules")?.addEventListener("click", loadCampaignRules);
    $("#btnSaveCampaignRules")?.addEventListener("click", saveCampaignRules);
    $("#btnLoadExternalAwards")?.addEventListener("click", loadExternalAwards);
    $("#btnSaveExternalAwards")?.addEventListener("click", saveExternalAwards);

    $("#btnTplCafeBasico")?.addEventListener("click", () => applyAutomationTemplate("cafeteria_basico"));
    $("#btnTplReactivacion")?.addEventListener("click", () => applyAutomationTemplate("reactivacion_fuerte"));
    $("#btnTplSoloAlertas")?.addEventListener("click", () => applyAutomationTemplate("solo_alertas"));
  }

  app.onAfterPlanReady(async () => {
    initProgramListeners();
    toggleProgramBoxes($);
    updateProgramSummary($);

    if (app.hasFeature("program_rules")) {
      app.state.initialProgramLoad = loadProgramRule();
      await app.state.initialProgramLoad;
    }

    if (app.hasFeature("fraud_monitoring")) await loadSuspiciousAwards();
    if (app.hasFeature("campaign_rules")) await loadCampaignRules();
    if (app.hasFeature("external_awards")) await loadExternalAwards();
  });

  app.onBranchFilterChanged(() => {
    if (!app.hasFeature("fraud_monitoring")) return;
    fire(loadSuspiciousAwards)();
  });
}
