export function registerOpsModule(app) {
  const { api, $, toast } = app;

  function renderOwnerOnboardingChecklist(items) {
    const progressBar = $("#ownerOnboardingProgress");
    const box = $("#ownerOnboardingChecklist");
    if (!progressBar || !box) return;
    box.replaceChildren();

    const totalRequired = items.filter((x) => x.required).length || 1;
    const completedRequired = items.filter((x) => x.required && x.done).length;
    const pct = Math.round((completedRequired / totalRequired) * 100);
    progressBar.style.width = `${Math.max(6, pct)}%`;

    const next = items.find((x) => x.required && !x.done && x.action?.label);
    const nextCard = document.createElement("div");
    nextCard.className = "owner-onboarding-next";
    if (next) {
      const title = document.createElement("strong");
      title.textContent = "Siguiente paso recomendado";
      const detail = document.createElement("div");
      detail.className = "small";
      detail.textContent = `${next.label}: ${next.detail}`;
      const go = document.createElement("button");
      go.textContent = next.action.label;
      go.addEventListener("click", () => {
        if (next.action.tab) {
          app.activateTab(next.action.tab);
          app.loadTabData(next.action.tab).catch(() => {});
        }
        if (next.action.selector) {
          const el = document.querySelector(next.action.selector);
          if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            if (typeof el.focus === "function") el.focus();
          }
        }
      });
      nextCard.append(title, detail, go);
    } else {
      const title = document.createElement("strong");
      title.textContent = "Excelente: onboarding completo";
      const detail = document.createElement("div");
      detail.className = "small";
      detail.textContent = "Ya cubriste los pasos clave. Ahora enfócate en retención y recompensas.";
      nextCard.append(title, detail);
    }
    box.appendChild(nextCard);

    items.forEach((item) => {
      const row = document.createElement("div");
      row.className = "owner-onboarding-item";
      const state = document.createElement("span");
      state.className = `owner-onboarding-state ${item.done ? "done" : item.required ? "todo" : "na"}`;
      state.textContent = item.done ? "Listo" : item.required ? "Pendiente" : "Opcional";
      const text = document.createElement("span");
      text.className = "owner-onboarding-text";
      text.textContent = `${item.label}: ${item.detail}`;
      row.append(state, text);
      if (item.action?.label) {
        const actionCell = document.createElement("span");
        const btn = document.createElement("button");
        btn.className = "secondary";
        btn.textContent = item.action.label;
        btn.addEventListener("click", () => {
          if (item.action.tab) {
            app.activateTab(item.action.tab);
            app.loadTabData(item.action.tab).catch(() => {});
          }
          if (item.action.selector) {
            const el = document.querySelector(item.action.selector);
            if (el) {
              el.scrollIntoView({ behavior: "smooth", block: "center" });
              if (typeof el.focus === "function") el.focus();
            }
          }
        });
        actionCell.appendChild(btn);
        row.appendChild(actionCell);
      }
      box.appendChild(row);
    });

    const footer = document.createElement("div");
    footer.className = "small";
    footer.style.marginTop = "8px";
    footer.textContent = `Progreso: ${completedRequired}/${totalRequired} tareas clave (${pct}%).`;
    box.appendChild(footer);
  }

  async function loadOwnerOnboardingChecklist() {
    const box = $("#ownerOnboardingChecklist");
    if (!box) return;
    box.textContent = "Actualizando checklist...";
    try {
      const [
        programOut,
        rewardsOut,
        staffOut,
        branchesOut,
        analyticsOut
      ] = await Promise.all([
        api("/api/admin/program").catch(() => ({})),
        app.hasFeature("rewards") ? api("/api/admin/rewards").catch(() => ({})) : Promise.resolve({}),
        app.hasFeature("staff_management") ? api("/api/admin/staff").catch(() => ({})) : Promise.resolve({}),
        app.hasFeature("multi_branch") ? api("/api/admin/branches").catch(() => ({})) : Promise.resolve({}),
        app.hasFeature("analytics") ? api("/api/admin/analytics/dashboard").catch(() => ({})) : Promise.resolve({})
      ]);

      const programType = String(programOut?.program_type || "SPEND");
      const programJson = programOut?.program_json || {};
      const pointsRateOk = programType === "SPEND"
        ? Number(programJson.points_per_q || 0) > 0
        : programType === "VISIT"
          ? Number(programJson.points_per_visit || 0) > 0
          : Number(programJson.points_per_item || 0) > 0;

      const rewardsCount = Array.isArray(rewardsOut?.rewards) ? rewardsOut.rewards.length : 0;
      const staffCount = Array.isArray(staffOut?.staff) ? staffOut.staff.length : 0;
      const branchesCount = Array.isArray(branchesOut?.branches) ? branchesOut.branches.length : 0;
      const hasAnalytics = Boolean(analyticsOut?.summary);

      const items = [
        {
          label: "Regla de puntos",
          detail: "Configura el tipo y la tasa (gasto/visita/item).",
          required: true,
          done: pointsRateOk,
          action: { label: "Ir a regla", selector: "#ownerConfigCard" }
        },
        {
          label: "Recompensas",
          detail: "Crea al menos 1 recompensa para que el cliente vea valor rápido.",
          required: true,
          done: rewardsCount > 0,
          action: { label: "Ir a recompensas", tab: "rewards", selector: "#rewardName" }
        },
        {
          label: "Personal",
          detail: "Crea al menos 1 cajero/manager para operar escaneos.",
          required: true,
          done: staffCount >= 2, // OWNER + at least one extra
          action: { label: "Ir a personal", tab: "staff", selector: "#staffEmail" }
        },
        {
          label: "Sucursales",
          detail: "Configura ubicaciones si operas multi-sucursal.",
          required: false,
          done: !app.hasFeature("multi_branch") || branchesCount > 0,
          action: { label: "Ir a sucursales", tab: "branches", selector: "#branchName" }
        },
        {
          label: "Analítica",
          detail: "Revisa el tablero para detectar oportunidades y riesgos.",
          required: false,
          done: !app.hasFeature("analytics") || hasAnalytics,
          action: { label: "Ir a analítica", tab: "analytics" }
        }
      ];

      renderOwnerOnboardingChecklist(items);
    } catch (e) {
      box.textContent = "No se pudo cargar checklist: " + e.message;
    }
  }

  function printSop(type) {
    const templates = {
      apertura: [
        "SOP APERTURA - PUNTOSFIELES",
        "",
        "1) Iniciar sesión en /staff",
        "2) Escanear QR interno de prueba",
        "3) Confirmar regla de puntos",
        "4) Revisar recompensas activas y stock",
        "5) Revisar alertas críticas"
      ],
      cierre: [
        "SOP CIERRE - PUNTOSFIELES",
        "",
        "1) Revisar transacciones sospechosas",
        "2) Validar canjes y gift cards",
        "3) Exportar reporte IVA del día",
        "4) Revisar jobs fallidos",
        "5) Cerrar sesión en terminales"
      ],
      entrenamiento: [
        "GUIA RAPIDA PERSONAL - PUNTOSFIELES",
        "",
        "1) Buscar cliente por QR/token",
        "2) Otorgar puntos solo con comprobante",
        "3) Validar costo antes de canjear",
        "4) Reportar cualquier alerta al gerente",
        "5) Nunca compartir credenciales"
      ]
    };

    const text = (templates[type] || templates.entrenamiento).join("\n");
    const w = window.open("", "_blank");
    if (!w) return toast("No se pudo abrir ventana de impresión.");
    const doc = w.document;
    doc.open();
    doc.title = "SOP";
    while (doc.body.firstChild) doc.body.removeChild(doc.body.firstChild);
    const pre = doc.createElement("pre");
    pre.textContent = text;
    doc.body.appendChild(pre);
    doc.close();
    w.focus();
    w.print();
  }

  function initOperationsTab() {
    loadOwnerOnboardingChecklist().catch(() => {});
  }

  app.onAfterPlanReady(() => {
    $("#btnRefreshOnboarding")?.addEventListener("click", () => loadOwnerOnboardingChecklist().catch(() => {}));
    $("#btnPrintOpenSop")?.addEventListener("click", () => printSop("apertura"));
    $("#btnPrintCloseSop")?.addEventListener("click", () => printSop("cierre"));
    $("#btnPrintTraining")?.addEventListener("click", () => printSop("entrenamiento"));
  });

  app.registerTab("operations", {
    feature: null,
    allowManager: false,
    load: async () => initOperationsTab()
  });
}

