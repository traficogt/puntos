# Staff Surface Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refine `/staff` into a customer-dominant in-store surface with clearer hierarchy, clearer ready states, and stronger in-context feedback while preserving the current select-then-award/redeem workflow.

**Architecture:** Keep the existing staff flow and endpoints intact. Recompose the page around a two-column primary workspace, elevate the selected-customer summary into the dominant panel, and move action/status feedback into the working surface instead of relying only on toasts. Preserve the current `public/staff/index.js` selection, award, and redeem model.

**Tech Stack:** Static HTML, modular browser JavaScript, shared app CSS, Node test runner, existing contract tests.

---

## File Structure

### Existing files to modify

- `public/staff.html`
  - Rework the main staff shell hierarchy.
  - Add explicit customer-summary and in-surface status regions.
  - Reduce equal-weight cards in the primary workspace.
- `public/staff/index.js`
  - Drive the new selected-customer summary and inline working-state messaging.
  - Keep award/redeem logic unchanged at the API level.
  - Refresh in-surface state after selection, award, and redeem.
- `public/styles/pages.css`
  - Add layout and visual hierarchy styles for the polished `/staff` workspace.
  - Keep secondary sections visually quieter than the active customer workspace.
- `tests/unit/staff-flow-contract.test.js`
  - Update shell assertions for the new hierarchy markers.
- `tests/unit/staff-redeem-flow-contract.test.js`
  - Keep enforcing explicit customer selection and staff flow invariants while checking new shell cues.

### New tests to create

- `tests/unit/staff-surface-polish-contract.test.js`
  - Cover the customer-dominant layout markers and the new ready/empty state strings.

## Task 1: Lock the new shell contract first

**Files:**
- Create: `tests/unit/staff-surface-polish-contract.test.js`
- Modify: `tests/unit/staff-flow-contract.test.js`
- Modify: `tests/unit/staff-redeem-flow-contract.test.js`

- [ ] **Step 1: Write the failing layout-contract test**

```js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function readStaffHtml() {
  return fs.readFileSync(new URL("../../public/staff.html", import.meta.url), "utf8");
}

test("staff shell centers the active customer above the action rail", () => {
  const html = readStaffHtml();

  assert.match(html, /staff-primary-workspace/, "expected a dedicated primary workspace wrapper");
  assert.match(html, /Cliente activo/, "expected dominant selected-customer heading");
  assert.match(html, /Cliente listo/, "expected explicit ready-state copy");
  assert.match(html, /Escanea o ingresa el código del cliente para continuar\./, "expected explicit pre-selection guidance");
  assert.match(html, /staff-action-rail/, "expected shared award\/redeem action rail");
});
```

- [ ] **Step 2: Tighten the existing staff contracts around the new hierarchy**

```js
test("staff shell still requires customer selection before actions", () => {
  const html = readStaffShellHtml();

  assert.match(html, /Seleccionar cliente/, "expected selection area to remain explicit");
  assert.match(html, /Cliente activo/, "expected selected-customer summary to be primary");
  assert.match(html, /Registrar puntos/, "expected register action to remain present");
  assert.match(html, /Canjear recompensa/, "expected redeem action to remain present");
});
```

- [ ] **Step 3: Run the targeted tests to verify the new assertions fail**

Run:

```bash
node --test tests/unit/staff-surface-polish-contract.test.js tests/unit/staff-flow-contract.test.js tests/unit/staff-redeem-flow-contract.test.js
```

Expected:

- FAIL because `public/staff.html` does not yet contain `staff-primary-workspace`
- FAIL because the new `Cliente activo`/`Cliente listo` structure does not yet exist

- [ ] **Step 4: Commit the red test checkpoint**

```bash
git add tests/unit/staff-surface-polish-contract.test.js tests/unit/staff-flow-contract.test.js tests/unit/staff-redeem-flow-contract.test.js
git commit -m "test: define staff surface polish contracts"
```

## Task 2: Restructure the staff shell around the active customer

**Files:**
- Modify: `public/staff.html`
- Modify: `public/styles/pages.css`
- Test: `tests/unit/staff-surface-polish-contract.test.js`

- [ ] **Step 1: Replace the top equal-weight stage with a customer-dominant workspace**

Update the top workspace in `public/staff.html` so it follows this structure:

```html
<section class="staff-primary-workspace">
  <div class="card staff-selection-panel">
    <div class="staff-panel-heading">
      <p class="section-kicker">Entrada del cliente</p>
      <h2>Seleccionar cliente</h2>
    </div>
    <video id="video" autoplay playsinline muted></video>
    <div class="row mt-10">
      <button class="primary" id="btnStart">Escanear cliente</button>
      <button id="btnStop">Pausar</button>
      <button id="btnSync">Sincronizar</button>
    </div>
    <p class="small" id="selectionStatus">Escanea o ingresa el código del cliente para continuar.</p>
    <label>Código o token manual</label>
    <textarea id="token" rows="3" placeholder="Pega aquí el token si no puedes escanear"></textarea>
    <div class="row mt-10">
      <button id="btnSelectCustomer">Seleccionar cliente</button>
    </div>
    <p class="small" id="queueMeta">Pendientes: 0 • Fallidos: 0 • Última actividad: —</p>
    <pre id="queueList" class="small pre-wrap">(sin operaciones pendientes)</pre>
  </div>

  <div class="staff-customer-column">
    <div class="card staff-customer-summary" id="staffCustomerSummary">
      <div class="staff-panel-heading">
        <p class="section-kicker">Cliente activo</p>
        <h2>Cliente activo</h2>
      </div>
      <div class="staff-ready-chip" id="customerReadyChip">Esperando cliente</div>
      <div class="staff-customer-grid">
        <div><span>Nombre</span><strong id="lastCustomerName">—</strong></div>
        <div><span>Teléfono</span><strong id="lastCustomerPhone">—</strong></div>
        <div><span>ID</span><strong id="lastCustomer">—</strong></div>
        <div><span>Puntos</span><strong id="lastPoints">—</strong></div>
        <div><span>Saldo</span><strong id="lastBalance">—</strong></div>
        <div><span>Recompensa</span><strong id="customerRewardState">Aún no disponible</strong></div>
      </div>
      <p class="small" id="customerActionStatus">Escanea o ingresa el código del cliente para continuar.</p>
    </div>

    <div class="card staff-action-rail">
      <!-- registrar + canjear + gift card blocks -->
    </div>
  </div>
</section>
```

- [ ] **Step 2: Move award/redeem/gift-card panels under the shared action rail**

Within the new action rail, preserve the existing form controls and IDs:

```html
<div class="staff-action-grid">
  <section class="staff-action-block">
    <h2>Registrar puntos</h2>
    <p class="small" id="programInfo">Regla activa: —</p>
    <!-- amount / visits / items inputs -->
    <div class="row mt-10">
      <button class="primary" id="btnAward">Registrar</button>
      <button class="danger" id="btnLogout">Salir</button>
    </div>
    <p class="small" id="awardPreview">Primero selecciona un cliente. Luego registra la compra, visita o items.</p>
  </section>

  <section class="staff-action-block">
    <h2>Canjear recompensa</h2>
    <label>Recompensa</label>
    <select id="rewardSelect"></select>
    <p class="small" id="rewardSelectionHint">Selecciona un cliente para ver qué recompensas puede canjear ahora.</p>
    <div class="row mt-10">
      <button class="primary" id="btnRedeem">Canjear</button>
      <span class="badge">Código: <code id="redeemCode">—</code></span>
    </div>
  </section>

  <section class="staff-action-block staff-action-block-secondary">
    <h2>Gift Cards</h2>
    <!-- existing gift card inputs and status -->
  </section>
</div>
```

- [ ] **Step 3: Add the workspace styles in `public/styles/pages.css`**

Add a staff-specific block like:

```css
.staff-primary-workspace {
    display: grid;
    grid-template-columns: minmax(320px, 0.92fr) minmax(0, 1.28fr);
    gap: 18px;
    align-items: start;
}

.staff-customer-column,
.staff-action-grid,
.staff-customer-grid {
    display: grid;
    gap: 14px;
}

.staff-customer-summary {
    padding: 22px;
    border-radius: 28px;
    box-shadow: var(--shadow-soft);
}

.staff-ready-chip {
    display: inline-flex;
    align-items: center;
    min-height: 36px;
    padding: 0 14px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--accent) 16%, var(--surface));
    color: var(--text);
    font-weight: 600;
}

.staff-action-rail .staff-action-block-secondary {
    opacity: 0.86;
}
```

- [ ] **Step 4: Run the shell-focused tests and inspect the expected pass/fail delta**

Run:

```bash
node --test tests/unit/staff-surface-polish-contract.test.js tests/unit/staff-flow-contract.test.js tests/unit/staff-redeem-flow-contract.test.js
```

Expected:

- PASS on new hierarchy markers in the shell
- PASS on explicit customer-selection invariants

- [ ] **Step 5: Commit the shell restructure**

```bash
git add public/staff.html public/styles/pages.css tests/unit/staff-surface-polish-contract.test.js tests/unit/staff-flow-contract.test.js tests/unit/staff-redeem-flow-contract.test.js
git commit -m "feat: restructure staff surface around active customer"
```

## Task 3: Move operational feedback into the working surface

**Files:**
- Modify: `public/staff/index.js`
- Test: `tests/unit/staff-surface-polish-contract.test.js`

- [ ] **Step 1: Add a focused UI-state updater for the selected customer**

Add a helper in `public/staff/index.js` near the existing selection helpers:

```js
function updateCustomerSurface({
  ready = false,
  status = "Escanea o ingresa el código del cliente para continuar.",
  rewardState = "Aún no disponible"
} = {}) {
  const readyChip = element("#customerReadyChip");
  const actionStatus = element("#customerActionStatus");
  const rewardStateEl = element("#customerRewardState");

  if (readyChip) readyChip.textContent = ready ? "Cliente listo" : "Esperando cliente";
  if (actionStatus) actionStatus.textContent = status;
  if (rewardStateEl) rewardStateEl.textContent = rewardState;
}
```

- [ ] **Step 2: Call the new helper from selection, award, and redeem paths**

Update the relevant paths so they communicate in-surface state:

```js
if (!lastCustomerId) {
  updateCustomerSurface({
    ready: false,
    status: "Escanea o ingresa el código del cliente para continuar.",
    rewardState: "Aún no disponible"
  });
}
```

```js
updateCustomerSurface({
  ready: true,
  status: "Cliente listo. Ahora puedes registrar puntos o canjear una recompensa.",
  rewardState: eligibleReward
    ? `Canjeable ahora: ${eligibleReward.name}`
    : "Sin recompensa canjeable por ahora"
});
```

```js
updateCustomerSurface({
  ready: true,
  status: "Registrando puntos...",
  rewardState: currentRewardState()
});
```

```js
updateCustomerSurface({
  ready: true,
  status: `Canje listo. Código ${out.redemptionCode}.`,
  rewardState: currentRewardState()
});
```

- [ ] **Step 3: Make `renderRewardOptions()` also refresh the summary reward signal**

At the end of `renderRewardOptions()`, update the summary signal from the first eligible reward:

```js
const eligibleReward = sorted.find((reward) => lastCustomerPoints >= Number(reward.points_cost || 0));
updateCustomerSurface({
  ready: Boolean(lastCustomerId),
  status: lastCustomerId
    ? "Cliente listo. Ahora puedes registrar puntos o canjear una recompensa."
    : "Escanea o ingresa el código del cliente para continuar.",
  rewardState: eligibleReward
    ? `Canjeable ahora: ${eligibleReward.name}`
    : (lastCustomerId ? "Sin recompensa canjeable por ahora" : "Aún no disponible")
});
```

- [ ] **Step 4: Run targeted staff tests**

Run:

```bash
node --test tests/unit/staff-surface-polish-contract.test.js tests/unit/staff-flow-contract.test.js tests/unit/staff-redeem-flow-contract.test.js
```

Expected:

- PASS with the new ready-state strings and selected-customer behavior intact

- [ ] **Step 5: Commit the in-surface feedback changes**

```bash
git add public/staff/index.js tests/unit/staff-surface-polish-contract.test.js tests/unit/staff-flow-contract.test.js tests/unit/staff-redeem-flow-contract.test.js
git commit -m "feat: add inline staff action feedback"
```

## Task 4: Quiet the secondary areas and verify the full pass

**Files:**
- Modify: `public/staff.html`
- Modify: `public/styles/pages.css`
- Test: `tests/unit/staff-surface-polish-contract.test.js`

- [ ] **Step 1: Reduce the visual competition from support sections**

Update the lower sections in `public/staff.html` so they read as secondary:

```html
<section class="staff-support-grid staff-support-grid-muted">
  <div class="card staff-secondary-card" id="ownerAnalyticsCard">
    <h2>Si eres dueño</h2>
    ...
  </div>

  <div class="card staff-secondary-card">
    <h2>Seguridad de cuenta</h2>
    ...
  </div>
</section>
```

- [ ] **Step 2: Add quieter support styling**

In `public/styles/pages.css`, add:

```css
.staff-support-grid-muted {
    margin-top: 18px;
}

.staff-secondary-card {
    background: color-mix(in srgb, var(--surface) 92%, var(--surface-raised));
    border-color: color-mix(in srgb, var(--line) 82%, transparent);
}

.staff-secondary-card h2 {
    font-size: 1rem;
}
```

- [ ] **Step 3: Run the full verification set for this pass**

Run:

```bash
node --test tests/unit/staff-surface-polish-contract.test.js tests/unit/staff-flow-contract.test.js tests/unit/staff-redeem-flow-contract.test.js tests/unit/ui-visibility.test.js
npm run lint
```

Expected:

- all targeted staff tests PASS
- lint PASS

- [ ] **Step 4: Manual smoke check on the running app**

Run:

```bash
curl -fsS http://127.0.0.1:3001/staff | grep -E "Cliente activo|Cliente listo|staff-action-rail|Escanea o ingresa el código del cliente para continuar"
```

Expected:

- output includes the new customer-dominant markers

Then confirm in browser:

- before selection: action rail reads inactive and customer summary is empty
- after selection: `Cliente listo` appears and customer details populate
- award updates points in place
- redeem updates the reward state and redemption code in place

- [ ] **Step 5: Commit the completed staff polish pass**

```bash
git add public/staff.html public/staff/index.js public/styles/pages.css tests/unit/staff-surface-polish-contract.test.js tests/unit/staff-flow-contract.test.js tests/unit/staff-redeem-flow-contract.test.js
git commit -m "feat: polish staff surface hierarchy"
```

## Self-Review

- Spec coverage:
  - customer-dominant hierarchy: Tasks 1-2
  - clearer ready/disabled states: Tasks 2-3
  - in-surface action feedback: Task 3
  - quieter secondary sections: Task 4
  - preserved existing flow: Tasks 1-4 keep current staff API behavior
- Placeholder scan:
  - no `TODO`, `TBD`, or unresolved placeholders remain
- Type consistency:
  - new UI helpers use concrete IDs introduced in Task 2 and referenced consistently in Task 3
