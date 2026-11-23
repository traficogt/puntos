/* eslint-disable no-script-url -- Deliberately unsafe incident links must be rejected. */
import test from "node:test";
import assert from "node:assert/strict";
import { projectStatus, safeIncidentUrl } from "../../public/status/status-model.js";

const now = Date.parse("2026-11-16T12:00:00Z");
const component = (id, state = "up", checkedAt = new Date(now - 60000).toISOString()) => ({
  id,
  state,
  checkedAt,
});
const snapshot = (components) => ({
  version: 1,
  generatedAt: new Date(now).toISOString(),
  components,
  incidents: [],
  incidentsCheckedAt: new Date(now).toISOString(),
});
const all = () => ["sitio", "acceso", "sistema", "ayuda", "soporte"].map((id) => component(id));

test("only complete fresh observations establish measured availability", () => {
  assert.equal(projectStatus(snapshot(all()), now).state, "up");
  assert.equal(projectStatus(snapshot([component("sitio")]), now).state, "unknown");
  assert.equal(projectStatus(null, now).state, "unknown");
});
test("stale, missing, malformed and future observations cannot remain green", () => {
  for (const date of [
    new Date(now - 21 * 60000).toISOString(),
    null,
    "invalid",
    new Date(now + 120000).toISOString(),
  ]) {
    const rows = all();
    rows[0].checkedAt = date;
    const view = projectStatus(snapshot(rows), now);
    assert.equal(view.components[0].state, "unknown");
    assert.equal(view.state, "unknown");
  }
});
test("confirmed down takes priority over missing observations; old down is unknown", () => {
  assert.equal(projectStatus(snapshot([component("sitio", "down")]), now).state, "down");
  assert.equal(
    projectStatus(
      snapshot([component("sitio", "down", new Date(now - 86400000).toISOString())]),
      now,
    ).state,
    "unknown",
  );
});
test("degraded observations are distinguished from complete outage", () => {
  const rows = all();
  rows[1].state = "degraded";
  assert.equal(projectStatus(snapshot(rows), now).state, "degraded");
});
test("unexpected component, state and duplicate records are not trusted", () => {
  const rows = all();
  rows[0].state = "all-good";
  assert.equal(projectStatus(snapshot(rows), now).components[0].state, "unknown");
  assert.equal(
    projectStatus(snapshot([...all(), component("sitio", "down")]), now).components[0].state,
    "unknown",
  );
  assert.equal(projectStatus(snapshot([component("secret-tenant")]), now).components.length, 5);
});
test("unsupported versions and invalid clocks fail closed", () => {
  assert.equal(projectStatus({ ...snapshot(all()), version: 2 }, now).state, "unknown");
  assert.equal(projectStatus(snapshot(all()), NaN).state, "unknown");
});
test("incident links are limited to this public monitoring repository", () => {
  assert.equal(
    safeIncidentUrl("https://github.com/traficogt/puntos-estado/issues/12"),
    "https://github.com/traficogt/puntos-estado/issues/12",
  );
  for (const value of [
    "javascript:alert(1)",
    "https://evil.example/",
    "https://github.com/traficogt/puntos/issues/12",
    "https://github.com/traficogt/puntos-estado/issues/1?token=secret",
  ])
    assert.equal(safeIncidentUrl(value), null);
});
test("incident display has bounded public fields and identifies an unavailable incident feed", () => {
  const data = snapshot(all());
  data.incidents = [
    {
      title: "x".repeat(900),
      body: "y".repeat(9000),
      url: "javascript:bad",
      openedAt: new Date(now).toISOString(),
      state: "open",
      privateNote: "never",
    },
  ];
  data.incidentsCheckedAt = null;
  const view = projectStatus(data, now);
  assert.equal(view.incidentsFresh, false);
  assert.equal(view.incidents[0].title.length, 180);
  assert.equal(view.incidents[0].body.length, 1800);
  assert.equal(view.incidents[0].url, null);
  assert.equal("privateNote" in view.incidents[0], false);
});
