/** @typedef {import("./types.js").SuperPageContext} SuperPageContext */
/** @typedef {import("./types.js").SuperPlanDefinition} SuperPlanDefinition */
/** @typedef {import("./types.js").SuperPlansResponse} SuperPlansResponse */

const FEATURE_LABELS = {
  gift_cards: "Gift Cards",
  rewards: "Recompensas",
  redemptions: "Canjes",
  program_rules: "Reglas de puntos",
  staff_management: "Gestión de personal",
  fraud_monitoring: "Monitoreo antifraude",
  lifecycle_automation: "Automatizaciones",
  customer_export: "Exportación de clientes",
  rbac_matrix: "Matriz RBAC",
  analytics: "Analítica",
  tiers: "Niveles",
  referrals: "Referidos",
  gamification: "Gamificación",
  multi_branch: "Multi-sucursal",
  webhooks: "Webhooks",
  external_awards: "Integración externa",
  campaign_rules: "Reglas de campaña",
};

const PLAN_POSITIONING = {
  EMPRENDEDOR: {
    summary: "Base operativo: QR, cartera, recompensas, canjes y operación básica en un local.",
    highlight: "Listo para operar, sin módulos avanzados.",
  },
  NEGOCIO: {
    summary:
      "Plan objetivo para negocios serios: analítica, niveles, referidos, gift cards y automatizaciones.",
    highlight: "La mayoría de negocios debería terminar aquí.",
  },
  EMPRESA: {
    summary: "Capa estratégica: gamificación, external awards, branding avanzado y QR premium.",
    highlight: "Reservado para branding e integraciones de alto valor.",
  },
};

/**
 * @param {{ monthly?: number; yearly?: number } | undefined} pricing
 * @returns {string}
 */
function priceSummary(pricing) {
  if (!pricing) return "Precio no configurado";
  const monthly = Number(pricing.monthly || 0).toLocaleString("es-GT");
  const yearly = Number(pricing.yearly || 0).toLocaleString("es-GT");
  return `Q${monthly}/mes • Q${yearly}/año`;
}

/**
 * Plan catalogue: feature matrix editing and plan summaries reused by the
 * business list.
 * @param {SuperPageContext} ctx
 * @param {{ reloadBusinesses: () => Promise<void> }} deps
 */
export function createPlans(ctx, { reloadBusinesses }) {
  const { api, toast, state, run, element } = ctx;

  /**
   * @param {string} plan
   * @returns {SuperPlanDefinition | null}
   */
  function getPlanDef(plan) {
    return (state.planList || []).find((p) => p.plan === plan) || null;
  }

  function planSummaryText(plan) {
    const def = getPlanDef(plan);
    if (!def) return "Sin detalle de plan.";

    const features = Object.entries(def.features || {})
      .filter(([, enabled]) => Boolean(enabled))
      .map(([key]) => FEATURE_LABELS[key] || key);

    const limits = def.limits || {};
    const limitsText = `Sucursales: ${limits.branches ?? "—"} • Recompensas: ${limits.rewards ?? "—"} • Clientes activos: ${limits.activeCustomers ?? "—"}`;
    const msg = def.messaging_gtq || {};
    const msgText = `Mensajería: incluye ${Number(msg.included_messages || 0).toLocaleString("es-GT")} mensajes/mes • excedente Q${Number(msg.overage_per_message_q || 0).toFixed(2)}/msg`;
    const featuresText = features.length ? features.join(", ") : "Básico (sin módulos avanzados)";
    const pricingText = `Precio: ${priceSummary(def.pricing_gtq)}`;
    return `${pricingText}\n${msgText}\n${limitsText}\nIncluye: ${featuresText}`;
  }

  /** @param {SuperPlanDefinition} p */
  function renderPlanCard(p) {
    const card = document.createElement("div");
    card.className = "card compact-card mb-8";

    const title = document.createElement("h3");
    title.className = "m-0 mb-8";
    title.textContent = `${p.plan} · ${priceSummary(p.pricing_gtq)}`;
    card.appendChild(title);

    const positioning = PLAN_POSITIONING[p.plan] || null;
    if (positioning) {
      const summary = document.createElement("p");
      summary.className = "small mb-8";
      summary.textContent = positioning.summary;
      card.appendChild(summary);

      const highlight = document.createElement("div");
      highlight.className = "badge badge-soft mb-8";
      highlight.textContent = positioning.highlight;
      card.appendChild(highlight);
    }

    const grid = document.createElement("div");
    grid.className = "grid";
    /** @type {Record<string, HTMLInputElement>} */
    const checkboxes = {};
    const featureKeys = Object.keys(p.features || {});
    featureKeys.forEach((feature) => {
      const label = FEATURE_LABELS[feature] || feature;
      const wrap = document.createElement("label");
      wrap.className = "small row-inline-flex";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = Boolean(p.features?.[feature]);
      checkboxes[feature] = cb;
      wrap.append(cb, document.createTextNode(label));
      grid.appendChild(wrap);
    });
    card.appendChild(grid);

    const foot = document.createElement("div");
    foot.className = "row mt-10";
    const limits = p.limits || {};
    const msg = p.messaging_gtq || {};
    const info = document.createElement("span");
    info.className = "small";
    info.textContent = `Límites: sucursales ${limits.branches}, recompensas ${limits.rewards}, clientes activos ${limits.activeCustomers}. Mensajes: ${Number(msg.included_messages || 0).toLocaleString("es-GT")}/mes (Q${Number(msg.overage_per_message_q || 0).toFixed(2)} extra).`;
    const btn = document.createElement("button");
    btn.className = "primary";
    btn.textContent = "Guardar funcionalidades";
    btn.addEventListener("click", async () => {
      await run(
        async () => {
          const features = {};
          Object.keys(checkboxes).forEach((key) => {
            features[key] = Boolean(checkboxes[key].checked);
          });
          await api(`/api/super/plans/${encodeURIComponent(p.plan)}/features`, {
            method: "PUT",
            body: JSON.stringify({ features }),
          });
          toast(`Funcionalidades de ${p.plan} actualizadas.`);
          await loadPlans();
          renderPlanMatrix();
          await reloadBusinesses();
        },
        (error) => {
          toast("No se pudo guardar: " + error.message);
        },
      );
    });
    foot.append(info, btn);
    card.appendChild(foot);
    return card;
  }

  function renderPlanMatrix() {
    const box = element("#planMatrix");
    box.replaceChildren();
    if (!state.planList.length) {
      box.textContent = "No hay planes configurados.";
      return;
    }
    state.planList.forEach((p) => box.appendChild(renderPlanCard(p)));
  }

  function makePlanSelect(currentPlan) {
    const sel = document.createElement("select");
    (state.planList || []).forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.plan;
      opt.textContent = `${p.plan} (${priceSummary(p.pricing_gtq)})`;
      sel.appendChild(opt);
    });
    sel.value = currentPlan || state.planList[0]?.plan || "EMPRENDEDOR";
    return sel;
  }

  async function loadPlans() {
    const out = /** @type {SuperPlansResponse} */ (await api("/api/super/plans"));
    state.planList = out.plans || [];
  }

  return { loadPlans, makePlanSelect, planSummaryText, renderPlanMatrix };
}
