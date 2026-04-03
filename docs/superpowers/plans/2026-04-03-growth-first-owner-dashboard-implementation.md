# Growth-First Owner Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reframe `/admin-dashboard` into a growth-first owner console with a KPI-led executive summary, short narrative, suggested actions, and subordinate drill-down navigation built on the existing analytics data.

**Architecture:** Keep the current dashboard shell, tabs, fragments, and analytics endpoints, but add a new summary layer above the existing detailed surfaces. The new summary content should be synthesized in the admin dashboard client from existing analytics responses, while the current tab rail and detailed modules remain reachable and gated exactly as before.

**Tech Stack:** Static HTML, modular browser JavaScript, existing admin dashboard modules, existing admin analytics endpoints, Node.js contract tests, ESLint.

---

## File Structure

### Existing files to modify

- `public/admin-dashboard.html`
  - Add the new growth-summary layer above the current tab rail and stage panel.
- `public/styles/admin-dashboard-premium.css`
  - Add the summary board, narrative block, action strip, and subordinate-rail styling.
- `public/admin-dashboard/core.js`
  - Update dashboard chrome behavior so the new executive layer stays in sync with branch scope, plan, and active area.
- `public/admin-dashboard/modules/analytics/dashboard.js`
  - Load analytics data once, render the executive summary layer, and keep the existing analytics render path intact.
- `tests/unit/admin-dashboard-shell-contract.test.js`
  - Expand shell contracts to cover the new growth-summary structure.

### New files to create

- `public/admin-dashboard/modules/analytics/executive-summary.js`
  - Summarize existing analytics payloads into KPI cards, short Spanish narrative, and suggested actions.
- `tests/unit/admin-dashboard-growth-summary-contract.test.js`
  - Contract-test the new summary layer markers, KPI board, narrative, and action block.

### Existing files to keep behaviorally unchanged

- `public/admin-dashboard/fragments/analytics.html`
  - Keep the existing analytics detail area reachable and gated.
- `public/admin-dashboard/fragments/program.html`
  - Keep plan-gated packaging language intact.
- `tests/unit/admin-dashboard-plan-gating-copy.test.js`
  - Re-run unchanged to ensure the growth-first redesign does not regress feature-gating messaging.

## Task 1: Add failing contracts for the growth-first summary layer

**Files:**
- Create: `tests/unit/admin-dashboard-growth-summary-contract.test.js`
- Modify: `tests/unit/admin-dashboard-shell-contract.test.js`
- Verify against: `public/admin-dashboard.html`

- [ ] **Step 1: Write the failing growth-summary contract test**

```js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const htmlPath = path.join(process.cwd(), "public/admin-dashboard.html");

test("admin dashboard exposes a growth-first executive summary layer", () => {
  const html = fs.readFileSync(htmlPath, "utf8");

  assert.match(html, /admin-growth-summary/);
  assert.match(html, /id="adminGrowthBoard"/);
  assert.match(html, /id="adminExecutiveNarrative"/);
  assert.match(html, /id="adminSuggestedActions"/);
  assert.match(html, /admin-detail-band/);
});
```

- [ ] **Step 2: Expand the existing shell contract to make the tab rail secondary rather than primary**

```js
test("admin dashboard shell keeps the detailed rail secondary to the executive summary", () => {
  const html = fs.readFileSync(htmlPath, "utf8");

  const summaryIndex = html.indexOf("admin-growth-summary");
  const railIndex = html.indexOf("admin-tab-rail");

  assert.notEqual(summaryIndex, -1);
  assert.notEqual(railIndex, -1);
  assert.ok(summaryIndex < railIndex);
});
```

- [ ] **Step 3: Run the focused tests to verify they fail**

Run:

```bash
node --test tests/unit/admin-dashboard-shell-contract.test.js tests/unit/admin-dashboard-growth-summary-contract.test.js
```

Expected:
- FAIL because `admin-growth-summary`, `adminGrowthBoard`, `adminExecutiveNarrative`, and `adminSuggestedActions` do not exist yet.

- [ ] **Step 4: Commit the failing test scaffolding**

```bash
git add tests/unit/admin-dashboard-shell-contract.test.js tests/unit/admin-dashboard-growth-summary-contract.test.js
git commit -m "test: define owner dashboard growth summary contracts"
```

## Task 2: Build the growth-first summary shell and subordinate drill-down layout

**Files:**
- Modify: `public/admin-dashboard.html`
- Modify: `public/styles/admin-dashboard-premium.css`
- Test: `tests/unit/admin-dashboard-shell-contract.test.js`
- Test: `tests/unit/admin-dashboard-growth-summary-contract.test.js`

- [ ] **Step 1: Add the summary layer markup above the current tab rail**

Insert a new section inside `#main`, after the existing `admin-command-deck` and before `#dashboardProgramHost`:

```html
<section class="admin-growth-summary card" id="adminGrowthSummary">
  <div class="admin-growth-summary-head">
    <div>
      <p class="section-kicker">Resumen ejecutivo</p>
      <h2>Lo que el programa está moviendo hoy</h2>
      <p class="lede">Clientes, recurrencia, retorno y riesgo en una vista pensada para decidir rápido.</p>
    </div>
    <div class="admin-growth-scope">
      <span>Alcance actual</span>
      <strong id="adminGrowthScope">Todo el negocio</strong>
    </div>
  </div>

  <div class="admin-growth-board" id="adminGrowthBoard">
    <article class="admin-kpi-card">
      <span>Clientes activos</span>
      <strong id="adminKpiActiveCustomers">--</strong>
      <small id="adminKpiActiveCustomersDelta">Sin datos aún</small>
    </article>
    <article class="admin-kpi-card">
      <span>Clientes nuevos</span>
      <strong id="adminKpiNewCustomers">--</strong>
      <small id="adminKpiNewCustomersDelta">Sin datos aún</small>
    </article>
    <article class="admin-kpi-card">
      <span>Frecuencia</span>
      <strong id="adminKpiPurchaseFrequency">--</strong>
      <small id="adminKpiPurchaseFrequencyDelta">Sin datos aún</small>
    </article>
    <article class="admin-kpi-card">
      <span>Retención</span>
      <strong id="adminKpiRetention">--</strong>
      <small id="adminKpiRetentionDelta">Sin datos aún</small>
    </article>
    <article class="admin-kpi-card">
      <span>Ingreso atribuido</span>
      <strong id="adminKpiAttributedRevenue">--</strong>
      <small id="adminKpiAttributedRevenueDelta">Sin datos aún</small>
    </article>
    <article class="admin-kpi-card">
      <span>ROI / costo</span>
      <strong id="adminKpiRoi">--</strong>
      <small id="adminKpiRoiDelta">Sin datos aún</small>
    </article>
  </div>

  <div class="admin-executive-grid">
    <article class="admin-executive-card">
      <span class="admin-brief-label">Narrativa ejecutiva</span>
      <p id="adminExecutiveNarrative">Cargando resumen del programa…</p>
    </article>
    <article class="admin-executive-card">
      <span class="admin-brief-label">Acciones sugeridas</span>
      <ul id="adminSuggestedActions" class="admin-suggested-actions">
        <li>Preparando acciones…</li>
      </ul>
    </article>
  </div>
</section>
```

- [ ] **Step 2: Add visual styles that make the summary dominant and the rail secondary**

Add to `public/styles/admin-dashboard-premium.css`:

```css
.page-admin .admin-growth-summary {
  padding: 1.5rem;
  margin-bottom: 1.25rem;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background:
    radial-gradient(circle at top left, rgba(214, 172, 96, 0.13), transparent 38%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.035), rgba(255, 255, 255, 0.015));
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.24);
}

.page-admin .admin-growth-board {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 12px;
  margin-top: 1.25rem;
}

.page-admin .admin-kpi-card {
  padding: 1rem;
  border-radius: 20px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(8, 11, 16, 0.58);
}

.page-admin .admin-kpi-card strong {
  display: block;
  margin-top: 0.45rem;
  font-family: var(--display-font);
  font-size: clamp(1.6rem, 2vw, 2.25rem);
  color: var(--headline);
}

.page-admin .admin-executive-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(280px, 0.9fr);
  gap: 18px;
  margin-top: 1rem;
}
```

- [ ] **Step 3: Add responsive styles so the summary board collapses cleanly on smaller screens**

Add to the existing media queries:

```css
@media (max-width: 1100px) {
  .page-admin .admin-growth-board,
  .page-admin .admin-executive-grid {
    grid-template-columns: 1fr 1fr;
  }
}

@media (max-width: 720px) {
  .page-admin .admin-growth-summary {
    padding: 1.1rem;
  }

  .page-admin .admin-growth-board,
  .page-admin .admin-executive-grid {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 4: Run the focused shell tests to verify they pass**

Run:

```bash
node --test tests/unit/admin-dashboard-shell-contract.test.js tests/unit/admin-dashboard-growth-summary-contract.test.js
```

Expected:
- PASS for the new executive-summary shell markers and shell ordering contracts.

- [ ] **Step 5: Commit the summary shell**

```bash
git add public/admin-dashboard.html public/styles/admin-dashboard-premium.css tests/unit/admin-dashboard-shell-contract.test.js tests/unit/admin-dashboard-growth-summary-contract.test.js
git commit -m "feat: add growth summary shell to owner dashboard"
```

## Task 3: Add executive-summary synthesis from existing analytics data

**Files:**
- Create: `public/admin-dashboard/modules/analytics/executive-summary.js`
- Modify: `public/admin-dashboard/modules/analytics/dashboard.js`
- Test: `tests/unit/admin-dashboard-growth-summary-contract.test.js`

- [ ] **Step 1: Write a failing unit contract for executive-summary rendering markers**

Append a second test to `tests/unit/admin-dashboard-growth-summary-contract.test.js`:

```js
const analyticsDashboardPath = path.join(process.cwd(), "public/admin-dashboard/modules/analytics/dashboard.js");
const executiveSummaryPath = path.join(process.cwd(), "public/admin-dashboard/modules/analytics/executive-summary.js");

test("analytics dashboard delegates executive summary rendering to a dedicated module", () => {
  const dashboardJs = fs.readFileSync(analyticsDashboardPath, "utf8");
  const summaryJs = fs.readFileSync(executiveSummaryPath, "utf8");

  assert.match(dashboardJs, /renderExecutiveSummary/);
  assert.match(summaryJs, /export function renderExecutiveSummary/);
  assert.match(summaryJs, /adminExecutiveNarrative/);
  assert.match(summaryJs, /adminSuggestedActions/);
});
```

- [ ] **Step 2: Create the executive-summary renderer with deterministic KPI, narrative, and action helpers**

Create `public/admin-dashboard/modules/analytics/executive-summary.js`:

```js
function formatMetric(value, fallback = "--") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

function setText($, selector, value) {
  const node = $(selector);
  if (node) node.textContent = value;
}

function buildNarrative({ summary, roiReport, churnData }) {
  const active = Number(summary?.active_customers || 0);
  const joined = Number(summary?.new_customers || 0);
  const churnRisk = Array.isArray(churnData?.customers) ? churnData.customers.length : 0;

  if (active > 0 && joined > 0) {
    return `El programa mantiene ${active} clientes activos y sumó ${joined} nuevos clientes en el período.`;
  }
  if (churnRisk > 0) {
    return `Hay ${churnRisk} clientes con señales de fuga; conviene revisar retención antes de activar nuevas campañas.`;
  }
  return "Todavía no hay suficiente señal para resumir crecimiento con confianza.";
}

function buildActions({ churnData, alertsCenter }) {
  const actions = [];
  if (Array.isArray(churnData?.customers) && churnData.customers.length > 0) {
    actions.push("Revisar clientes con riesgo de fuga y definir una acción de reactivación.");
  }
  if (Array.isArray(alertsCenter?.items) && alertsCenter.items.length > 0) {
    actions.push("Atender alertas operativas antes de leer el crecimiento como saludable.");
  }
  if (!actions.length) {
    actions.push("Validar el comportamiento de recompensas y confirmar que el programa siga impulsando recurrencia.");
  }
  return actions.slice(0, 3);
}

export function renderExecutiveSummary({ $, summary, roiReport, churnData, alertsCenter, branchLabel }) {
  setText($, "#adminGrowthScope", branchLabel || "Todo el negocio");
  setText($, "#adminKpiActiveCustomers", formatMetric(summary?.active_customers));
  setText($, "#adminKpiNewCustomers", formatMetric(summary?.new_customers));
  setText($, "#adminKpiPurchaseFrequency", formatMetric(summary?.purchase_frequency));
  setText($, "#adminKpiRetention", formatMetric(summary?.retention_rate));
  setText($, "#adminKpiAttributedRevenue", formatMetric(summary?.attributed_revenue));
  setText($, "#adminKpiRoi", formatMetric(roiReport?.roi || summary?.roi));
  setText($, "#adminExecutiveNarrative", buildNarrative({ summary, roiReport, churnData }));

  const actionsNode = $("#adminSuggestedActions");
  if (actionsNode) {
    actionsNode.replaceChildren(...buildActions({ churnData, alertsCenter }).map((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      return li;
    }));
  }
}
```

- [ ] **Step 3: Call the executive-summary renderer from the analytics dashboard load path**

Modify `public/admin-dashboard/modules/analytics/dashboard.js`:

```js
import { renderExecutiveSummary } from "./executive-summary.js";

// inside loadAnalytics(), after the dashboard and support data are loaded:
renderExecutiveSummary({
  $,
  summary: dashboard.summary || {},
  roiReport: null,
  churnData,
  alertsCenter: null,
  branchLabel: app.selectedBranchLabel()
});
```

Then refine the `loadAnalytics()` sequence so ROI and alerts results are captured instead of discarded:

```js
const [roiReport, alertsCenter] = await Promise.all([
  loadRoiReport(),
  loadAlertsCenter()
]);

renderExecutiveSummary({
  $,
  summary: dashboard.summary || {},
  roiReport,
  churnData,
  alertsCenter,
  branchLabel: app.selectedBranchLabel()
});
```

- [ ] **Step 4: Run the growth-summary tests to verify they pass**

Run:

```bash
node --test tests/unit/admin-dashboard-growth-summary-contract.test.js
```

Expected:
- PASS with the new renderer module and call site present.

- [ ] **Step 5: Commit the executive-summary synthesis layer**

```bash
git add public/admin-dashboard/modules/analytics/executive-summary.js public/admin-dashboard/modules/analytics/dashboard.js tests/unit/admin-dashboard-growth-summary-contract.test.js
git commit -m "feat: synthesize executive growth summary from analytics"
```

## Task 4: Keep dashboard chrome, scope, and action shortcuts aligned with the new summary layer

**Files:**
- Modify: `public/admin-dashboard/core.js`
- Modify: `public/admin-dashboard.html`
- Modify: `public/styles/admin-dashboard-premium.css`
- Test: `tests/unit/admin-dashboard-shell-contract.test.js`
- Test: `tests/unit/admin-dashboard-plan-gating-copy.test.js`

- [ ] **Step 1: Add a focused shell contract for executive summary chrome sync**

Add to `tests/unit/admin-dashboard-shell-contract.test.js`:

```js
test("admin dashboard core keeps the executive summary scope in sync with the selected branch", () => {
  const core = fs.readFileSync(corePath, "utf8");

  assert.match(core, /adminGrowthScope/);
  assert.match(core, /selectedScopeLabel\(\)/);
  assert.match(core, /updateDashboardChrome/);
});
```

- [ ] **Step 2: Update the core chrome sync so the executive summary scope stays current**

Modify `public/admin-dashboard/core.js` inside `updateDashboardChrome()`:

```js
const growthScope = $("#adminGrowthScope");
if (growthScope) growthScope.textContent = selectedScopeLabel();
```

Keep the rest of `updateDashboardChrome()` intact so:
- plan label still renders
- role still renders
- stage/title copy still updates with active tab

- [ ] **Step 3: Reframe the existing command-deck copy so it supports, rather than competes with, the new growth summary**

Update the primary lede and action labels in `public/admin-dashboard.html`:

```html
<p class="lede admin-lede">Crecimiento, retorno y decisiones del programa en una sola vista. La operación diaria sigue viviendo en el flujo de staff; aquí se interpreta el negocio.</p>

<div class="admin-command-actions">
  <button type="button" class="primary" id="btnFocusAnalytics">Abrir crecimiento</button>
  <button type="button" id="btnFocusRewards">Ajustar recompensas</button>
  <button type="button" id="btnFocusStaff">Revisar operación</button>
</div>
```

- [ ] **Step 4: Tone down the visual weight of the tab rail so it reads as drill-down navigation**

Update the tab rail styles in `public/styles/admin-dashboard-premium.css`:

```css
.page-admin .admin-tab-group {
  background: rgba(10, 14, 21, 0.72);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.18);
}

.page-admin .admin-tab-group .tab {
  color: rgba(238, 241, 244, 0.82);
}

.page-admin .admin-tab-group .tab.active {
  border-color: rgba(214, 172, 96, 0.22);
  background: linear-gradient(180deg, rgba(214, 172, 96, 0.13), rgba(214, 172, 96, 0.06));
}
```

- [ ] **Step 5: Run the dashboard shell and gating tests**

Run:

```bash
node --test tests/unit/admin-dashboard-shell-contract.test.js tests/unit/admin-dashboard-plan-gating-copy.test.js
```

Expected:
- PASS, with the new scope sync marker present and plan-gating copy unchanged.

- [ ] **Step 6: Commit the chrome and hierarchy refinements**

```bash
git add public/admin-dashboard.html public/admin-dashboard/core.js public/styles/admin-dashboard-premium.css tests/unit/admin-dashboard-shell-contract.test.js
git commit -m "feat: align owner dashboard chrome with growth summary"
```

## Task 5: Run full verification for the owner dashboard pass

**Files:**
- Verify: `public/admin-dashboard.html`
- Verify: `public/admin-dashboard/core.js`
- Verify: `public/admin-dashboard/modules/analytics/dashboard.js`
- Verify: `public/admin-dashboard/modules/analytics/executive-summary.js`
- Verify: `public/styles/admin-dashboard-premium.css`
- Verify: `tests/unit/admin-dashboard-shell-contract.test.js`
- Verify: `tests/unit/admin-dashboard-growth-summary-contract.test.js`
- Verify: `tests/unit/admin-dashboard-plan-gating-copy.test.js`

- [ ] **Step 1: Run the focused owner dashboard tests**

Run:

```bash
node --test tests/unit/admin-dashboard-shell-contract.test.js tests/unit/admin-dashboard-growth-summary-contract.test.js tests/unit/admin-dashboard-plan-gating-copy.test.js
```

Expected:
- PASS for shell contracts, growth-summary contracts, and packaging/gating copy.

- [ ] **Step 2: Run lint to catch JS and HTML/CSS contract regressions**

Run:

```bash
npm run lint
```

Expected:
- PASS with no new lint errors.

- [ ] **Step 3: Run the broader unit suite to ensure the dashboard pass did not break adjacent surfaces**

Run:

```bash
npm run test:unit
```

Expected:
- PASS, including the updated admin dashboard contracts.

- [ ] **Step 4: Commit the verified owner dashboard pass**

```bash
git add public/admin-dashboard.html public/admin-dashboard/core.js public/admin-dashboard/modules/analytics/dashboard.js public/admin-dashboard/modules/analytics/executive-summary.js public/styles/admin-dashboard-premium.css tests/unit/admin-dashboard-shell-contract.test.js tests/unit/admin-dashboard-growth-summary-contract.test.js tests/unit/admin-dashboard-plan-gating-copy.test.js
git commit -m "feat: add growth-first owner dashboard summary"
```

## Self-Review

- Spec coverage:
  - growth-first KPI board: covered in Tasks 1-3
  - narrative block: covered in Tasks 1-3
  - suggested actions: covered in Tasks 1-3
  - subordinate drill-down navigation: covered in Tasks 2 and 4
  - preserve existing analytics endpoints and plan gating: covered in Tasks 3-5
- Placeholder scan:
  - no `TODO`, `TBD`, or “implement later” markers remain
  - every task includes exact files, commands, and concrete code snippets
- Type consistency:
  - `renderExecutiveSummary`, `adminGrowthScope`, `adminExecutiveNarrative`, and `adminSuggestedActions` are defined consistently across the tasks
