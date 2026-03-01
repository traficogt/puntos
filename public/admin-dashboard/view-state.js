/** @typedef {import("./types.js").ActivateTab} ActivateTab */
/** @typedef {import("./types.js").QueryFn} QueryFn */
/** @typedef {import("./types.js").RestoredDashboardView} RestoredDashboardView */
/** @typedef {import("./types.js").SyncViewArgs} SyncViewArgs */

export function readDashboardViewFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return {
    tab: params.get("tab") || "",
    branchId: params.get("branch_id") || ""
  };
}

export function currentActiveTabName() {
  return (/** @type {HTMLElement | null} */ (document.querySelector(".tab.active"))?.dataset.tab) || "";
}

/**
 * @param {SyncViewArgs} view
 */
export function syncDashboardViewToUrl({ activeTab = "", branchId = "" }) {
  const params = new URLSearchParams(window.location.search);

  if (activeTab) params.set("tab", activeTab);
  else params.delete("tab");

  if (branchId) params.set("branch_id", branchId);
  else params.delete("branch_id");

  const query = params.toString();
  const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash || ""}`;
  window.history.replaceState(null, "", nextUrl);
}

/**
 * @param {() => void} syncUrl
 */
export async function copyCurrentViewUrl(syncUrl) {
  syncUrl();
  const url = window.location.href;
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(url);
    return;
  }

  const input = document.createElement("textarea");
  input.value = url;
  input.setAttribute("readonly", "readonly");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  document.execCommand("copy");
  input.remove();
}

/**
 * @param {{ $: QueryFn, persistedBranchId: string, activateTab: ActivateTab }} deps
 * @returns {RestoredDashboardView}
 */
export function restoreDashboardViewFromUrl({ $, persistedBranchId, activateTab }) {
  const { tab, branchId } = readDashboardViewFromUrl();
  const nextBranchId = branchId || "";

  const sel = /** @type {HTMLSelectElement | null} */ ($("#branchFilter"));
  if (sel) sel.value = nextBranchId;

  if (tab) {
    const targetTab = Array.from(/** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll(".tab")))
      .find((el) => el.dataset.tab === tab && el.style.display !== "none");
    if (targetTab) {
      activateTab(tab, { syncUrl: false });
      return { branchId: nextBranchId, activeTab: tab };
    }
  }

  return {
    branchId: nextBranchId,
    activeTab: currentActiveTabName(),
    fallbackBranchId: persistedBranchId || ""
  };
}
