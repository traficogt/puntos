# Premium App Visual System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the application surfaces around a dark-first premium theme system with light-mode support, refresh the shared app shell and controls, redesign admin/staff/customer surfaces within one coherent product language, and fix transparent favicon/app icon exports.

**Architecture:** Keep one shared frontend codebase and one interaction model. Introduce theme and typography tokens at the global stylesheet layer, add a small theme runtime for persisted/system-aware light-dark mode, then restyle the shared shell and each application surface in place without creating route forks or theme-specific layouts.

**Tech Stack:** Static HTML, CSS variables, vanilla JS modules in `public/`, Node test runner, Playwright-based icon export script, ESLint.

**Platform Constraint:** All work in this plan is PWA-first and native-ready. Theme, shell, spacing, and icon changes must remain compatible with installed PWAs and future native wrappers via runtime-config-based app shells.

---

## File Structure

**Create**

- `public/theme.js` — shared theme bootstrap, persisted theme preference, system fallback, and toggle helpers
- `tests/unit/theme-preference.test.js` — verifies theme bootstrap contract and persisted/system resolution rules
- `tests/unit/marketing-brand-icon.test.js` — regression test for canonical icon usage and app entrypoint icon references
- `src/scripts/generate-brand-icons.mjs` — renders the canonical `public/icon.svg` into PNG favicon/app icon assets with transparent corners

**Modify**

- `public/index.html` — keep canonical icon references and landing lockup consistent
- `public/admin-dashboard.html` — dark app shell markup, theme toggle hook, premium top bar language
- `public/staff.html` — dark operational staff shell and clearer single-task layout
- `public/customer.html` — dark customer wallet shell, theme toggle hook, stronger hierarchy
- `public/join.html` — dark join flow shell, consistent typography and theme support
- `public/manifest.webmanifest` — app install metadata aligned with the new product theme and canonical icon set
- `public/styles/base.css` — theme token definitions, typography roles, app-shell primitives
- `public/styles/components.css` — button hierarchy, fields, badges, utility states, theme-aware component rules
- `public/styles/pages.css` — app shell layout, admin/staff/customer/join surface styling
- `public/styles/admin-panels.css` — modal/analytics/admin stage styling aligned with dark-first system
- `public/styles/responsive.css` — responsive behavior for refreshed shell and nav hierarchy
- `public/sw.js` — cache version and icon asset list updates

**Optional split if needed during implementation**

- `public/styles/themes.css` — only if `base.css` becomes too large after token introduction
- `public/styles/app-shell.css` — only if shared app-shell rules materially exceed `pages.css` readability

**Test**

- `tests/unit/service-worker-assets.test.js`
- `tests/unit/no-runtime-style-mutations.test.js`
- `tests/unit/ui-visibility.test.js`
- `tests/e2e/visual.spec.js` (targeted refresh only if snapshots materially change and are intended)

---

### Task 1: Lock the icon pipeline and favicon transparency

**Files:**
- Create: `src/scripts/generate-brand-icons.mjs`
- Modify: `public/icon.svg`
- Modify: `public/index.html`
- Modify: `public/customer.html`
- Modify: `public/join.html`
- Modify: `public/admin-dashboard.html`
- Modify: `public/manifest.webmanifest`
- Modify: `public/sw.js`
- Test: `tests/unit/marketing-brand-icon.test.js`
- Test: `tests/unit/service-worker-assets.test.js`

- [ ] **Step 1: Write the failing regression test for canonical icon usage**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

function read(relativePath) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return fs.readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

test("shared icon svg matches the canonical PF motion-study mark", () => {
  const iconSvg = read("public/icon.svg");
  assert.match(iconSvg, /<linearGradient id="pf-bg"/);
  assert.match(iconSvg, /<path d="M140 386 L140 128 C308 128 376 182 376 268"/);
  assert.match(iconSvg, /fill="#F59E0B"/);
});

test("marketing header and entry points reference the canonical PF icon", () => {
  const indexHtml = read("public/index.html");
  assert.match(indexHtml, /<img src="\\/icon\\.svg\\?v=4" alt="PuntosFieles" class="brand-mark"\\/>/);
  assert.match(indexHtml, /rel="icon" href="\\/icon\\.svg\\?v=4"/);
});

test("manifest stays installable and aligned with the canonical icon set", () => {
  const manifest = read("public/manifest.webmanifest");
  assert.match(manifest, /"display": "standalone"/);
  assert.match(manifest, /"src": "\\/icon-192\\.png"/);
  assert.match(manifest, /"src": "\\/icon-512\\.png"/);
});
```

- [ ] **Step 2: Run the icon regression test to verify it fails before code changes**

Run: `node --test tests/unit/marketing-brand-icon.test.js`  
Expected: FAIL because the old icon asset or old icon references are still present.

- [ ] **Step 3: Implement the canonical icon asset and transparent PNG export script**

```js
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const PUBLIC_DIR = path.join(process.cwd(), "public");
const svg = await fs.readFile(path.join(PUBLIC_DIR, "icon.svg"), "utf8");
const browser = await chromium.launch({ headless: true });
```

```svg
<rect width="512" height="512" rx="112" fill="url(#pf-bg)"/>
<path d="M140 386 L140 128 C308 128 376 182 376 268" fill="none" stroke="#E2E8F0" stroke-width="44" stroke-linecap="round" stroke-linejoin="round"/>
<rect class="bar-top" x="162" y="290" width="152" height="36" rx="10" fill="url(#pf-bar)"/>
<rect class="bar-mid" x="162" y="342" width="112" height="36" rx="10" fill="#F59E0B" opacity="0.6"/>
<circle class="punto" cx="238" cy="198" r="27" fill="#F59E0B"/>
```

- [ ] **Step 4: Regenerate the PNG icon set from the canonical SVG**

Run: `node src/scripts/generate-brand-icons.mjs`  
Expected: writes `public/favicon-16.png`, `public/favicon-32.png`, `public/apple-touch-icon.png`, `public/icon-192.png`, and `public/icon-512.png` with transparent corners.

- [ ] **Step 5: Verify the tests and asset presence**

Run: `node --test tests/unit/marketing-brand-icon.test.js tests/unit/service-worker-assets.test.js`  
Expected: PASS

Run: `file public/favicon-16.png public/favicon-32.png public/apple-touch-icon.png public/icon-192.png public/icon-512.png`  
Expected: each file reports the correct PNG dimensions.

- [ ] **Step 6: Commit**

```bash
git add public/icon.svg public/index.html public/customer.html public/join.html public/admin-dashboard.html public/manifest.webmanifest public/sw.js public/favicon-16.png public/favicon-32.png public/apple-touch-icon.png public/icon-192.png public/icon-512.png src/scripts/generate-brand-icons.mjs tests/unit/marketing-brand-icon.test.js
git commit -m "feat: align canonical brand icon assets"
```

### Task 2: Introduce the theme system and typography tokens

**Files:**
- Create: `public/theme.js`
- Create: `tests/unit/theme-preference.test.js`
- Modify: `public/admin-dashboard.html`
- Modify: `public/staff.html`
- Modify: `public/customer.html`
- Modify: `public/join.html`
- Modify: `public/styles/base.css`
- Modify: `public/styles/responsive.css`
- Modify: `public/manifest.webmanifest`
- Test: `tests/unit/no-runtime-style-mutations.test.js`

- [ ] **Step 1: Write the failing theme-preference test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("theme bootstrap honors saved preference before system preference", () => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const source = fs.readFileSync(new URL("../../public/theme.js", import.meta.url), "utf8");
  assert.match(source, /localStorage\.getItem\("pf-theme"\)/);
  assert.match(source, /matchMedia\("\\(prefers-color-scheme: dark\\)"\)/);
  assert.match(source, /document\.documentElement\.dataset\.theme/);
});
```

- [ ] **Step 2: Run the theme-preference test to verify it fails**

Run: `node --test tests/unit/theme-preference.test.js`  
Expected: FAIL because `public/theme.js` does not exist yet.

- [ ] **Step 3: Add global theme and typography tokens**

```css
:root {
  --font-brand: "Bricolage Grotesque", "Inter", "Segoe UI", sans-serif;
  --font-display: "Fraunces", Georgia, serif;
  --font-ui: "Inter", "Segoe UI", "Helvetica Neue", sans-serif;
  --font-mono: ui-monospace, "SFMono-Regular", "JetBrains Mono", monospace;
}

:root[data-theme="dark"] {
  --bg: #0b0f14;
  --panel: rgba(18, 23, 30, 0.88);
  --panel-strong: #10161d;
  --text: #e7edf4;
  --muted: #95a3b4;
  --line: rgba(148, 163, 184, 0.14);
}
```

- [ ] **Step 4: Create the runtime theme bootstrap**

```js
const STORAGE_KEY = "pf-theme";

export function resolveTheme(win = window) {
  const saved = win.localStorage.getItem(STORAGE_KEY);
  if (saved === "dark" || saved === "light") return saved;
  return win.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(theme, doc = document) {
  doc.documentElement.dataset.theme = theme;
}
```

- [ ] **Step 5: Wire the bootstrap into app entrypoints and add a theme toggle target**

```html
<script type="module">
  import { bootTheme } from "/theme.js";
  bootTheme();
</script>
```

```html
<button type="button" class="theme-toggle" id="themeToggle" aria-label="Cambiar tema">Tema</button>
```

```json
{
  "display": "standalone",
  "background_color": "#0b0f14",
  "theme_color": "#0b0f14"
}
```

- [ ] **Step 6: Verify the new test and lint/runtime guardrails**

Run: `node --test tests/unit/theme-preference.test.js tests/unit/no-runtime-style-mutations.test.js`  
Expected: PASS

Run: `npm run lint`  
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add public/theme.js public/admin-dashboard.html public/staff.html public/customer.html public/join.html public/manifest.webmanifest public/styles/base.css public/styles/responsive.css tests/unit/theme-preference.test.js
git commit -m "feat: add shared app theme system"
```

### Task 3: Refresh shared app shell primitives and control hierarchy

**Files:**
- Modify: `public/styles/base.css`
- Modify: `public/styles/components.css`
- Modify: `public/styles/pages.css`
- Modify: `public/styles/admin-panels.css`
- Modify: `public/admin-dashboard.html`
- Modify: `public/staff.html`
- Modify: `public/customer.html`
- Modify: `public/join.html`
- Test: `tests/unit/ui-visibility.test.js`

- [ ] **Step 1: Write or extend a failing visibility/style contract test for the new shell classes**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("application entrypoints expose the premium app shell markers", () => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const admin = fs.readFileSync(new URL("../../public/admin-dashboard.html", import.meta.url), "utf8");
  assert.match(admin, /class="app-shell page-admin"/);
  assert.match(admin, /id="themeToggle"/);
});
```

- [ ] **Step 2: Run the targeted shell test to verify it fails**

Run: `node --test tests/unit/ui-visibility.test.js`  
Expected: FAIL or missing new shell markers.

- [ ] **Step 3: Introduce premium shell primitives and control hierarchy**

```css
.app-shell {
  min-height: 100vh;
  background:
    radial-gradient(circle at top, rgba(245, 158, 11, 0.08), transparent 28%),
    linear-gradient(180deg, var(--bg) 0%, var(--bg-elevated) 100%);
}

.app-topbar {
  backdrop-filter: blur(18px);
  border-bottom: 1px solid var(--line);
}

button.primary {
  background: linear-gradient(135deg, #f2bf6a, #d79a32);
  color: #130d05;
}
```

- [ ] **Step 4: Apply the shell primitives to the app entrypoints without changing route structure**

```html
<body class="app-shell page-admin">
  <div class="nav app-topbar">
```

```html
<body class="app-shell page-customer">
```

- [ ] **Step 5: Verify the shared shell and component guardrails**

Run: `node --test tests/unit/ui-visibility.test.js tests/unit/no-runtime-style-mutations.test.js`  
Expected: PASS

Run: `npm run lint`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add public/styles/base.css public/styles/components.css public/styles/pages.css public/styles/admin-panels.css public/admin-dashboard.html public/staff.html public/customer.html public/join.html
git commit -m "feat: refresh shared premium app shell primitives"
```

### Task 4: Redesign the merchant dashboard and staff flow inside the new system

**Files:**
- Modify: `public/admin-dashboard.html`
- Modify: `public/staff.html`
- Modify: `public/styles/pages.css`
- Modify: `public/styles/admin-panels.css`
- Modify: `public/styles/responsive.css`
- Test: `tests/e2e/visual.spec.js` (targeted update only if intended)

- [ ] **Step 1: Capture the desired admin/staff structural changes in targeted markup edits**

```html
<section class="admin-header-band app-stage-hero">
  <div class="app-stage-copy">
    <p class="section-kicker">Centro de control</p>
    <h1 id="businessName">Panel de Administración</h1>
  </div>
  <div class="admin-quick-notes app-stage-aside">...</div>
</section>
```

```html
<div class="staff-workstage">
  <section class="staff-camera-stage">...</section>
  <aside class="staff-action-stack">...</aside>
</div>
```

- [ ] **Step 2: Restyle admin and staff around one dominant workspace**

```css
.admin-shell-grid {
  grid-template-columns: 220px minmax(0, 1fr);
}

.staff-workstage {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(320px, 0.8fr);
  gap: 20px;
}
```

- [ ] **Step 3: Add semantic state styling only where operationally meaningful**

```css
.status-approved { color: var(--ok); }
.status-denied { color: var(--danger); }
.status-degraded { color: var(--warn); }
.status-processing { color: var(--muted); }
```

- [ ] **Step 4: Run lint and the targeted UI regression suite**

Run: `npm run lint`  
Expected: PASS

Run: `node --test tests/unit/ui-visibility.test.js`  
Expected: PASS

- [ ] **Step 5: Refresh visual snapshots only if the changes are intentional and stable**

Run: `npm run test:e2e:visual:update`  
Expected: snapshot files update only for the intended dashboard surfaces.

- [ ] **Step 6: Commit**

```bash
git add public/admin-dashboard.html public/staff.html public/styles/pages.css public/styles/admin-panels.css public/styles/responsive.css tests/e2e/visual.spec.js-snapshots
git commit -m "feat: redesign admin and staff application shells"
```

### Task 5: Redesign the customer wallet and join flow within the app system

**Files:**
- Modify: `public/customer.html`
- Modify: `public/join.html`
- Modify: `public/styles/pages.css`
- Modify: `public/styles/components.css`
- Modify: `public/styles/responsive.css`
- Test: `tests/unit/customer-branding-render.test.js`
- Test: `tests/unit/customer-derived-state.test.js`

- [ ] **Step 1: Preserve the customer-branding contract with a failing targeted render check**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("customer shell keeps branding anchors while using the premium app shell", () => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const customer = fs.readFileSync(new URL("../../public/customer.html", import.meta.url), "utf8");
  assert.match(customer, /id="customerBrandTitle"/);
  assert.match(customer, /class="app-shell page-customer"/);
});
```

- [ ] **Step 2: Run the targeted customer rendering tests to verify the contract**

Run: `node --test tests/unit/customer-branding-render.test.js tests/unit/customer-derived-state.test.js`  
Expected: PASS before the refactor continues, so existing behavior is locked.

- [ ] **Step 3: Restyle the join and wallet surfaces without changing their logic**

```css
.loyalty-card {
  background: linear-gradient(180deg, rgba(20, 27, 35, 0.96), rgba(14, 19, 26, 0.92));
  border: 1px solid rgba(148, 163, 184, 0.14);
}

.join-shell {
  grid-template-columns: minmax(320px, 0.9fr) minmax(0, 1.1fr);
}
```

- [ ] **Step 4: Keep customer-branding hooks intact while updating the visual hierarchy**

```html
<div class="brand brand-lockup">
  <img id="customerBrandLogo" class="customer-brand-logo" alt="" hidden/>
  <div class="brand-copy">
    <span class="brand-kicker" id="customerBrandKicker">PuntosFieles</span>
    <span class="brand-title" id="customerBrandTitle">Mi tarjeta</span>
  </div>
</div>
```

- [ ] **Step 5: Verify customer behavior and polish**

Run: `node --test tests/unit/customer-branding-render.test.js tests/unit/customer-derived-state.test.js`  
Expected: PASS

Run: `npm run lint`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add public/customer.html public/join.html public/styles/pages.css public/styles/components.css public/styles/responsive.css
git commit -m "feat: redesign customer wallet and join surfaces"
```

### Task 6: Final verification and integration pass

**Files:**
- Modify: any touched files from Tasks 1-5
- Test: `tests/unit/marketing-brand-icon.test.js`
- Test: `tests/unit/theme-preference.test.js`
- Test: `tests/unit/service-worker-assets.test.js`
- Test: `tests/unit/customer-branding-render.test.js`
- Test: `tests/unit/customer-derived-state.test.js`
- Test: `tests/unit/no-runtime-style-mutations.test.js`
- Test: `tests/unit/ui-visibility.test.js`

- [ ] **Step 1: Run the targeted unit verification set**

Run:

```bash
node --test tests/unit/marketing-brand-icon.test.js tests/unit/theme-preference.test.js tests/unit/service-worker-assets.test.js tests/unit/customer-branding-render.test.js tests/unit/customer-derived-state.test.js tests/unit/no-runtime-style-mutations.test.js tests/unit/ui-visibility.test.js
```

Expected: PASS

- [ ] **Step 2: Run lint**

Run: `npm run lint`  
Expected: PASS

- [ ] **Step 3: Rebuild and restart the stack so the image-based app serves the refreshed UI**

Run: `docker compose up -d --build api worker`  
Expected: containers rebuild and return healthy.

- [ ] **Step 4: Verify container health**

Run: `docker compose ps`  
Expected: `puntos-api-1` and `puntos-worker-1` are `healthy`.

- [ ] **Step 5: Commit the final integrated pass**

```bash
git add public src tests
git commit -m "feat: roll out premium app visual system"
```

---

## Self-Review

**Spec coverage:** The plan covers the approved design areas: icon transparency, theme system, typography tokenization, shared shell refresh, admin/staff redesign, customer/join redesign, and final image-based verification.

**Placeholder scan:** No `TODO`, `TBD`, or implicit “handle later” steps remain. Each task has concrete files, commands, and expected outcomes.

**Type consistency:** Theme storage is consistently named `pf-theme`. The app shell is consistently referred to as `app-shell`. The icon source remains `public/icon.svg` across all tasks.
