import {
  currentActiveTabName,
  restoreDashboardViewFromUrl as restoreDashboardView,
  syncDashboardViewToUrl as syncDashboardView
} from "./view-state.js";
import { createBranchFilter } from "./branch-filter.js";
import { createTabController } from "./tab-controller.js";
import { initDashboardChrome, loadPlanInfo, loadStaffSession } from "./session-controller.js";

/** @typedef {import("./types.js").AdminDashboardApp} AdminDashboardApp */
/** @typedef {import("./types.js").AdminDashboardDependencies} AdminDashboardDependencies */
/** @typedef {import("./types.js").BranchesUpdatedHook} BranchesUpdatedHook */
/** @typedef {import("./types.js").BranchChangedHook} BranchChangedHook */
/** @typedef {import("./types.js").DashboardBranch} DashboardBranch */
/** @typedef {import("./types.js").DashboardHook} DashboardHook */
/** @typedef {import("./types.js").DashboardState} DashboardState */
/** @typedef {import("./types.js").TabDefinition} TabDefinition */

const PLAN_LABELS = {
  analytics: "NEGOCIO",
  tiers: "NEGOCIO",
  referrals: "NEGOCIO",
  gift_cards: "NEGOCIO",
  multi_branch: "NEGOCIO",
  webhooks: "NEGOCIO",
  lifecycle_automation: "NEGOCIO",
  rbac_matrix: "NEGOCIO",
  gamification: "EMPRESA",
  external_awards: "EMPRESA"
};

const TAB_PRESENTATION = {
  branding: {
    title: "Branding",
    description: "Define cómo se presenta el programa al cliente sin tocar la estructura operativa del producto.",
    plan: "NEGOCIO"
  },
  rewards: {
    title: "Recompensas",
    description: "Diseña el catálogo, controla el costo de puntos y valida que cada premio esté listo para operar.",
    plan: "Base"
  },
  tiers: {
    title: "Niveles",
    description: "Configura el progreso del cliente, los umbrales de valor y la lógica que sostiene cada nivel.",
    plan: "NEGOCIO"
  },
  branches: {
    title: "Sucursales",
    description: "Organiza ubicaciones, alcances y comparativos sin perder control sobre el negocio completo.",
    plan: "NEGOCIO"
  },
  staff: {
    title: "Personal",
    description: "Gestiona quién opera el programa y mantén permisos claros entre caja, supervisión y control.",
    plan: "Base"
  },
  giftcards: {
    title: "Gift Cards",
    description: "Administra saldo, emisión y conciliación de tarjetas cuando el programa necesita una capa extra de valor.",
    plan: "NEGOCIO"
  },
  achievements: {
    title: "Logros",
    description: "Convierte comportamiento frecuente en objetivos visibles que empujen recurrencia sin ruido promocional.",
    plan: "EMPRESA"
  },
  challenges: {
    title: "Retos",
    description: "Crea campañas con objetivos claros para mover visitas, frecuencia y recompensas durante ventanas concretas.",
    plan: "EMPRESA"
  },
  referrals: {
    title: "Referidos",
    description: "Activa crecimiento orgánico con incentivos medidos y trazables para invitar nuevos clientes.",
    plan: "NEGOCIO"
  },
  operations: {
    title: "Operación",
    description: "Ajusta reglas, alertas y salvaguardas que sostienen el programa cuando ya está en marcha.",
    plan: "Base"
  },
  analytics: {
    title: "Analítica",
    description: "Lee ritmo, riesgo y retorno desde una vista de decisión, no como una pared de tarjetas compitiendo entre sí.",
    plan: "NEGOCIO"
  }
};

/**
 * @param {string} feature
 * @returns {string}
 */
export function requiredPlanLabel(feature) {
  return PLAN_LABELS[feature] || "";
}

function tabPresentation(tabName) {
  return TAB_PRESENTATION[tabName] || {
    title: "Panel",
    description: "Administra el programa desde una vista centralizada.",
    plan: "Base"
  };
}

/**
 * @param {AdminDashboardDependencies} deps
 * @returns {AdminDashboardApp}
 */
export function createAdminDashboardApp({ api, $, toast, alert, confirm, prompt }) {
  /** @type {DashboardState} */
  const state = {
    currentStaff: null,
    managerMode: false,
    planInfo: { plan: "", limits: {}, features: {} },
    branchCache: [],
    initialProgramLoad: Promise.resolve(),
    persistedBranchId: "",
    persistedActiveTab: ""
  };

  /** @type {Map<string, TabDefinition>} */
  const tabRegistry = new Map();
  const hooks = {
    /** @type {Set<DashboardHook>} */
    // Runs after staff is loaded, plan is loaded, and feature gates are applied.
    afterPlanReady: new Set(),
    /** @type {Set<BranchChangedHook>} */
    branchFilterChanged: new Set(),
    /** @type {Set<BranchesUpdatedHook>} */
    branchesUpdated: new Set()
  };

  /** @param {DashboardHook} fn */
  function onAfterPlanReady(fn) { hooks.afterPlanReady.add(fn); }
  /** @param {BranchChangedHook} fn */
  function onBranchFilterChanged(fn) { hooks.branchFilterChanged.add(fn); }
  /** @param {BranchesUpdatedHook} fn */
  function onBranchesUpdated(fn) { hooks.branchesUpdated.add(fn); }

  /**
   * @param {string} tabName
   * @param {TabDefinition} definition
   */
  function registerTab(tabName, { feature = null, allowManager = false, load }) {
    tabRegistry.set(tabName, { feature, allowManager, load });
  }

  function hasFeature(feature) {
    return Boolean(state.planInfo?.features?.[feature]);
  }

  function syncDashboardViewToUrl() {
    const activeTab = state.persistedActiveTab || currentActiveTabName();
    const branchId = state.persistedBranchId || "";
    syncDashboardView({ activeTab, branchId });
  }

  const branchFilter = createBranchFilter({
    $,
    state,
    syncDashboardViewToUrl,
    notifyBranchFilterChanged(branchId) {
      hooks.branchFilterChanged.forEach((fn) => fn(branchId));
    }
  });

  const tabController = createTabController({
    state,
    tabRegistry,
    hasFeature,
    syncDashboardViewToUrl,
    onTabActivated(tabName) {
      updateDashboardChrome(tabName);
    }
  });

  function safeColor(v, fallback = "#ddd") {
    const s = String(v || "").trim();
    return /^#[0-9a-fA-F]{3,8}$/.test(s) ? s : fallback;
  }

  function setSmallMessage(container, message) {
    container.replaceChildren();
    const p = document.createElement("p");
    p.className = "small";
    p.textContent = message;
    container.appendChild(p);
  }

  const {
    activateTab,
    applyFeatureGates,
    loadTabData,
    initTabClicks
  } = tabController;

  function selectedScopeLabel() {
    return branchFilter.selectedBranchLabel() || "Todo el negocio";
  }

  function selectedRoleLabel() {
    if (state.managerMode) return "Gerencia";
    if (!state.currentStaff?.role) return "Cargando…";
    return state.currentStaff.role === "OWNER" ? "Propietario" : state.currentStaff.role;
  }

  function planLabel() {
    const raw = String(state.planInfo?.plan || "").trim();
    return raw || "Base";
  }

  function businessLabel() {
    return (
      state.currentStaff?.businessName ||
      state.currentStaff?.business_name ||
      "Panel de control"
    );
  }

  function updateDashboardChrome(tabName = state.persistedActiveTab || currentActiveTabName() || "rewards") {
    const meta = tabPresentation(tabName);
    const businessName = $("#businessName");
    if (businessName) businessName.textContent = state.managerMode ? "Panel Gerente" : businessLabel();

    const overviewPlan = $("#adminOverviewPlan");
    if (overviewPlan) overviewPlan.textContent = planLabel();
    const overviewRole = $("#adminOverviewRole");
    if (overviewRole) overviewRole.textContent = selectedRoleLabel();
    const overviewTab = $("#adminOverviewTab");
    if (overviewTab) overviewTab.textContent = meta.title;
    const overviewScope = $("#adminOverviewScope");
    if (overviewScope) overviewScope.textContent = selectedScopeLabel();

    const workspaceTitle = $("#adminWorkspaceTitle");
    if (workspaceTitle) workspaceTitle.textContent = meta.title;
    const workspaceDesc = $("#adminWorkspaceDesc");
    if (workspaceDesc) workspaceDesc.textContent = meta.description;
    const stageTitle = $("#adminStageTitle");
    if (stageTitle) stageTitle.textContent = meta.title;
    const stageDesc = $("#adminStageDesc");
    if (stageDesc) stageDesc.textContent = meta.description;
    const stagePlan = $("#adminStagePlan");
    if (stagePlan) stagePlan.textContent = meta.plan;
    const stageScope = $("#adminStageScope");
    if (stageScope) stageScope.textContent = selectedScopeLabel();
  }

  function focusTab(tabName) {
    const tabEl = /** @type {HTMLElement | null} */ (document.querySelector(`.tab[data-tab="${tabName}"]`));
    if (!tabEl || tabEl.hidden) return;
    activateTab(tabName);
    loadTabData(tabName).catch(() => {});
  }

  function setBranches(next) {
    /** @type {DashboardBranch[]} */
    state.branchCache = Array.isArray(next) ? next : [];
    updateDashboardChrome();
    hooks.branchesUpdated.forEach((fn) => fn(state.branchCache));
  }

  function initBranchFilterEvents() {
    const sel = /** @type {HTMLSelectElement | null} */ ($("#branchFilter"));
    if (!sel) return;
    sel.addEventListener("change", () => {
      state.persistedBranchId = sel.value || "";
      syncDashboardViewToUrl();
      updateDashboardChrome();
      hooks.branchFilterChanged.forEach((fn) => fn(branchFilter.selectedBranchId()));
    });
  }

  function restoreDashboardViewFromUrl() {
    const restored = restoreDashboardView({
      $,
      persistedBranchId: state.persistedBranchId,
      activateTab
    });
    state.persistedBranchId = restored.branchId || restored.fallbackBranchId || "";
    state.persistedActiveTab = restored.activeTab || currentActiveTabName();
  }

  async function start() {
    initTabClicks();
    initBranchFilterEvents();
    initDashboardChrome({ api, $, toast, syncDashboardViewToUrl });
    $("#btnFocusRewards")?.addEventListener("click", () => focusTab("rewards"));
    $("#btnFocusAnalytics")?.addEventListener("click", () => focusTab("analytics"));
    $("#btnFocusStaff")?.addEventListener("click", () => focusTab("staff"));

    const ok = await loadStaffSession({ api, $, state });
    if (!ok) return;

    await loadPlanInfo(api, state);
    applyFeatureGates();
    restoreDashboardViewFromUrl();
    syncDashboardViewToUrl();
    updateDashboardChrome();
    for (const fn of hooks.afterPlanReady) {
      // Keep startup resilient: a non-critical widget shouldn't break the whole dashboard.
      // The underlying API calls are still validated server-side.
      try { await fn(); } catch {}
    }

    const activeTab = /** @type {HTMLElement | null} */ (document.querySelector(".tab.active"));
    if (activeTab) await loadTabData(activeTab.dataset.tab);

    async function refreshPlanAndUi() {
      try {
        await loadPlanInfo(api, state);
        applyFeatureGates();
      } catch {}
    }

    window.addEventListener("focus", refreshPlanAndUi);
    window.addEventListener("popstate", () => {
      restoreDashboardViewFromUrl();
      const activeTab = state.persistedActiveTab || currentActiveTabName();
      updateDashboardChrome(activeTab);
      if (activeTab) loadTabData(activeTab).catch(() => {});
      hooks.branchFilterChanged.forEach((fn) => fn(branchFilter.selectedBranchId()));
    });
    setInterval(refreshPlanAndUi, 30000);
  }

  return {
    api,
    $,
    toast,
    alert,
    confirm,
    prompt,
    state,
    registerTab,
    onAfterPlanReady,
    onBranchFilterChanged,
    onBranchesUpdated,
    hasFeature,
    selectedBranchId: branchFilter.selectedBranchId,
    branchQueryString: branchFilter.branchQueryString,
    selectedBranchLabel: branchFilter.selectedBranchLabel,
    applyBranchDrilldown: branchFilter.applyBranchDrilldown,
    requiredPlanLabel,
    safeColor,
    setSmallMessage,
    activateTab,
    loadTabData,
    applyFeatureGates,
    setBranches,
    updateDashboardChrome,
    start
  };
}
