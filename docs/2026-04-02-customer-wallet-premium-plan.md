# Customer Wallet Premium Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign `/c` so the customer wallet feels like a premium loyalty wallet with a dominant hero, clearer reward/progress hierarchy, and quieter secondary sections.

**Architecture:** Keep the current wallet behavior and data flow intact, but restructure the customer shell HTML and CSS so the top of the page is led by one dominant wallet card and a progress band. Use one new unit-level contract test to lock in the hierarchy, then make the minimum HTML/CSS changes and only the smallest copy tweaks in the existing customer boot code.

**Tech Stack:** Static HTML, modular browser JavaScript, shared CSS in `public/styles/pages.css`, Node test runner, existing frontend shell helpers.

---

## File Map

- Modify: `public/customer.html`
  - Restructure the wallet shell into a premium hero, progress band, secondary content zone, and quiet account section.
- Modify: `public/styles/pages.css`
  - Redesign the customer wallet layout and hierarchy while preserving shared app-shell behavior.
- Modify: `public/customer/index.js`
  - Only if needed for clearer Spanish-first copy, placeholders, or section text that supports the new hierarchy.
- Create: `tests/unit/customer-wallet-shell-contract.test.js`
  - Lock in the intended wallet structure and Spanish-first entry-shell expectations.

## Task 1: Lock The Wallet Hierarchy With A Failing Contract Test

**Files:**
- Create: `tests/unit/customer-wallet-shell-contract.test.js`
- Test: `tests/unit/customer-wallet-shell-contract.test.js`

- [ ] **Step 1: Write the failing test**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../../public/customer.html", import.meta.url), "utf8");

test("customer wallet exposes a dominant hero and progress band near the top", () => {
  assert.match(html, /class="loyalty-card"[\s\S]*class="lc-hero"/);
  assert.match(html, /class="lc-focus-band"/);
  assert.match(html, /id="nextReward"/);
  assert.match(html, /id="tierSection"/);
});

test("customer wallet keeps account utilities in a separate quiet section", () => {
  assert.match(html, /class="cus-section cus-section-account"/);
  assert.match(html, /id="btnExport"/);
  assert.match(html, /id="btnDelete"/);
});

test("logged-out wallet shell stays Spanish-first and exposes registro plus login", () => {
  assert.match(html, /Ir a registro/);
  assert.match(html, /Ingresar/);
  assert.match(html, /tu programa activo/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/unit/customer-wallet-shell-contract.test.js
```

Expected: FAIL because `public/customer.html` does not yet include `lc-hero`, `lc-focus-band`, or the refined Spanish-first entry-shell phrasing.

- [ ] **Step 3: Commit the failing test**

```bash
git add tests/unit/customer-wallet-shell-contract.test.js
git commit -m "test: add customer wallet shell contract"
```

## Task 2: Restructure The Wallet Markup

**Files:**
- Modify: `public/customer.html`
- Test: `tests/unit/customer-wallet-shell-contract.test.js`

- [ ] **Step 1: Update the logged-in wallet structure**

Replace the current top wallet markup inside `#main` with this structure:

```html
<div class="loyalty-card">
  <div class="lc-hero">
    <div class="lc-head">
      <div class="lc-brand">
        <p class="lc-meta">Programa activo</p>
        <h1 class="lc-name" id="bizName">—</h1>
        <p class="lc-holder" id="who">—</p>
      </div>
      <span class="lc-badge" id="netBadge">En línea</span>
    </div>

    <div class="lc-balance">
      <div class="lc-points">
        <div class="lc-points-value" id="points">—</div>
        <div class="lc-points-label">puntos disponibles</div>
      </div>

      <div class="lc-qr-area">
        <div class="lc-qr-stage" id="qrWrap">
          <div class="lc-qr-placeholder">Genera tu QR cuando vayas a pagar o canjear.</div>
        </div>
        <button class="lc-qr-btn" id="btnQr">Generar QR</button>
        <p class="lc-qr-hint" id="qrHint"></p>
      </div>
    </div>
  </div>

  <div class="lc-focus-band">
    <div class="lc-focus-copy">
      <p class="lc-focus-label">Siguiente recompensa</p>
      <p class="cus-next-reward" id="nextReward">—</p>
    </div>
    <div class="lc-focus-meta">
      <div class="lc-foot-stat">
        <strong id="lifetime">—</strong>
        <span>histórico</span>
      </div>
      <div class="lc-foot-stat">
        <strong id="pendingPoints">0</strong>
        <span>pendientes</span>
      </div>
      <div class="lc-foot-stat lc-foot-stat-wide">
        <strong id="lastVisit">—</strong>
        <span>última visita</span>
      </div>
    </div>
  </div>

  <div class="lc-footer">
    <div class="lc-foot-badges">
      <span class="lc-badge" id="qrExp">QR: —</span>
      <span class="lc-badge" id="syncBadge">—</span>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Update the logged-out entry copy**

In `public/customer.html`, change the entry-shell heading and subtitle to:

```html
<h1 id="customerEntryTitle">Tu programa activo vive aquí.</h1>
<p id="customerEntrySubtitle">Entra con el enlace que te compartió el negocio. Después, este navegador queda listo para volver a tu programa activo sin buscar nada más.</p>
```

Keep the existing registration and login controls intact.

- [ ] **Step 3: Reorder the lower sections**

In `public/customer.html`, keep the current sections but reorder them to this sequence:

1. `#tierSection`
2. `Recompensas`
3. `Actividad reciente`
4. `Invita amigos`
5. `Logros`
6. `Tu información`

Use the existing IDs and buttons so the current JavaScript keeps working.

- [ ] **Step 4: Run test to verify it passes structurally**

Run:

```bash
node --test tests/unit/customer-wallet-shell-contract.test.js
```

Expected: PASS

- [ ] **Step 5: Commit the markup pass**

```bash
git add public/customer.html tests/unit/customer-wallet-shell-contract.test.js
git commit -m "feat: restructure customer wallet shell"
```

## Task 3: Apply The Premium Wallet Visual System

**Files:**
- Modify: `public/styles/pages.css`
- Test: `tests/unit/customer-wallet-shell-contract.test.js`

- [ ] **Step 1: Redesign the main page width and rhythm**

In `public/styles/pages.css`, replace the current `.cus-page` block with:

```css
.cus-page {
    max-width: 1180px;
    margin: 0 auto;
    padding: 28px 20px 72px;
}
```

- [ ] **Step 2: Redesign the dominant wallet card**

In `public/styles/pages.css`, replace the current `.loyalty-card` area and related top-level wallet blocks with a wider, more premium layout:

```css
.loyalty-card {
    background:
        radial-gradient(circle at top left, color-mix(in srgb, var(--accent) 18%, transparent), transparent 34%),
        linear-gradient(180deg, #101623 0%, #0b111b 100%);
    border: 1px solid rgba(148, 163, 184, 0.14);
    border-radius: 30px;
    padding: 30px;
    box-shadow:
        0 20px 50px rgba(0, 0, 0, 0.26),
        0 40px 90px rgba(0, 0, 0, 0.24),
        0 0 0 1px rgba(255, 255, 255, 0.02);
    color: #e7edf4;
    display: grid;
    gap: 24px;
    margin-bottom: 18px;
}

.lc-hero {
    display: grid;
    gap: 22px;
}

.lc-balance {
    display: grid;
    grid-template-columns: minmax(0, 1.1fr) minmax(260px, 0.9fr);
    gap: 18px;
    align-items: stretch;
}

.lc-points {
    display: grid;
    align-content: end;
    gap: 8px;
    min-height: 220px;
}

.lc-points-value {
    font-family: var(--display-font);
    font-size: clamp(72px, 11vw, 124px);
    font-weight: 300;
    letter-spacing: -0.05em;
    line-height: 0.9;
    color: #f8fafc;
}

.lc-points-label {
    font-size: 11px;
    color: rgba(231, 237, 244, 0.5);
    letter-spacing: 0.08em;
    text-transform: uppercase;
}

.lc-qr-area {
    display: grid;
    gap: 12px;
    padding: 18px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(148, 163, 184, 0.12);
    border-radius: 20px;
}

.lc-focus-band {
    display: grid;
    grid-template-columns: minmax(0, 1.1fr) minmax(280px, 0.9fr);
    gap: 18px;
    padding-top: 18px;
    border-top: 1px solid rgba(148, 163, 184, 0.14);
}

.lc-focus-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(231, 237, 244, 0.46);
    margin: 0 0 8px;
}

.lc-focus-meta {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
}
```

- [ ] **Step 3: Redesign the lower sections to reduce equal-weight noise**

In `public/styles/pages.css`, update the lower-section blocks to:

```css
.customer-sections {
    display: grid;
    grid-template-columns: minmax(0, 1.1fr) minmax(320px, 0.9fr);
    gap: 14px;
    align-items: start;
}

.cus-section {
    background: linear-gradient(180deg, color-mix(in srgb, var(--paper-strong) 94%, transparent), color-mix(in srgb, var(--paper) 88%, transparent));
    border: 1px solid var(--line);
    border-radius: 22px;
    padding: 24px;
}

.cus-section:nth-child(1),
.cus-section:nth-child(2),
.cus-section:nth-child(3) {
    grid-column: 1;
}

.cus-section:nth-child(4),
.cus-section:nth-child(5),
.cus-section:nth-child(6) {
    grid-column: 2;
}

.cus-section-account {
    background: linear-gradient(180deg, color-mix(in srgb, var(--paper-strong) 90%, transparent), color-mix(in srgb, var(--paper) 84%, transparent));
}

.cus-next-reward {
    font-family: var(--display-font);
    font-size: clamp(24px, 3.2vw, 34px);
    line-height: 1.12;
    color: var(--text);
    margin: 0;
}
```

- [ ] **Step 4: Add mobile collapse rules**

In `public/styles/pages.css`, add:

```css
@media (max-width: 860px) {
    .lc-balance,
    .lc-focus-band,
    .customer-sections {
        grid-template-columns: 1fr;
    }

    .cus-section:nth-child(1),
    .cus-section:nth-child(2),
    .cus-section:nth-child(3),
    .cus-section:nth-child(4),
    .cus-section:nth-child(5),
    .cus-section:nth-child(6) {
        grid-column: auto;
    }
}
```

- [ ] **Step 5: Run the contract test again**

Run:

```bash
node --test tests/unit/customer-wallet-shell-contract.test.js
```

Expected: PASS

- [ ] **Step 6: Commit the CSS pass**

```bash
git add public/styles/pages.css
git commit -m "feat: restyle customer wallet as premium pass"
```

## Task 4: Make Minimal Copy And Safety Adjustments

**Files:**
- Modify: `public/customer/index.js`
- Test: `tests/unit/customer-wallet-shell-contract.test.js`

- [ ] **Step 1: Tighten the entry and QR copy only if needed**

If the existing JavaScript-driven text feels off after the markup pass, keep changes minimal. Valid examples:

```js
toast("Código enviado.");
toast("Sesión iniciada.");
```

and:

```js
<div class="lc-qr-placeholder">Genera tu QR cuando vayas a pagar o canjear.</div>
```

Do not change routes, data loading, or auth behavior.

- [ ] **Step 2: Run focused verification**

Run:

```bash
node --test tests/unit/customer-wallet-shell-contract.test.js tests/unit/ui-visibility.test.js tests/unit/theme-preference.test.js
```

Expected: PASS

- [ ] **Step 3: Commit the polish pass**

```bash
git add public/customer/index.js public/customer.html
git commit -m "feat: polish customer wallet copy"
```

## Task 5: Final Verification

**Files:**
- Modify: none
- Test: `tests/unit/customer-wallet-shell-contract.test.js`

- [ ] **Step 1: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS

- [ ] **Step 2: Run wallet-focused unit coverage**

Run:

```bash
node --test tests/unit/customer-wallet-shell-contract.test.js tests/unit/app-shell-navigation-contract.test.js tests/unit/ui-visibility.test.js tests/unit/theme-preference.test.js
```

Expected: PASS

- [ ] **Step 3: Rebuild the live API**

Run:

```bash
docker compose up -d --build api
```

Expected: `api` rebuilt and healthy

- [ ] **Step 4: Commit any remaining verified changes**

```bash
git add public/customer.html public/styles/pages.css public/customer/index.js tests/unit/customer-wallet-shell-contract.test.js
git commit -m "feat: ship premium customer wallet"
```

## Self-Review

Spec coverage:

- dominant wallet hero: Task 2 + Task 3
- progress band / next reward emphasis: Task 2 + Task 3
- quieter lower sections: Task 2 + Task 3
- Spanish-first logged-out shell: Task 1 + Task 2
- preserve current behavior: Task 2 + Task 4

Placeholder scan:

- no TBD/TODO markers remain
- each test and command is explicit

Type consistency:

- `lc-hero` and `lc-focus-band` are introduced in both the test and markup tasks
- no new JS API names are introduced
