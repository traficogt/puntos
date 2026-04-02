/** @typedef {import("./types.js").DashboardState} DashboardState */
/** @typedef {import("./types.js").TabDefinition} TabDefinition */

/**
 * @param {{
 *   state: DashboardState,
 *   tabRegistry: Map<string, TabDefinition>,
 *   hasFeature: (feature: string) => boolean,
 *   syncDashboardViewToUrl: () => void,
 *   onTabActivated?: (tabName: string) => void
 * }} deps
 */
export function createTabController({ state, tabRegistry, hasFeature, syncDashboardViewToUrl, onTabActivated = () => {} }) {
  function setSectionVisibility(id, visible) {
    const el = document.getElementById(id);
    if (el) el.hidden = !visible;
  }

  function activateTab(tabName, { syncUrl = true } = {}) {
    state.persistedActiveTab = tabName || "";
    /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll(".tab")).forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.tab === tabName);
    });
    /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll(".tab-content")).forEach((content) => {
      content.classList.toggle("active", content.id === `${tabName}-content`);
    });
    onTabActivated(tabName);
    if (syncUrl) syncDashboardViewToUrl();
  }

  function applyFeatureGates() {
    setSectionVisibility("ownerConfigCard", !state.managerMode);

    /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll(".tab")).forEach((tab) => {
      const tabName = String(tab.dataset.tab || "");
      const meta = tabRegistry.get(tabName);

      if (state.managerMode) {
        const allowed = meta?.allowManager === true;
        tab.hidden = !allowed;
        const content = document.getElementById(`${tabName}-content`);
        if (content) content.hidden = !allowed;
        return;
      }

      const allowedByFeature = !meta?.feature || hasFeature(meta.feature);
      tab.hidden = !allowedByFeature;
      const content = document.getElementById(`${tabName}-content`);
      if (content) content.hidden = !allowedByFeature;
    });

    setSectionVisibility("campaignRulesSection", hasFeature("campaign_rules"));
    setSectionVisibility("externalAwardsSection", hasFeature("external_awards"));

    const currentActive = /** @type {HTMLElement | null} */ (document.querySelector(".tab.active"));
    const activeHidden = !currentActive || currentActive.hidden;
    if (activeHidden) {
      const firstVisible = Array.from(/** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll(".tab")))
        .find((tab) => !tab.hidden);
      if (firstVisible) activateTab(firstVisible.dataset.tab);
    }
  }

  async function loadTabData(tabName) {
    const meta = tabRegistry.get(tabName);
    if (!meta) return;
    if (state.managerMode && meta.allowManager !== true) return;
    if (meta.feature && !hasFeature(meta.feature)) return;
    await meta.load();
  }

  function initTabClicks() {
    /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll(".tab")).forEach((tab) => {
      tab.addEventListener("click", () => {
        if (tab.hidden) return;
        activateTab(tab.dataset.tab);
        loadTabData(tab.dataset.tab).catch(() => {});
      });
    });
  }

  return {
    activateTab,
    applyFeatureGates,
    loadTabData,
    initTabClicks
  };
}
