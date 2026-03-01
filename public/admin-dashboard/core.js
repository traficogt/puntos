import {
  copyCurrentViewUrl,
  currentActiveTabName,
  restoreDashboardViewFromUrl as restoreDashboardView,
  syncDashboardViewToUrl as syncDashboardView
} from "./view-state.js";
import { createBranchFilter } from "./branch-filter.js";

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

  function activateTab(tabName, { syncUrl = true } = {}) {
    state.persistedActiveTab = tabName || "";
    /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll(".tab")).forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.tab === tabName);
    });
    /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll(".tab-content")).forEach((content) => {
      content.classList.toggle("active", content.id === `${tabName}-content`);
    });
    if (syncUrl) syncDashboardViewToUrl();
  }

  function setSectionVisibility(id, visible) {
    const el = document.getElementById(id);
    if (el) el.style.display = visible ? "" : "none";
  }

  function applyFeatureGates() {
    setSectionVisibility("ownerConfigCard", !state.managerMode);

    /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll(".tab")).forEach((tab) => {
      const tabName = String(tab.dataset.tab || "");
      const meta = tabRegistry.get(tabName);

      // Manager mode is an intentionally restricted view: gift cards only.
      if (state.managerMode) {
        const allowed = meta?.allowManager === true;
        tab.style.display = allowed ? "" : "none";
        const content = document.getElementById(`${tabName}-content`);
        if (content) content.style.display = allowed ? "" : "none";
        return;
      }

      const allowedByFeature = !meta?.feature || hasFeature(meta.feature);
      tab.style.display = allowedByFeature ? "" : "none";
      const content = document.getElementById(`${tabName}-content`);
      if (content) content.style.display = allowedByFeature ? "" : "none";
    });

    setSectionVisibility("campaignRulesSection", hasFeature("campaign_rules"));
    setSectionVisibility("externalAwardsSection", hasFeature("external_awards"));

    const currentActive = /** @type {HTMLElement | null} */ (document.querySelector(".tab.active"));
    const activeHidden = !currentActive || currentActive.style.display === "none";
    if (activeHidden) {
      const firstVisible = Array.from(/** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll(".tab")))
        .find((t) => t.style.display !== "none");
      if (firstVisible) activateTab(firstVisible.dataset.tab);
    }
  }

  async function loadPlanInfo() {
    const out = await api("/api/admin/plan");
    state.planInfo = {
      plan: out.plan || "",
      limits: out.limits || {},
      features: out.features || {}
    };
  }

  async function loadStaff() {
    try {
      const data = await api("/api/staff/me");
      state.currentStaff = data.staff;

      if (!["OWNER", "MANAGER"].includes(state.currentStaff.role)) {
        $("#needLogin").style.display = "block";
        return false;
      }
      state.managerMode = state.currentStaff.role === "MANAGER";
      $("#main").style.display = "block";
      $("#businessName").textContent = state.managerMode ? "Panel Gerente" : "Panel Admin";
      return true;
    } catch (_e) {
      $("#needLogin").style.display = "block";
      return false;
    }
  }

  async function loadTabData(tabName) {
    const meta = tabRegistry.get(tabName);
    if (!meta) return;
    if (state.managerMode && meta.allowManager !== true) return;
    if (meta.feature && !hasFeature(meta.feature)) return;
    await meta.load();
  }

  function setBranches(next) {
    /** @type {DashboardBranch[]} */
    state.branchCache = Array.isArray(next) ? next : [];
    hooks.branchesUpdated.forEach((fn) => fn(state.branchCache));
  }

  function initTabClicks() {
    /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll(".tab")).forEach((tab) => {
      tab.addEventListener("click", () => {
        if (tab.style.display === "none") return;
        tab.classList.add("active");
        const tabName = tab.dataset.tab;
        activateTab(tabName);
        loadTabData(tabName).catch(() => {});
      });
    });
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

    $("#btnShareView")?.addEventListener("click", async () => {
      try {
        await copyCurrentViewUrl(syncDashboardViewToUrl);
        toast("URL de la vista copiada.");
      } catch {
        toast("No se pudo copiar la URL de la vista.");
      }
    });

    $("#btnLogout").addEventListener("click", async () => {
      await api("/api/staff/logout", { method: "POST", body: "{}" }).catch(() => {});
      location.href = "/staff/login";
    });

    const ok = await loadStaff();
    if (!ok) return;

    await loadPlanInfo();
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
        await loadPlanInfo();
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

    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
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
