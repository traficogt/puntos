import { isStrongPassword, passwordRequirementsText } from "/lib.js";

/** @typedef {import("./types.js").SuperPlanDefinition} SuperPlanDefinition */
/** @typedef {import("./types.js").SuperBusinessRow} SuperBusinessRow */
/** @typedef {import("./types.js").SuperPlansResponse} SuperPlansResponse */
/** @typedef {import("./types.js").SuperBusinessesResponse} SuperBusinessesResponse */
/** @typedef {import("./types.js").SuperSecurityPostureResponse} SuperSecurityPostureResponse */
/** @typedef {import("./types.js").SuperBusinessCreateResponse} SuperBusinessCreateResponse */
/** @typedef {import("./types.js").SuperBusinessUserCreateResponse} SuperBusinessUserCreateResponse */

/**
 * @param {{ api: (path: string, opts?: RequestInit) => Promise<any>; $: (selector: string) => Element | null; toast: (message: string) => void }} deps
 */
export async function initSuperPage({ api, $, toast }) {
  /** @type {SuperPlanDefinition[]} */
  let planList = [];
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
    campaign_rules: "Reglas de campaña"
  };

  /**
   * @template T
   * @param {() => Promise<T>} task
   * @param {(error: Error) => T | null | Promise<T | null>} [onError]
   * @returns {Promise<T | null>}
   */
  async function run(task, onError) {
    try {
      return await task();
    } catch (error) {
      if (onError) {
        return onError(error);
      }
      return null;
    }
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
   * @returns {HTMLSelectElement}
   */
  function select(selector) {
    return /** @type {HTMLSelectElement} */ ($(selector));
  }

  /**
   * @param {string} selector
   * @returns {HTMLElement}
   */
  function element(selector) {
    return /** @type {HTMLElement} */ ($(selector));
  }

  /**
   * @param {string} plan
   * @returns {SuperPlanDefinition | null}
   */
  function getPlanDef(plan) {
    return (planList || []).find((p) => p.plan === plan) || null;
  }

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

  function renderPlanMatrix() {
    const box = element("#planMatrix");
    box.replaceChildren();
    if (!planList.length) {
      box.textContent = "No hay planes configurados.";
      return;
    }

    planList.forEach((p) => {
      const card = document.createElement("div");
      card.className = "card";
      card.style.marginBottom = "8px";
      card.style.padding = "10px";

      const title = document.createElement("h3");
      title.style.margin = "0 0 8px";
      title.textContent = `${p.plan} · ${priceSummary(p.pricing_gtq)}`;
      card.appendChild(title);

      const grid = document.createElement("div");
      grid.className = "grid";
      /** @type {Record<string, HTMLInputElement>} */
      const checkboxes = {};
      const featureKeys = Object.keys(p.features || {});
      featureKeys.forEach((feature) => {
        const label = FEATURE_LABELS[feature] || feature;
        const wrap = document.createElement("label");
        wrap.className = "small";
        wrap.style.display = "flex";
        wrap.style.alignItems = "center";
        wrap.style.gap = "8px";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = Boolean(p.features?.[feature]);
        checkboxes[feature] = cb;
        wrap.append(cb, document.createTextNode(label));
        grid.appendChild(wrap);
      });
      card.appendChild(grid);

      const foot = document.createElement("div");
      foot.className = "row";
      foot.style.marginTop = "10px";
      const limits = p.limits || {};
      const msg = p.messaging_gtq || {};
      const info = document.createElement("span");
      info.className = "small";
      info.textContent = `Límites: sucursales ${limits.branches}, recompensas ${limits.rewards}, clientes activos ${limits.activeCustomers}. Mensajes: ${Number(msg.included_messages || 0).toLocaleString("es-GT")}/mes (Q${Number(msg.overage_per_message_q || 0).toFixed(2)} extra).`;
      const btn = document.createElement("button");
      btn.className = "primary";
      btn.textContent = "Guardar funcionalidades";
      btn.addEventListener("click", async () => {
        await run(async () => {
          const features = {};
          Object.keys(checkboxes).forEach((key) => {
            features[key] = Boolean(checkboxes[key].checked);
          });
          await api(`/api/super/plans/${encodeURIComponent(p.plan)}/features`, {
            method: "PUT",
            body: JSON.stringify({ features })
          });
          toast(`Funcionalidades de ${p.plan} actualizadas.`);
          await loadPlans();
          renderPlanMatrix();
          await loadBusinesses();
        }, (error) => {
          toast("No se pudo guardar: " + error.message);
        });
      });
      foot.append(info, btn);
      card.appendChild(foot);
      box.appendChild(card);
    });
  }

  function makePlanSelect(currentPlan) {
    const sel = document.createElement("select");
    (planList || []).forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.plan;
      opt.textContent = `${p.plan} (${priceSummary(p.pricing_gtq)})`;
      sel.appendChild(opt);
    });
    sel.value = currentPlan || (planList[0]?.plan || "EMPRENDEDOR");
    return sel;
  }

  async function loadPlans() {
    const out = /** @type {SuperPlansResponse} */ (await api("/api/super/plans"));
    planList = out.plans || [];
  }

  async function loadMe() {
    await run(async () => {
      await api("/api/super/me");
      element("#loginCard").style.display = "none";
      element("#mainCard").style.display = "block";
      element("#securityCard").style.display = "block";
      element("#businessCard").style.display = "block";
      element("#btnLogout").style.display = "inline-flex";
      await loadPlans();
      renderPlanMatrix();
      await loadSecurityPosture();
      await loadBusinesses();
    }, () => {
      element("#loginCard").style.display = "block";
      element("#mainCard").style.display = "none";
      element("#securityCard").style.display = "none";
      element("#businessCard").style.display = "none";
      element("#btnLogout").style.display = "none";
    });
  }

  function counterCard(label, value, tone = "") {
    const card = document.createElement("div");
    card.className = "card";
    card.style.padding = "10px";
    if (tone) card.style.borderColor = tone;
    const labelEl = document.createElement("div");
    labelEl.className = "small";
    labelEl.textContent = label;
    const valueEl = document.createElement("div");
    valueEl.style.fontSize = "24px";
    valueEl.style.fontWeight = "700";
    valueEl.textContent = String(value);
    card.append(labelEl, valueEl);
    return card;
  }

  async function loadSecurityPosture() {
    await run(async () => {
      const out = /** @type {SuperSecurityPostureResponse} */ (await api("/api/super/security/posture?hours=24"));
      const counts = out.counts || {};
      const box = element("#securityCounters");
      box.replaceChildren();
      box.appendChild(counterCard("Super login fallido", Number(counts.super_login_failed || 0), "#ffadad"));
      box.appendChild(counterCard("Staff login fallido", Number(counts.staff_login_failed || 0), "#ffd6a5"));
      box.appendChild(counterCard("CSRF bloqueado", Number(counts.csrf_denied || 0), "#fdffb6"));
      box.appendChild(counterCard("Replay QR bloqueado", Number(counts.qr_replay_blocked || 0), "#caffbf"));
      box.appendChild(counterCard("Webhook auth fallida", Number(counts.webhook_auth_failed || 0), "#9bf6ff"));

      const recent = out.recent || [];
      if (!recent.length) {
        element("#securityRecent").textContent = "Sin eventos recientes.";
        return;
      }
      const lines = recent.map((event) => {
        const when = new Date(event.created_at).toLocaleString();
        return `${when} | ${event.event_type} | ${event.method || "-"} ${event.route || "-"} | ${event.ip || "-"} | ${JSON.stringify(event.meta || {})}`;
      });
      element("#securityRecent").textContent = lines.join("\n");
    }, (error) => {
      element("#securityRecent").textContent = "No se pudo cargar postura de seguridad: " + error.message;
    });
  }

  async function loadBusinesses() {
    await run(async () => {
      const out = /** @type {SuperBusinessesResponse} */ (await api("/api/super/businesses?limit=200"));
      const rows = /** @type {SuperBusinessRow[]} */ (out.businesses || []);
      const box = element("#businesses");
      box.replaceChildren();
      if (!rows.length) {
        box.textContent = "No hay negocios.";
        return;
      }

      rows.forEach((business) => {
        const card = document.createElement("div");
        card.className = "card";
        card.style.marginBottom = "8px";
        card.style.padding = "10px";

        const title = document.createElement("div");
        const strong = document.createElement("strong");
        strong.textContent = business.name || "Negocio";
        const slug = document.createElement("span");
        slug.className = "small";
        slug.textContent = ` (${business.slug || "-"})`;
        title.append(strong, slug);
        card.appendChild(title);

        const meta = document.createElement("div");
        meta.className = "small";
        meta.textContent = `Plan actual: ${business.plan} • Clientes: ${business.customers} • Staff: ${business.staff}`;
        card.appendChild(meta);

        const planInfo = document.createElement("div");
        planInfo.className = "small";
        planInfo.style.marginTop = "6px";
        planInfo.style.whiteSpace = "pre-wrap";
        planInfo.textContent = planSummaryText(business.plan);
        card.appendChild(planInfo);

        const row = document.createElement("div");
        row.className = "row";
        row.style.marginTop = "8px";

        const planSel = makePlanSelect(business.plan);
        planSel.addEventListener("change", () => {
          planInfo.textContent = planSummaryText(planSel.value);
        });
        row.appendChild(planSel);

        const savePlanBtn = document.createElement("button");
        savePlanBtn.textContent = "Guardar plan";
        savePlanBtn.addEventListener("click", async () => {
          await run(async () => {
            await api(`/api/super/businesses/${encodeURIComponent(business.id)}/plan`, {
              method: "PUT",
              body: JSON.stringify({ plan: planSel.value })
            });
            toast(`Plan actualizado a ${planSel.value}.`);
            await loadBusinesses();
          }, (error) => {
            toast("No se pudo actualizar plan: " + error.message);
          });
        });
        row.appendChild(savePlanBtn);

        const impersonateBtn = document.createElement("button");
        impersonateBtn.className = "primary";
        impersonateBtn.textContent = "Impersonar";
        impersonateBtn.addEventListener("click", async () => {
          await run(async () => {
            await api(`/api/super/impersonate/${encodeURIComponent(business.id)}`, { method: "POST", body: "{}" });
            toast("Impersonación lista. Abriendo panel admin...");
            setTimeout(() => {
              location.href = "/admin-dashboard.html";
            }, 500);
          }, (error) => {
            toast("No se pudo impersonar: " + error.message);
          });
        });
        row.appendChild(impersonateBtn);

        card.appendChild(row);
        box.appendChild(card);
      });

      const userBizSel = /** @type {HTMLSelectElement | null} */ ($("#newUserBusiness"));
      if (userBizSel) {
        userBizSel.replaceChildren();
        rows.forEach((business) => {
          const opt = document.createElement("option");
          opt.value = business.id;
          opt.textContent = `${business.name} (${business.slug})`;
          userBizSel.appendChild(opt);
        });
      }
    }, (error) => {
      toast("Error cargando negocios: " + error.message);
    });
  }

  async function createBusiness() {
    await run(async () => {
      const payload = {
        businessName: input("#newBusinessName").value.trim(),
        email: input("#newBusinessEmail").value.trim(),
        phone: input("#newBusinessPhone").value.trim() || undefined,
        password: input("#newBusinessPassword").value,
        category: input("#newBusinessCategory").value,
        plan: select("#newBusinessPlan").value
      };
      if (!isStrongPassword(payload.password)) {
        return toast(passwordRequirementsText());
      }
      const out = /** @type {SuperBusinessCreateResponse} */ (await api("/api/super/businesses", { method: "POST", body: JSON.stringify(payload) }));
      toast(`Negocio creado: ${out.business?.name || "OK"}`);
      input("#newBusinessName").value = "";
      input("#newBusinessEmail").value = "";
      input("#newBusinessPhone").value = "";
      input("#newBusinessPassword").value = "";
      await loadBusinesses();
    }, (error) => {
      toast("No se pudo crear negocio: " + error.message);
    });
  }

  async function createBusinessUser() {
    await run(async () => {
      const businessId = select("#newUserBusiness").value;
      if (!businessId) return toast("Selecciona un negocio.");
      const payload = {
        name: input("#newUserName").value.trim(),
        email: input("#newUserEmail").value.trim(),
        phone: input("#newUserPhone").value.trim() || undefined,
        role: select("#newUserRole").value,
        password: input("#newUserPassword").value
      };
      if (!isStrongPassword(payload.password)) {
        return toast(passwordRequirementsText());
      }
      const out = /** @type {SuperBusinessUserCreateResponse} */ (await api(`/api/super/businesses/${encodeURIComponent(businessId)}/users`, {
        method: "POST",
        body: JSON.stringify(payload)
      }));
      toast(`Usuario creado: ${out.user?.email || "OK"}`);
      input("#newUserName").value = "";
      input("#newUserEmail").value = "";
      input("#newUserPhone").value = "";
      input("#newUserPassword").value = "";
      element("#newUserHint").textContent = `Último creado: ${out.user?.name || ""} (${out.user?.role || ""})`;
      await loadBusinesses();
    }, (error) => {
      toast("No se pudo crear usuario: " + error.message);
    });
  }

  element("#btnLogin").addEventListener("click", async () => {
    await run(async () => {
      await api("/api/super/login", {
        method: "POST",
        body: JSON.stringify({ email: input("#email").value.trim(), password: input("#password").value })
      });
      toast("Sesión iniciada.");
      await loadMe();
    }, (error) => {
      toast(error.message);
    });
  });

  element("#btnLogout").addEventListener("click", async () => {
    await api("/api/super/logout", { method: "POST", body: "{}" }).catch(() => {});
    toast("Sesión cerrada.");
    await loadMe();
  });

  element("#btnReload").addEventListener("click", async () => {
    await loadSecurityPosture();
    await loadBusinesses();
  });
  element("#btnRotateSecrets").addEventListener("click", async () => {
    await run(async () => {
      const out = await api("/api/super/security/rotate-secrets", { method: "POST", body: "{}" });
      const w = Number(out?.rotated?.webhook_secrets || 0);
      const e = Number(out?.rotated?.external_award_api_keys || 0);
      toast(`Rotación completada. Webhooks: ${w}, API externas: ${e}.`);
      await loadSecurityPosture();
    }, (error) => {
      toast("No se pudo rotar secretos: " + error.message);
    });
  });
  element("#btnCreateBusiness").addEventListener("click", createBusiness);
  element("#btnCreateBusinessUser").addEventListener("click", createBusinessUser);

  await loadMe();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
}
