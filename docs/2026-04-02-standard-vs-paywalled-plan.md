# Standard vs Paywalled Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update the built-in plan defaults to a tighter revenue-oriented packaging model while keeping the app usable on the base plan and without adding grandfathering complexity yet.

**Architecture:** Change the canonical plan matrix in `src/utils/plan.js`, then align plan-facing API/tests/docs with the new defaults. Keep the existing global override mechanism untouched. Do not build per-business overrides in this pass because there are no real production tenants to preserve yet.

**Tech Stack:** Node.js, Express, plain JS modules, Postgres-backed admin APIs, Node test runner, ESLint

---

### Task 1: Lock The New Plan Matrix In Tests

**Files:**
- Modify: `tests/integration/plan-enforcement.test.js`
- Create: `tests/unit/plan-matrix-contract.test.js`
- Test: `tests/unit/plan-matrix-contract.test.js`

- [ ] **Step 1: Write the failing unit contract for the agreed plan matrix**

```js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { planFeatures, planLimits } from "../../src/utils/plan.js";

describe("plan matrix contract", () => {
  it("keeps EMPRENDEDOR tight and usable", () => {
    const features = planFeatures("EMPRENDEDOR");
    const limits = planLimits("EMPRENDEDOR");

    assert.equal(features.rewards, true);
    assert.equal(features.redemptions, true);
    assert.equal(features.program_rules, true);
    assert.equal(features.staff_management, true);

    assert.equal(features.analytics, false);
    assert.equal(features.tiers, false);
    assert.equal(features.referrals, false);
    assert.equal(features.customer_export, false);
    assert.equal(features.multi_branch, false);
    assert.equal(features.gift_cards, false);
    assert.equal(features.webhooks, false);
    assert.equal(features.campaign_rules, false);
    assert.equal(features.lifecycle_automation, false);
    assert.equal(features.rbac_matrix, false);
    assert.equal(features.external_awards, false);
    assert.equal(features.gamification, false);

    assert.equal(limits.branches, 1);
  });

  it("makes NEGOCIO the practical target plan", () => {
    const features = planFeatures("NEGOCIO");
    const limits = planLimits("NEGOCIO");

    assert.equal(features.analytics, true);
    assert.equal(features.tiers, true);
    assert.equal(features.referrals, true);
    assert.equal(features.customer_export, true);
    assert.equal(features.multi_branch, true);
    assert.equal(features.gift_cards, true);
    assert.equal(features.campaign_rules, true);
    assert.equal(features.webhooks, true);
    assert.equal(features.lifecycle_automation, true);
    assert.equal(features.rbac_matrix, true);

    assert.equal(features.external_awards, false);
    assert.equal(features.gamification, false);
    assert.equal(limits.branches, 3);
  });

  it("keeps EMPRESA as the strategic integration tier", () => {
    const features = planFeatures("EMPRESA");

    assert.equal(features.analytics, true);
    assert.equal(features.tiers, true);
    assert.equal(features.referrals, true);
    assert.equal(features.customer_export, true);
    assert.equal(features.multi_branch, true);
    assert.equal(features.gift_cards, true);
    assert.equal(features.campaign_rules, true);
    assert.equal(features.webhooks, true);
    assert.equal(features.lifecycle_automation, true);
    assert.equal(features.rbac_matrix, true);
    assert.equal(features.external_awards, true);
    assert.equal(features.gamification, true);
  });
});
```

- [ ] **Step 2: Run the new unit test to verify it fails against the current defaults**

Run: `node --test tests/unit/plan-matrix-contract.test.js`

Expected: FAIL because `EMPRENDEDOR.lifecycle_automation` is still `true` in the current code.

- [ ] **Step 3: Update the integration test comments to reflect the new plan intent**

Edit `tests/integration/plan-enforcement.test.js` so the test still verifies lock behavior, but no longer assumes older packaging language in comments or fixture naming.

- [ ] **Step 4: Re-run the focused tests and confirm the contract still fails only on the code matrix**

Run: `node --test tests/unit/plan-matrix-contract.test.js tests/integration/plan-enforcement.test.js`

Expected: unit contract fails, integration test is skipped unless explicitly enabled.

- [ ] **Step 5: Commit the red test scaffolding**

```bash
git add tests/unit/plan-matrix-contract.test.js tests/integration/plan-enforcement.test.js
git commit -m "test: codify target plan packaging"
```

### Task 2: Update The Canonical Plan Defaults

**Files:**
- Modify: `src/utils/plan.js`
- Test: `tests/unit/plan-matrix-contract.test.js`

- [ ] **Step 1: Change the default feature matrix to match the approved packaging**

Update the feature matrix in `src/utils/plan.js` to:

```js
export const DEFAULT_PLAN_FEATURES = {
  EMPRENDEDOR: {
    gift_cards: false,
    rewards: true,
    redemptions: true,
    program_rules: true,
    staff_management: true,
    fraud_monitoring: true,
    lifecycle_automation: false,
    customer_export: false,
    rbac_matrix: false,
    analytics: false,
    tiers: false,
    referrals: false,
    gamification: false,
    multi_branch: false,
    webhooks: false,
    external_awards: false,
    campaign_rules: false
  },
  NEGOCIO: {
    gift_cards: true,
    rewards: true,
    redemptions: true,
    program_rules: true,
    staff_management: true,
    fraud_monitoring: true,
    lifecycle_automation: true,
    customer_export: true,
    rbac_matrix: true,
    analytics: true,
    tiers: true,
    referrals: true,
    gamification: false,
    multi_branch: true,
    webhooks: true,
    external_awards: false,
    campaign_rules: true
  },
  EMPRESA: {
    gift_cards: true,
    rewards: true,
    redemptions: true,
    program_rules: true,
    staff_management: true,
    fraud_monitoring: true,
    lifecycle_automation: true,
    customer_export: true,
    rbac_matrix: true,
    analytics: true,
    tiers: true,
    referrals: true,
    gamification: true,
    multi_branch: true,
    webhooks: true,
    external_awards: true,
    campaign_rules: true
  }
};
```

- [ ] **Step 2: Keep the limits/pricing blocks intact unless the agreed packaging requires a limit change**

Do not change:

```js
const PLAN_LIMITS = {
  EMPRENDEDOR: { activeCustomers: 100, rewards: 5, branches: 1 },
  NEGOCIO: { activeCustomers: 500, rewards: 9999, branches: 3 },
  EMPRESA: { activeCustomers: 999999, rewards: 9999, branches: 9999 }
};
```

This preserves current commercial guardrails while tightening feature access.

- [ ] **Step 3: Run the focused unit contract**

Run: `node --test tests/unit/plan-matrix-contract.test.js`

Expected: PASS

- [ ] **Step 4: Commit the matrix change**

```bash
git add src/utils/plan.js tests/unit/plan-matrix-contract.test.js
git commit -m "feat: tighten default plan packaging"
```

### Task 3: Align Plan-Facing APIs With The New Defaults

**Files:**
- Modify: `src/app/routes/admin/plan.js`
- Modify: `src/app/services/plan-config-service.js`
- Test: `tests/unit/admin-plan-contract.test.js`

- [ ] **Step 1: Write a focused test for the owner-visible plan response**

Add `tests/unit/admin-plan-contract.test.js` with a contract that asserts `/admin/plan`-style data is built from `planLimits()` and `planFeaturesWithOverrides()` without hidden legacy assumptions.

Use a focused pure-unit shape if possible:

```js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { planFeaturesWithOverrides, planLimits } from "../../src/utils/plan.js";

describe("admin plan response contract", () => {
  it("reflects tightened EMPRENDEDOR defaults without overrides", () => {
    const features = planFeaturesWithOverrides("EMPRENDEDOR", {});
    const limits = planLimits("EMPRENDEDOR");

    assert.equal(features.lifecycle_automation, false);
    assert.equal(features.analytics, false);
    assert.equal(features.rewards, true);
    assert.equal(limits.branches, 1);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `node --test tests/unit/admin-plan-contract.test.js`

Expected: PASS once the matrix update is in place.

- [ ] **Step 3: Review `src/app/routes/admin/plan.js` and `src/app/services/plan-config-service.js` for any hardcoded assumptions**

Keep the current API contract:

```js
const response = { ok: true, plan: business.plan, limits, features };
```

Only change code if you find stale comments or old packaging assumptions. Do not add new override systems in this pass.

- [ ] **Step 4: Re-run the focused plan tests**

Run: `node --test tests/unit/plan-matrix-contract.test.js tests/unit/admin-plan-contract.test.js`

Expected: PASS

- [ ] **Step 5: Commit API alignment**

```bash
git add src/app/routes/admin/plan.js src/app/services/plan-config-service.js tests/unit/admin-plan-contract.test.js
git commit -m "test: align plan api with new defaults"
```

### Task 4: Align Pricing And Internal Docs With The New Packaging

**Files:**
- Modify: `docs/PRICING_ES.md`
- Modify: `docs/PRICING_GUATEMALA.md`
- Modify: `docs/2026-04-02-standard-vs-paywalled-recommendation.md`

- [ ] **Step 1: Update the pricing docs so feature bullets match the new packaging**

Apply this structure in prose:

```md
### EMPRENDEDOR
- QR y cartera de cliente
- puntos, recompensas y canjes
- reglas básicas
- un local
- personal básico

### NEGOCIO
- todo lo anterior
- analítica
- niveles
- referidos
- exportación
- multi-sucursal
- gift cards
- campañas
- webhooks
- automatizaciones
- branding premium para superficies de cliente

### EMPRESA
- todo lo anterior
- gamificación
- integraciones / external awards
- branding avanzado
- futuro dominio propio
- futuro logo dentro del QR
```

- [ ] **Step 2: Remove any conflicting statements that still imply broader base-plan access**

Specifically fix any mention that implies:
- lifecycle automation is base-plan
- branding upgrades are base-plan
- gift cards are enterprise-only if we are placing them in `NEGOCIO`

- [ ] **Step 3: Save the docs without changing public marketing copy yet**

This pass updates source-of-truth documentation only. Do not reintroduce pricing sections on the landing page.

- [ ] **Step 4: Commit the doc alignment**

```bash
git add docs/PRICING_ES.md docs/PRICING_GUATEMALA.md docs/2026-04-02-standard-vs-paywalled-recommendation.md
git commit -m "docs: align pricing docs with plan packaging"
```

### Task 5: Full Verification

**Files:**
- Verify only

- [ ] **Step 1: Run focused unit coverage for the plan work**

Run: `node --test tests/unit/plan-matrix-contract.test.js tests/unit/admin-plan-contract.test.js`

Expected: PASS

- [ ] **Step 2: Run the linter**

Run: `npm run lint`

Expected: PASS

- [ ] **Step 3: Run the default unit suite**

Run: `npm run test:unit`

Expected: PASS

- [ ] **Step 4: Record any follow-up intentionally left out of scope**

Document, but do not implement in this pass:
- per-business grandfathering overrides
- public pricing-page UI updates
- QR logo premium feature implementation

- [ ] **Step 5: Commit any final touch-ups**

```bash
git add -A
git commit -m "chore: finish plan packaging update"
```

## Self-Review

Spec coverage:
- New default plan matrix: covered in Tasks 1-2
- Keep existing businesses unaffected: explicitly simplified out because there are no real production tenants yet; documented as future work
- Align plan responses/docs: covered in Tasks 3-4
- Do not build QR logo feature yet: preserved as out of scope in Task 5

Placeholder scan:
- No TODO/TBD placeholders remain
- All tasks name concrete files and commands

Type consistency:
- Uses existing helpers `planFeatures`, `planFeaturesWithOverrides`, and `planLimits`
- Does not invent a new override model in this pass
