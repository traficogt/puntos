# App Entry Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the product to the approved app-entry architecture: marketing-only root domain, app-only product domain, Spanish-first customer entry via `/registro/:slug`, and role-based operational entry under the app host.

**Architecture:** Keep one shared Express app, but make host-aware routing and customer-facing URLs canonical to the approved split. Preserve backward compatibility where needed by redirecting old customer entry paths, while leaving internal and operational routes stable for now.

**Tech Stack:** Node.js, Express, static HTML/CSS/JS entrypoints, existing host-aware runtime config, Node test runner, ESLint, Docker Compose.

---

## File Structure

### Existing files to modify

- `src/app/server.js`
  Host-aware route handling and friendly HTML routes.
- `src/utils/app-host-routing.js`
  Marketing-vs-app redirect rules and app-route detection.
- `public/join.html`
  Current customer registration surface to be renamed conceptually to `registro`.
- `public/join.js`
  Customer registration client logic tied to the current route and copy.
- `public/customer.html`
  Customer wallet entry copy that currently references `/join/<slug>`.
- `public/customer/index.js`
  Customer cold-entry helper logic that currently routes to `/join/:slug`.
- `public/admin.js`
  Internal business creation flow that currently builds join links.
- `docs/2026-04-02-app-entry-architecture-design.md`
  Approved architecture spec; update only if implementation clarifies a route detail.

### Existing tests to modify

- `tests/unit/app-host-routing.test.js`
  Host-aware route detection and redirect rules.
- `tests/unit/marketing-app-entry.test.js`
  Marketing/app separation contract.
- `tests/unit/runtime-config-route-contract.test.js`
  Server route contract for runtime-config and static behavior.

### New tests to add

- `tests/unit/customer-route-language-contract.test.js`
  Spanish-first customer URL contract and backward-compatibility expectations.

### No new framework or subsystem needed

- Do not introduce a route alias registry, router abstraction, or new SPA shell.
- Do not rename staff/admin operational routes in this pass.
- Do not implement multi-program customer switching in this pass.

---

### Task 1: Lock the Spanish-First Customer Route Contract

**Files:**
- Modify: `tests/unit/app-host-routing.test.js`
- Modify: `tests/unit/marketing-app-entry.test.js`
- Add: `tests/unit/customer-route-language-contract.test.js`
- Test: `tests/unit/app-host-routing.test.js`
- Test: `tests/unit/marketing-app-entry.test.js`
- Test: `tests/unit/customer-route-language-contract.test.js`

- [ ] **Step 1: Write the failing route-language contract test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("customer-facing routes use /registro while preserving temporary compatibility for /join", () => {
  const joinHtml = fs.readFileSync(new URL("../../public/join.html", import.meta.url), "utf8");
  const customerHtml = fs.readFileSync(new URL("../../public/customer.html", import.meta.url), "utf8");
  const customerJs = fs.readFileSync(new URL("../../public/customer/index.js", import.meta.url), "utf8");
  const adminJs = fs.readFileSync(new URL("../../public/admin.js", import.meta.url), "utf8");

  assert.match(customerHtml, /\/registro\/&lt;slug&gt;/);
  assert.match(customerJs, /location\.href = `\/registro\//);
  assert.match(adminJs, /\/registro\//);
  assert.doesNotMatch(customerHtml, /\/join\/&lt;slug&gt;/);
  assert.match(joinHtml, /Registro/);
});
```

- [ ] **Step 2: Run the new test to verify it fails**

Run:

```bash
node --test tests/unit/customer-route-language-contract.test.js
```

Expected: FAIL because customer-facing HTML/JS still references `/join`.

- [ ] **Step 3: Extend the host-routing tests for `/registro/:slug`**

```js
test("app route detection covers spanish-first customer registration routes", () => {
  assert.equal(isAppRoutePath("/registro/cafe-bourbon"), true);
  assert.equal(isAppRoutePath("/join/cafe-bourbon"), true);
});
```

- [ ] **Step 4: Run the route tests to verify the new assertion fails**

Run:

```bash
node --test tests/unit/app-host-routing.test.js
```

Expected: FAIL because `isAppRoutePath()` does not yet include `/registro/:slug`.

- [ ] **Step 5: Commit the test-only red state**

```bash
git add tests/unit/app-host-routing.test.js tests/unit/customer-route-language-contract.test.js
git commit -m "test: lock spanish-first customer route contract"
```

---

### Task 2: Implement Canonical `/registro/:slug` Routing With Backward Compatibility

**Files:**
- Modify: `src/utils/app-host-routing.js`
- Modify: `src/app/server.js`
- Test: `tests/unit/app-host-routing.test.js`
- Test: `tests/unit/runtime-config-route-contract.test.js`

- [ ] **Step 1: Update app-route detection to treat both `/registro/:slug` and `/join/:slug` as app routes**

```js
export function isAppRoutePath(path) {
  const normalized = normalizePath(path);
  return normalized === "/admin"
    || normalized === "/admin.html"
    || normalized === "/admin-dashboard"
    || normalized === "/admin-dashboard.html"
    || normalized === "/staff/login"
    || normalized === "/staff-login.html"
    || normalized === "/staff"
    || normalized === "/staff.html"
    || normalized === "/c"
    || normalized === "/customer.html"
    || normalized === "/super"
    || normalized === "/super.html"
    || normalized === "/join.html"
    || normalized === "/registro.html"
    || /^\/join\/[^/]+$/i.test(normalized)
    || /^\/registro\/[^/]+$/i.test(normalized);
}
```

- [ ] **Step 2: Add the canonical friendly route and old-path redirect**

```js
app.get("/registro/:slug", (req, res) => res.sendFile(path.join(publicDir, "join.html")));

app.get("/join/:slug", (req, res) => {
  const slug = encodeURIComponent(String(req.params.slug || "").trim());
  return res.redirect(302, `/registro/${slug}`);
});
```

- [ ] **Step 3: Keep app-host redirect behavior aligned with the new route**

```js
const redirectTo = resolveHostSplitRedirect({
  host: req.get("host"),
  path: req.path,
  originalUrl: req.originalUrl,
  appOrigin: config.APP_ORIGIN,
  marketingOrigin: config.MARKETING_ORIGIN
});
```

No new logic is needed in the middleware if `isAppRoutePath()` covers `/registro/:slug`. The important fix is to let the existing host split treat the new path as app-only traffic.

- [ ] **Step 4: Run the routing tests to verify they pass**

Run:

```bash
node --test tests/unit/app-host-routing.test.js tests/unit/runtime-config-route-contract.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit the routing implementation**

```bash
git add src/utils/app-host-routing.js src/app/server.js tests/unit/app-host-routing.test.js tests/unit/runtime-config-route-contract.test.js
git commit -m "feat: add canonical registro customer route"
```

---

### Task 3: Update Customer-Facing Surfaces To Use Spanish-First URLs

**Files:**
- Modify: `public/join.html`
- Modify: `public/join.js`
- Modify: `public/customer.html`
- Modify: `public/customer/index.js`
- Modify: `public/admin.js`
- Test: `tests/unit/customer-route-language-contract.test.js`

- [ ] **Step 1: Update customer wallet cold-entry copy**

```html
<p class="small">Abre <code>/registro/&lt;slug&gt;</code> o ingresa el slug aquí.</p>
```

```html
<p id="customerEntrySubtitle">Regístrate en un negocio para comenzar. El negocio te comparte un enlace con su slug.</p>
```

- [ ] **Step 2: Update customer wallet navigation logic**

```js
safeOn($, "#btnGoJoin", "click", () => {
  const slug = (safeEl($, "#slug")?.value || "").trim();
  if (!slug) return toast("Escribe el slug");
  localStorage.setItem("pf_customer_slug", slug);
  location.href = `/registro/${encodeURIComponent(slug)}`;
});
```

- [ ] **Step 3: Update join completion and internal link generation**

In `public/admin.js`:

```js
const join = `${location.origin}/registro/${out.business.slug}`;
```

In `public/join.html`:

```html
<a class="button-link button-link-primary" href="/c">Abrir mi tarjeta</a>
```

Keep the file name `join.html` for this pass to avoid unnecessary churn in static asset wiring. The route and public wording are what change now.

- [ ] **Step 4: Run the customer-route contract test and verify it passes**

Run:

```bash
node --test tests/unit/customer-route-language-contract.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit the customer-facing URL update**

```bash
git add public/join.html public/join.js public/customer.html public/customer/index.js public/admin.js tests/unit/customer-route-language-contract.test.js
git commit -m "feat: use spanish-first customer entry urls"
```

---

### Task 4: Align Marketing/App Separation With The Approved Entry Model

**Files:**
- Modify: `tests/unit/marketing-app-entry.test.js`
- Modify: `src/app/server.js`
- Test: `tests/unit/marketing-app-entry.test.js`
- Test: `tests/unit/app-host-routing.test.js`

- [ ] **Step 1: Add a test that the marketing host redirects both `/registro/:slug` and `/staff/login` into the app origin**

```js
test("marketing host sends customer registration and team routes to the app origin", () => {
  const registroRedirect = resolveHostSplitRedirect({
    host: "localhost:3001",
    path: "/registro/cafe-bourbon",
    originalUrl: "/registro/cafe-bourbon",
    appOrigin: "http://app.localhost:3001",
    marketingOrigin: "http://localhost:3001"
  });

  assert.equal(registroRedirect, "http://app.localhost:3001/registro/cafe-bourbon");
});
```

- [ ] **Step 2: Confirm the app root still resolves operationally**

No route change is required if the current root redirect remains:

```js
if (normalizedHost === appHost && (normalizedPath === "/" || normalizedPath === "/index.html")) {
  return new URL("/staff/login", appOrigin).toString();
}
```

- [ ] **Step 3: Run the separation tests**

Run:

```bash
node --test tests/unit/marketing-app-entry.test.js tests/unit/app-host-routing.test.js
```

Expected: PASS.

- [ ] **Step 4: Commit the route-separation confirmation**

```bash
git add tests/unit/marketing-app-entry.test.js tests/unit/app-host-routing.test.js src/app/server.js
git commit -m "test: confirm marketing and app entry separation"
```

---

### Task 5: Full Verification And Live Local Rehearsal

**Files:**
- Test: `tests/unit/marketing-demo-contact-contract.test.js`
- Test: `tests/unit/marketing-app-entry.test.js`
- Test: `tests/unit/customer-route-language-contract.test.js`
- Test: `tests/unit/app-host-routing.test.js`
- Test: `tests/unit/runtime-config-route-contract.test.js`
- Test: `tests/unit/ui-visibility.test.js`
- Test: `tests/unit/theme-preference.test.js`
- Test: `tests/unit/landing-page-contract.test.js`
- Test: `tests/unit/helmet-csp.test.js`
- Test: `tests/unit/marketing-shell-cache-bust.test.js`

- [ ] **Step 1: Run the route and landing contract suite**

Run:

```bash
node --test \
  tests/unit/marketing-demo-contact-contract.test.js \
  tests/unit/marketing-app-entry.test.js \
  tests/unit/customer-route-language-contract.test.js \
  tests/unit/app-host-routing.test.js \
  tests/unit/runtime-config-route-contract.test.js \
  tests/unit/ui-visibility.test.js \
  tests/unit/theme-preference.test.js \
  tests/unit/landing-page-contract.test.js \
  tests/unit/helmet-csp.test.js \
  tests/unit/marketing-shell-cache-bust.test.js
```

Expected: all tests pass, `0 fail`.

- [ ] **Step 2: Run lint**

Run:

```bash
npm run lint
```

Expected: exit `0`.

- [ ] **Step 3: Rebuild the API container**

Run:

```bash
docker compose up -d --build api
```

Expected: `puntos-api-1` returns to `healthy`.

- [ ] **Step 4: Rehearse the host split from inside the container**

Run:

```bash
docker compose exec -T api node -e "const http=require('http');const checks=[['localhost:3001','/'],['app.localhost:3001','/'],['localhost:3001','/registro/cafe-bourbon'],['localhost:3001','/staff/login'],['app.localhost:3001','/staff/login']];(async()=>{for(const [host,path] of checks){await new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port:3001,path,headers:{Host:host}},res=>{console.log(host,path,res.statusCode,res.headers.location||'');res.resume();res.on('end',resolve);});req.on('error',reject);req.end();});}})().catch(err=>{console.error(err);process.exit(1);});"
```

Expected:

- `localhost:3001 /` -> `200`
- `app.localhost:3001 /` -> `302` to `/staff/login`
- `localhost:3001 /registro/cafe-bourbon` -> `302` to app origin
- `localhost:3001 /staff/login` -> `302` to app origin
- `app.localhost:3001 /staff/login` -> `200`

- [ ] **Step 5: Final commit**

```bash
git add src/app/server.js src/utils/app-host-routing.js public/join.html public/join.js public/customer.html public/customer/index.js public/admin.js tests/unit/marketing-app-entry.test.js tests/unit/customer-route-language-contract.test.js tests/unit/app-host-routing.test.js docs/2026-04-02-app-entry-architecture-design.md
git commit -m "feat: implement app entry architecture"
```

---

## Self-Review

### Spec Coverage

Covered:

- marketing-only domain behavior
- app-only product domain behavior
- operational default root on app host
- Spanish-first customer route naming
- customer entry and return flow
- shared staff/owner login posture
- backward-compatible handling for the old customer route

Not included intentionally:

- renaming `/c`
- renaming internal operational routes
- custom domains
- multi-program customer switching

### Placeholder Scan

No placeholders remain. Each task names exact files, commands, and expected outcomes.

### Type And Naming Consistency

Plan uses:

- canonical customer route: `/registro/:slug`
- legacy compatibility route: `/join/:slug`
- wallet route remains `/c`
- operational root remains `/staff/login`

These names are consistent across every task.
