# Premium QR Branding Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Tasks 5 and 6 as one integrated pass: premium QR logo embedding with safe fallback, `/api/customer/me` plan and branding data, and the owner-side `qr_logo_enabled` control gated to `EMPRESA`.

**Architecture:** Keep the change narrow. Persist the new branding flag through the existing admin branding route and schema, extend the customer `/me` payload with the already-owned business plan and branding object, then let the customer QR renderer make a best-effort SVG decoration decision from `#qrWrap` dataset values. The plain QR path remains the default and survives all decoration failures.

**Tech Stack:** Express, Zod, plain browser JS modules, DOM/SVG APIs, Node test runner, ESLint

---

### Task 1: Lock The New Behavior In Tests

**Files:**
- Modify: `tests/unit/customer-qr-premium-gating.test.js`
- Modify: `tests/unit/admin-branding-routes.test.js`

- [ ] **Step 1: Extend the QR gating contract**

Add assertions that reject missing/relative logo URLs and only allow `EMPRESA` with explicit enablement.

- [ ] **Step 2: Extend the admin branding route contract**

Add `qr_logo_enabled: true` to the persisted branding fixture and verify GET/PUT preserve it.

- [ ] **Step 3: Run the focused tests to verify they fail**

Run: `node --test tests/unit/customer-qr-premium-gating.test.js tests/unit/admin-branding-routes.test.js`

Expected: FAIL because the QR helper and branding schema/route do not yet support the new field/constraints.

### Task 2: Implement The Integrated Pass

**Files:**
- Modify: `public/customer/qr.js`
- Modify: `public/customer/me.js`
- Modify: `src/app/routes/customer-routes.js`
- Modify: `src/utils/schemas.js`
- Modify: `src/app/routes/admin/branding-routes.js`
- Modify: `public/admin-dashboard/fragments/branding.html`
- Modify: `public/admin-dashboard/modules/branding-form.js`

- [ ] **Step 1: Add the backend data path**

Include `business.plan` in `/api/customer/me` and add `qr_logo_enabled` to the branding schema used by the admin branding route.

- [ ] **Step 2: Persist QR dataset values in the customer wallet**

Write `plan`, `logoUrl`, and `qrLogoEnabled` into `#qrWrap.dataset` after rendering from `/api/customer/me`.

- [ ] **Step 3: Add helper and fallback-first QR decoration**

Export `shouldEmbedQrLogo()` from `public/customer/qr.js`, decorate the parsed SVG only for `EMPRESA` + absolute URL + explicit enablement, and swallow decoration errors so the plain QR still renders.

- [ ] **Step 4: Expose and gate the owner toggle**

Add the `qr_logo_enabled` checkbox/hint to branding controls, include it in form build/fill, and disable it unless the current plan is exactly `EMPRESA`.

- [ ] **Step 5: Run the focused tests to verify they pass**

Run: `node --test tests/unit/customer-qr-premium-gating.test.js tests/unit/admin-branding-routes.test.js`

Expected: PASS

### Task 3: Verify

**Files:**
- Verify only

- [ ] **Step 1: Run the required lint command**

Run: `npm run lint`

Expected: PASS
