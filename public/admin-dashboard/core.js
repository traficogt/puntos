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
    syncDashboardViewToUrl
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

  function setBranches(next) {
    /** @type {DashboardBranch[]} */
    state.branchCache = Array.isArray(next) ? next : [];
    hooks.branchesUpdated.forEach((fn) => fn(state.branchCache));
  }

  function initBranchFilterEvents() {
    const sel = /** @type {HTMLSelectElement | null} */ ($("#branchFilter"));
    if (!sel) return;
    sel.addEventListener("change", () => {
      state.persistedBranchId = sel.value || "";
      syncDashboardViewToUrl();
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

    const ok = await loadStaffSession({ api, $, state });
    if (!ok) return;

    await loadPlanInfo(api, state);
    applyFeatureGates();
    restoreDashboardViewFromUrl();
    syncDashboardViewToUrl();
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
    safeColor,
    setSmallMessage,
    activateTab,
    loadTabData,
    applyFeatureGates,
    setBranches,
    start
  };
}
