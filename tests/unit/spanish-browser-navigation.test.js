import test from "node:test";
import assert from "node:assert/strict";
import { readDashboardViewFromUrl, syncDashboardViewToUrl } from "../../public/admin-dashboard/view-state.js";

test("Spanish administration URLs read legacy views and write Spanish query names without losing unrelated values", () => {
  const previous = globalThis.window;
  let written;
  globalThis.window = /** @type {any} */ ({ location: { pathname: "/administracion/", search: "?tab=rewards&branch_id=branch-a&token=preservado", hash: "#detalle" }, history: { replaceState: (_state, _unused, url) => { written = url; } } });
  try {
    assert.deepEqual(readDashboardViewFromUrl(), { tab: "rewards", branchId: "branch-a" });
    syncDashboardViewToUrl({ activeTab: "analytics", branchId: "branch-b" });
    const url = new URL(written, "https://example.test");
    assert.equal(url.searchParams.get("seccion"), "analisis");
    assert.equal(url.searchParams.get("sucursal"), "branch-b");
    assert.equal(url.searchParams.get("token"), "preservado");
    assert.equal(url.searchParams.has("tab"), false);
    assert.equal(url.searchParams.has("branch_id"), false);
    assert.equal(url.hash, "#detalle");
    window.location.search = "?seccion=tarjetas-regalo&sucursal=branch-c";
    assert.deepEqual(readDashboardViewFromUrl(), { tab: "giftcards", branchId: "branch-c" });
    syncDashboardViewToUrl({});
    assert.equal(new URL(written, "https://example.test").search, "");
  } finally { globalThis.window = previous; }
});
