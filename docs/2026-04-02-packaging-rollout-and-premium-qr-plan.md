# Packaging Rollout And Premium QR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the approved plan packaging to super/admin and owner-facing app surfaces, then add a safe `EMPRESA`-gated premium QR logo capability that always falls back cleanly to a plain QR.

**Architecture:** Keep the work in two layers. First, align existing plan-aware UI surfaces with the approved `EMPRENDEDOR / NEGOCIO / EMPRESA` packaging using the plan data already returned by the backend. Second, extend the current customer QR flow so it can optionally embed the business logo from customer branding when the business is on `EMPRESA` and the logo passes conservative safe-rendering constraints, without touching public pricing or billing flows.

**Tech Stack:** Node.js, Express, plain JS modules, SVG/DOM APIs, existing plan helpers in `src/utils/plan.js`, admin dashboard state in `public/admin-dashboard`, super admin UI in `public/super`, Node test runner, ESLint

---

### Task 1: Lock Packaging Copy Targets In Tests

**Files:**
- Create: `tests/unit/super-plan-packaging-contract.test.js`
- Create: `tests/unit/admin-dashboard-plan-gating-copy.test.js`
- Test: `tests/unit/super-plan-packaging-contract.test.js`
- Test: `tests/unit/admin-dashboard-plan-gating-copy.test.js`

- [ ] **Step 1: Write the failing super packaging contract**

Create `tests/unit/super-plan-packaging-contract.test.js`:

```js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const superJs = fs.readFileSync(new URL("../../public/super/index.js", import.meta.url), "utf8");

describe("super plan packaging contract", () => {
  it("describes NEGOCIO as the practical target tier", () => {
    assert.match(superJs, /NEGOCIO/);
    assert.match(superJs, /gift cards/i);
    assert.match(superJs, /automatizaciones/i);
    assert.match(superJs, /branding/i);
  });

  it("keeps EMPRESA focused on strategic capabilities", () => {
    assert.match(superJs, /EMPRESA/);
    assert.match(superJs, /gamificaci[óo]n/i);
    assert.match(superJs, /external awards|integraci[óo]n externa/i);
    assert.match(superJs, /QR/i);
  });
});
```

- [ ] **Step 2: Write the failing owner-dashboard copy contract**

Create `tests/unit/admin-dashboard-plan-gating-copy.test.js`:

```js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const brandingFragment = fs.readFileSync(new URL("../../public/admin-dashboard/fragments/branding.html", import.meta.url), "utf8");
const programFragment = fs.readFileSync(new URL("../../public/admin-dashboard/fragments/program.html", import.meta.url), "utf8");

describe("owner dashboard packaging copy contract", () => {
  it("keeps branding upsell concise and operational", () => {
    assert.match(brandingFragment, /branding/i);
  });

  it("mentions automations as a paid capability without turning the dashboard into a pricing page", () => {
    assert.match(programFragment, /automatiz/i);
    assert.doesNotMatch(programFragment, /Q\\d|USD|precio/i);
  });
});
```

- [ ] **Step 3: Run the new tests to verify they fail**

Run: `node --test tests/unit/super-plan-packaging-contract.test.js tests/unit/admin-dashboard-plan-gating-copy.test.js`

Expected: FAIL because the current super/admin and owner-dashboard surfaces do not yet explicitly reflect the approved packaging language.

- [ ] **Step 4: Commit the red scaffolding**

```bash
git add tests/unit/super-plan-packaging-contract.test.js tests/unit/admin-dashboard-plan-gating-copy.test.js
git commit -m "test: pin packaging copy targets"
```

### Task 2: Apply Packaging To Super/Admin Surfaces

**Files:**
- Modify: `public/super/index.js`
- Modify: `public/super.html`
- Test: `tests/unit/super-plan-packaging-contract.test.js`

- [ ] **Step 1: Add plan-positioning metadata to the super UI**

In `public/super/index.js`, add a small map near `FEATURE_LABELS`:

```js
  const PLAN_POSITIONING = {
    EMPRENDEDOR: {
      summary: "Base operativo: QR, cartera, recompensas, canjes y operación básica en un local.",
      highlight: "Listo para operar, sin módulos avanzados."
    },
    NEGOCIO: {
      summary: "Plan objetivo para negocios serios: analítica, niveles, referidos, gift cards y automatizaciones.",
      highlight: "La mayoría de negocios debería terminar aquí."
    },
    EMPRESA: {
      summary: "Capa estratégica: gamificación, external awards, branding avanzado y QR premium.",
      highlight: "Reservado para branding e integraciones de alto valor."
    }
  };
```

- [ ] **Step 2: Render the positioning inside each plan card**

Inside `renderPlanMatrix()` in `public/super/index.js`, after the title:

```js
      const positioning = PLAN_POSITIONING[p.plan] || null;
      if (positioning) {
        const summary = document.createElement("p");
        summary.className = "small mb-8";
        summary.textContent = positioning.summary;
        card.appendChild(summary);

        const highlight = document.createElement("div");
        highlight.className = "badge badge-soft mb-8";
        highlight.textContent = positioning.highlight;
        card.appendChild(highlight);
      }
```

- [ ] **Step 3: Tighten the super page intro copy**

In `public/super.html`, replace the current plan intro with:

```html
<p class="small">Gestiona el empaque real de EMPRENDEDOR, NEGOCIO y EMPRESA. NEGOCIO es el plan objetivo; EMPRESA concentra branding e integraciones avanzadas.</p>
```

- [ ] **Step 4: Run the focused super packaging test**

Run: `node --test tests/unit/super-plan-packaging-contract.test.js`

Expected: PASS

- [ ] **Step 5: Commit the super/admin rollout**

```bash
git add public/super.html public/super/index.js tests/unit/super-plan-packaging-contract.test.js
git commit -m "feat: apply packaging to super plan surfaces"
```

### Task 3: Apply Light Plan-Gating Messaging In The Owner Dashboard

**Files:**
- Modify: `public/admin-dashboard/fragments/branding.html`
- Modify: `public/admin-dashboard/fragments/program.html`
- Modify: `public/admin-dashboard/fragments/analytics.html`
- Modify: `public/admin-dashboard/modules/branding-form.js`
- Modify: `public/admin-dashboard/core.js`
- Test: `tests/unit/admin-dashboard-plan-gating-copy.test.js`

- [ ] **Step 1: Add concise plan-notice targets to the dashboard fragments**

In `public/admin-dashboard/fragments/branding.html`, add:

```html
<p class="small" id="brandingPlanNotice">Branding premium disponible en planes superiores.</p>
```

In `public/admin-dashboard/fragments/program.html`, add:

```html
<p class="small" id="automationPlanNotice">Las automatizaciones visibles se habilitan en planes superiores.</p>
```

In `public/admin-dashboard/fragments/analytics.html`, add:

```html
<p class="small" id="analyticsPlanNotice">La analítica avanzada vive en NEGOCIO y EMPRESA.</p>
```

- [ ] **Step 2: Add a helper for required plan labels**

In `public/admin-dashboard/core.js`, add:

```js
  function requiredPlanLabel(feature) {
    const mapping = {
      analytics: "NEGOCIO",
      tiers: "NEGOCIO",
      referrals: "NEGOCIO",
      gift_cards: "NEGOCIO",
      multi_branch: "NEGOCIO",
      webhooks: "NEGOCIO",
      lifecycle_automation: "NEGOCIO",
      rbac_matrix: "NEGOCIO",
      gamification: "EMPRESA",
      external_awards: "EMPRESA"
    };
    return mapping[feature] || "";
  }
```

Expose it in the returned app object:

```js
    requiredPlanLabel,
```

- [ ] **Step 3: Use the helper in branding messaging**

In `public/admin-dashboard/modules/branding-form.js`, add:

```js
  const planNotice = element($, "#brandingPlanNotice");
  if (planNotice) {
    const canUsePremiumBranding = app.requiredPlanLabel("rbac_matrix") === ""
      ? false
      : ["NEGOCIO", "EMPRESA"].includes(String(app.state.planInfo?.plan || ""));
    planNotice.textContent = canUsePremiumBranding
      ? "Tu plan ya permite branding premium en superficies de cliente."
      : "El branding premium en superficies de cliente se habilita desde NEGOCIO.";
  }
```

- [ ] **Step 4: Keep the copy operational**

Do not add prices or marketing CTAs. Use short messages like:
- `Disponible desde NEGOCIO.`
- `Reservado para EMPRESA.`
- `Tu plan ya lo incluye.`

- [ ] **Step 5: Run the owner-dashboard copy contract**

Run: `node --test tests/unit/admin-dashboard-plan-gating-copy.test.js`

Expected: PASS

- [ ] **Step 6: Commit the owner-dashboard pass**

```bash
git add public/admin-dashboard/fragments/branding.html public/admin-dashboard/fragments/program.html public/admin-dashboard/fragments/analytics.html public/admin-dashboard/modules/branding-form.js public/admin-dashboard/core.js tests/unit/admin-dashboard-plan-gating-copy.test.js
git commit -m "feat: add plan-aware owner dashboard copy"
```

### Task 4: Lock Premium QR Gating In Tests

**Files:**
- Create: `tests/unit/customer-qr-premium-gating.test.js`
- Test: `tests/unit/customer-qr-premium-gating.test.js`

- [ ] **Step 1: Write a failing QR premium gating contract**

Create `tests/unit/customer-qr-premium-gating.test.js`:

```js
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { shouldEmbedQrLogo } from "../../public/customer/qr.js";

describe("customer qr premium gating", () => {
  it("rejects embedding below EMPRESA", () => {
    assert.equal(shouldEmbedQrLogo({
      plan: "NEGOCIO",
      logoUrl: "https://cdn.example.com/logo.png",
      enabled: true
    }), false);
  });

  it("allows embedding only for EMPRESA with a logo and explicit enablement", () => {
    assert.equal(shouldEmbedQrLogo({
      plan: "EMPRESA",
      logoUrl: "https://cdn.example.com/logo.png",
      enabled: true
    }), true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/unit/customer-qr-premium-gating.test.js`

Expected: FAIL because `shouldEmbedQrLogo` does not exist yet.

- [ ] **Step 3: Commit the red QR gating test**

```bash
git add tests/unit/customer-qr-premium-gating.test.js
git commit -m "test: pin premium qr gating"
```

### Task 5: Implement Safe Premium QR Rendering

**Files:**
- Modify: `public/customer/qr.js`
- Modify: `public/customer/me.js`
- Modify: `src/app/routes/customer-routes.js`
- Modify: `src/types/http-dto.js`
- Test: `tests/unit/customer-qr-premium-gating.test.js`

- [ ] **Step 1: Include plan and branding data in `/api/customer/me`**

In `src/app/routes/customer-routes.js`, ensure the customer me payload includes:

```js
business: {
  id: business.id,
  name: business.name,
  slug: business.slug,
  plan: business.plan,
  customer_branding: business.customer_branding_json || null
}
```

Update the matching response type in `src/types/http-dto.js`.

- [ ] **Step 2: Persist QR-related business state into the wallet**

In `public/customer/me.js`, after wallet rendering:

```js
  const qrWrap = /** @type {HTMLElement | null} */ ($("#qrWrap"));
  if (qrWrap) {
    qrWrap.dataset.plan = String(me.business?.plan || "");
    qrWrap.dataset.logoUrl = String(me.business?.customer_branding?.customer_logo_url || "");
    qrWrap.dataset.qrLogoEnabled = String(me.business?.customer_branding?.qr_logo_enabled === true);
  }
```

- [ ] **Step 3: Add a pure gating helper**

In `public/customer/qr.js`, add:

```js
export function shouldEmbedQrLogo({ plan, logoUrl, enabled }) {
  return String(plan || "").toUpperCase() === "EMPRESA"
    && Boolean(enabled)
    && /^https?:\\/\\//i.test(String(logoUrl || "").trim());
}
```

- [ ] **Step 4: Add a safe SVG decoration helper**

In `public/customer/qr.js`, add:

```js
function decorateQrSvgWithLogo(svgElement, logoUrl) {
  const NS = "http://www.w3.org/2000/svg";
  const size = 82;
  const x = 256 - (size / 2);
  const y = 256 - (size / 2);

  const badge = document.createElementNS(NS, "rect");
  badge.setAttribute("x", String(x - 10));
  badge.setAttribute("y", String(y - 10));
  badge.setAttribute("width", String(size + 20));
  badge.setAttribute("height", String(size + 20));
  badge.setAttribute("rx", "24");
  badge.setAttribute("fill", "#ffffff");

  const image = document.createElementNS(NS, "image");
  image.setAttribute("href", logoUrl);
  image.setAttribute("x", String(x));
  image.setAttribute("y", String(y));
  image.setAttribute("width", String(size));
  image.setAttribute("height", String(size));
  image.setAttribute("preserveAspectRatio", "xMidYMid slice");

  svgElement.appendChild(badge);
  svgElement.appendChild(image);
}
```

- [ ] **Step 5: Keep the fallback absolute**

In `generateQR()` in `public/customer/qr.js`, after parsing the SVG:

```js
      const plan = qrWrap?.dataset.plan || "";
      const logoUrl = qrWrap?.dataset.logoUrl || "";
      const enabled = qrWrap?.dataset.qrLogoEnabled === "true";

      if (shouldEmbedQrLogo({ plan, logoUrl, enabled })) {
        try {
          decorateQrSvgWithLogo(svgElement, logoUrl);
        } catch {
          // Fall back to the plain QR with no user-facing error.
        }
      }
```

- [ ] **Step 6: Run the QR gating contract**

Run: `node --test tests/unit/customer-qr-premium-gating.test.js`

Expected: PASS

- [ ] **Step 7: Commit the premium QR implementation**

```bash
git add public/customer/qr.js public/customer/me.js src/app/routes/customer-routes.js src/types/http-dto.js tests/unit/customer-qr-premium-gating.test.js
git commit -m "feat: add safe premium qr logo rendering"
```

### Task 6: Expose Premium QR Branding In Owner Controls

**Files:**
- Modify: `public/admin-dashboard/fragments/branding.html`
- Modify: `public/admin-dashboard/modules/branding-form.js`
- Modify: `src/app/routes/admin/branding-routes.js`
- Test: `tests/unit/admin-branding-routes.test.js`
- Test: `tests/unit/customer-qr-premium-gating.test.js`

- [ ] **Step 1: Add the new branding control**

In `public/admin-dashboard/fragments/branding.html`, add:

```html
<label class="row-inline-flex">
  <input id="brandingQrLogoEnabled" type="checkbox"/>
  <span>Insertar logo del negocio dentro del QR del cliente</span>
</label>
<p class="small" id="brandingQrLogoHint">Disponible únicamente en EMPRESA. Si el logo no es válido, el QR seguirá normal.</p>
```

- [ ] **Step 2: Wire the field into the branding payload**

In `public/admin-dashboard/modules/branding-form.js`, include:

```js
    qr_logo_enabled: element($, "#brandingQrLogoEnabled")?.checked === true,
```

and hydrate it on load:

```js
  const qrCheckbox = /** @type {HTMLInputElement | null} */ (element($, "#brandingQrLogoEnabled"));
  if (qrCheckbox) qrCheckbox.checked = payload.qr_logo_enabled === true;
```

- [ ] **Step 3: Gate the control by plan**

In `public/admin-dashboard/modules/branding-form.js`:

```js
  const canUseQrLogo = String(app.state.planInfo?.plan || "") === "EMPRESA";
  if (qrCheckbox) qrCheckbox.disabled = !canUseQrLogo;
  const qrHint = element($, "#brandingQrLogoHint");
  if (qrHint) {
    qrHint.textContent = canUseQrLogo
      ? "Tu plan permite QR premium con logo, siempre con fallback seguro."
      : "El logo dentro del QR se reserva para EMPRESA.";
  }
```

- [ ] **Step 4: Persist the field in the admin branding route**

In `src/app/routes/admin/branding-routes.js`, extend the branding schema with:

```js
  qr_logo_enabled: z.boolean().optional()
```

and persist it into `customer_branding_json`.

- [ ] **Step 5: Run the relevant tests**

Run: `node --test tests/unit/admin-branding-routes.test.js tests/unit/customer-qr-premium-gating.test.js`

Expected: PASS

- [ ] **Step 6: Commit the owner-control pass**

```bash
git add public/admin-dashboard/fragments/branding.html public/admin-dashboard/modules/branding-form.js src/app/routes/admin/branding-routes.js tests/unit/admin-branding-routes.test.js tests/unit/customer-qr-premium-gating.test.js
git commit -m "feat: expose premium qr branding control"
```

### Task 7: Full Verification

**Files:**
- Verify only

- [ ] **Step 1: Run the focused rollout and QR tests**

Run:

```bash
node --test \
  tests/unit/super-plan-packaging-contract.test.js \
  tests/unit/admin-dashboard-plan-gating-copy.test.js \
  tests/unit/plan-matrix-contract.test.js \
  tests/unit/admin-plan-contract.test.js \
  tests/unit/customer-qr-premium-gating.test.js \
  tests/unit/admin-branding-routes.test.js
```

Expected: PASS

- [ ] **Step 2: Run the linter**

Run: `npm run lint`

Expected: PASS

- [ ] **Step 3: Run the full unit suite**

Run: `npm run test:unit`

Expected: PASS

- [ ] **Step 4: Manually check the key surfaces**

Open and verify:
- `/super`
- `/admin-dashboard`
- `/c`

Confirm:
- super plan summaries match the approved ladder
- owner dashboard gating copy is concise and plan-aware
- QR still renders normally when premium conditions are not met

- [ ] **Step 5: Record what remains out of scope**

Do not implement here:
- public pricing page rollout
- billing/checkout
- custom domains
- full white-label execution

- [ ] **Step 6: Commit any final touch-ups**

```bash
git add -A
git commit -m "chore: finish packaging rollout and premium qr"
```

## Self-Review

Spec coverage:
- super/admin rollout: Task 2
- owner dashboard light gating copy: Task 3
- premium QR product boundary: Tasks 4-6
- safe fallback rule: Task 5
- no billing/public pricing/custom-domain rollout: Task 7

Placeholder scan:
- No TBD/TODO placeholders remain
- Every task names exact files and verification commands

Type consistency:
- Uses existing plan helpers from `src/utils/plan.js`
- Uses `qr_logo_enabled` consistently across route, form, and wallet QR logic
