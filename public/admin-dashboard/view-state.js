const sectionNames = new Map(Object.entries({ rewards: "recompensas", branding: "marca", tiers: "niveles", branches: "sucursales", staff: "equipo", giftcards: "tarjetas-regalo", achievements: "logros", challenges: "retos", referrals: "referidos", operations: "operaciones", analytics: "analisis" }));
function readSection(value) {
  return Array.from(sectionNames).find(([, spanish]) => spanish === value)?.[0] || value;
}
/** @typedef {import("./types.js").ActivateTab} ActivateTab */
/** @typedef {import("./types.js").QueryFn} QueryFn */
/** @typedef {import("./types.js").RestoredDashboardView} RestoredDashboardView */
/** @typedef {import("./types.js").SyncViewArgs} SyncViewArgs */

export function readDashboardViewFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return {
    tab: readSection(params.get("seccion") || params.get("tab") || ""),
    branchId: params.get("sucursal") || params.get("branch_id") || ""
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

  params.delete("tab");
  params.delete("branch_id");
  if (activeTab) params.set("seccion", sectionNames.get(activeTab) || activeTab);
  else params.delete("seccion");

  if (branchId) params.set("sucursal", branchId);
  else params.delete("sucursal");

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
  input.className = "copy-buffer";
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
      .find((el) => el.dataset.tab === tab && !el.hidden);
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
