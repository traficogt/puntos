import test from "node:test";
import assert from "node:assert/strict";
import { pageFromHash, hashForPage, merchantPages } from "../src/navigation.js";
import { dailyNavigation, navigationGroups } from "../src/merchant-navigation.js";

const existingRoutes = {
  overview: "resumen", decisions: "decisiones", cases: "casos",
  demand: "pedidos-de-clientes", funding: "proveedores", authority: "equipo",
  hospitality: "cortesias", promises: "promesas", region: "region",
  transactions: "movimientos", launch: "preparar", migration: "importar-clientes",
  audiences: "audiencias", campaigns: "campanas", recovery: "recuperar-clientes",
  referrals: "referidos", pos: "conectar-caja", growth: "ofertas", brand: "marca",
  operations: "operacion", pilot: "piloto", acquisition: "origenes",
  economics: "costos", fulfillment: "canjes", rewards: "recompensas",
  automations: "automatizaciones",
};

test("the task catalog includes every existing and routable merchant page exactly once", () => {
  const entries = [...dailyNavigation, ...navigationGroups.flatMap(group => group.items)];
  assert.equal(entries.length, new Set(entries.map(item => item.page)).size, "Every page appears once");
  assert.deepEqual(entries.map(item => item.page).sort(), Object.keys(existingRoutes).sort());
  assert.deepEqual(entries.map(item => item.page).sort(), [...merchantPages].sort());
  assert.ok(entries.every(item => item.label.trim().length > 0));
  assert.deepEqual(dailyNavigation.map(item => item.page), ["overview", "decisions", "transactions", "fulfillment", "cases"]);
  assert.equal(navigationGroups.length, 4);
  assert.equal(new Set(navigationGroups.map(group => group.id)).size, navigationGroups.length);
  assert.ok(navigationGroups.every(group => group.label && group.items.length > 0));
});

test("all original Spanish fragments and legacy aliases remain compatible", () => {
  for (const [page, fragment] of Object.entries(existingRoutes)) {
    assert.equal(pageFromHash(`#${page}`), page);
    assert.equal(pageFromHash(`#${fragment}`), page);
    assert.equal(hashForPage(page), `#${fragment}`);
  }
  assert.equal(pageFromHash(""), "overview");
  assert.equal(pageFromHash("#unknown"), null);
});
