/** @typedef {import("./types.js").DashboardState} DashboardState */
/** @typedef {import("./types.js").QueryFn} QueryFn */

/**
 * @param {{
 *   $: QueryFn,
 *   state: DashboardState,
 *   syncDashboardViewToUrl: () => void,
 *   notifyBranchFilterChanged: (branchId: string) => void
 * }} deps
 */
export function createBranchFilter({ $, state, syncDashboardViewToUrl, notifyBranchFilterChanged }) {
  function selectedBranchId() {
    const el = /** @type {HTMLSelectElement | null} */ ($("#branchFilter"));
    return el ? (el.value || state.persistedBranchId || "") : (state.persistedBranchId || "");
  }

  function branchQueryString() {
    const id = selectedBranchId();
    return id ? `branch_id=${encodeURIComponent(id)}` : "";
  }

  function selectedBranchLabel() {
    const id = selectedBranchId();
    if (!id) return "Todas las sucursales";
    const found = state.branchCache.find((branch) => branch.id === id);
    if (!found) return "Sucursal filtrada";
    return found.code ? `${found.name} (${found.code})` : found.name;
  }

  async function applyBranchDrilldown(branchId) {
    const sel = /** @type {HTMLSelectElement | null} */ ($("#branchFilter"));
    state.persistedBranchId = branchId || "";
    if (!sel) {
      syncDashboardViewToUrl();
      notifyBranchFilterChanged(selectedBranchId());
      return;
    }
    sel.value = branchId || "";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  }

  return {
    selectedBranchId,
    branchQueryString,
    selectedBranchLabel,
    applyBranchDrilldown
  };
}
