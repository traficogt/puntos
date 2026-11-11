import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";
import express from "express";
import { chromium, expect } from "@playwright/test";

// Optional external base selects static frontend files only. All API and external
// requests are intercepted; no database, messages or real passes are involved.
const publicDirectory = fileURLToPath(new URL("../../public/", import.meta.url));
const business = { id: "enrollment-business", slug: "cafe-prueba", name: "Café del Parque", plan: "PRO", features: {} };
const saveUrl = "https://pay.google.com/gp/v/save/testHeader.testPayload.testSignature";
function gate() {
  let release = () => {};
  const promise = new Promise(resolve => { release = () => resolve(undefined); });
  return { promise, release };
}

test("Wallet enrollment browser integration with isolated APIs", { timeout: 120000 }, async t => {
  let leakedApiRequests = 0;
  const app = express();
  app.all("/api/*", (_req, res) => { leakedApiRequests++; res.status(500).json({ error: "Unmocked API request" }); });
  app.get("/registro/:slug", (_req, res) => res.sendFile("join.html", { root: publicDirectory }));
  app.get("/ingresar/:slug", (_req, res) => res.sendFile("ingresar.html", { root: publicDirectory }));
  app.use(express.static(publicDirectory));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = new URL(process.env.WALLET_ENROLLMENT_BASE_URL || `http://127.0.0.1:${address.port}`);
  assert.ok(["http:", "https:"].includes(base.protocol) && !base.username && !base.password && !base.search && !base.hash);
  const origin = base.origin;
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  t.after(async () => {
    await browser.close(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    assert.equal(leakedApiRequests, 0, "all API requests must be intercepted");
  });

  async function fixture(st, options = {}) {
    const state = { session: "none", customerId: "enrollment-customer", providers: { apple: true, google: true },
      walletFailures: 0, mode: "register", viewport: { width: 390, height: 844 }, theme: "light", issueGate: null,
      verifyGate: null, meFailuresAfterVerify: 0, verified: false, source: "", sourceFailure: false, ...options,
      calls: [], unexpected: [], providerNavigations: [], errors: [] };
    const csrf = randomUUID();
    const context = await browser.newContext({ viewport: state.viewport, serviceWorkers: "block" });
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    page.on("pageerror", error => state.errors.push(error.message));
    await context.addCookies([{ name: "pf_csrf_readable", value: csrf, url: origin }]);
    await context.addInitScript(theme => localStorage.setItem("pf-theme", theme), state.theme);
    await context.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method();
      if (path === "/runtime-config.js") return route.fulfill({ contentType: "application/javascript", body: "window.__PF_RUNTIME_CONFIG__ = {};" });
      if (path.startsWith("/api/")) {
        const payload = request.postData() ? request.postDataJSON() : null;
        state.calls.push({ path, method, payload, csrf: request.headers()["x-csrf-token"] });
        let status = 200, body;
        if (method !== "GET" && request.headers()["x-csrf-token"] !== csrf) {
          state.unexpected.push(`Missing CSRF: ${method} ${path}`); status = 403; body = { error: "CSRF inválido" };
        } else if (method === "GET" && path === `/api/public/business/${business.slug}`) body = business;
        else if (method === "GET" && path === "/api/customer/me") {
          if (state.verified && state.meFailuresAfterVerify-- > 0) return route.abort("connectionfailed");
          if (state.session === "none") { status = 401; body = { code: "AUTH_REQUIRED", error: "No autenticado" }; }
          else body = { business: state.session === "other" ? { ...business, id: "other-business" } : business,
            customer: { id: state.customerId, name: "María", phone: "50255551234", points: 125, pending_points: 12 } };
        } else if (method === "POST" && path === `/api/public/business/${business.slug}/acquisition/visit`) {
          if (state.sourceFailure) { status = 503; body = { error: "Unavailable" }; }
          else body = { ok: true, visit_token: "A".repeat(43) };
        }
        else if (method === "POST" && /^\/api\/public\/business\/cafe-prueba\/(join|login)\/request-code$/.test(path)) body = { ok: true };
        else if (method === "POST" && /^\/api\/public\/business\/cafe-prueba\/(join|login)\/verify$/.test(path)) {
          await state.verifyGate?.promise;
          if (payload.code !== "123456") { status = 400; body = { code: "CODE_INVALID", error: "Código inválido. Revisa el código e inténtalo de nuevo." }; }
          else { state.session = "same"; state.verified = true; body = { ok: true, customer: { id: state.customerId } }; }
        } else if (method === "GET" && path === "/api/customer/wallet") {
          if (state.walletFailures-- > 0) { status = 503; body = { error: "Opciones temporalmente no disponibles" }; }
          else body = { providers: state.providers, passes: [] };
        } else if (method === "POST" && ["/api/customer/wallet/apple", "/api/customer/wallet/google"].includes(path)) {
          await state.issueGate?.promise;
          body = { url: path.endsWith("apple") ? "/api/customer/wallet/apple/download" : saveUrl };
        } else if (method === "GET" && path === "/api/customer/wallet/apple/download") return route.fulfill({ status: 204 });
        else { state.unexpected.push(`${method} ${path}`); status = 500; body = { error: "Unexpected mocked endpoint" }; }
        return route.fulfill({ status, contentType: "application/json", headers: { "x-csrf-token": csrf }, body: JSON.stringify(body) });
      }
      if (url.origin !== origin) {
        if (process.env.WALLET_ENROLLMENT_ALLOW_FONTS === "1" && method === "GET" && url.protocol === "https:"
            && ["fonts.googleapis.com", "fonts.gstatic.com"].includes(url.hostname)) return route.continue();
        if (url.href === saveUrl) {
          state.providerNavigations.push(url.href);
          return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Intercepted Wallet destination</title><p>No pass created.</p>" });
        }
        // Fonts and analytics are intercepted too, making tests network independent.
        return route.fulfill({ contentType: request.resourceType() === "stylesheet" ? "text/css" : "application/javascript", body: "" });
      }
      if (method !== "GET") { state.unexpected.push(`Non-API mutation: ${method} ${path}`); return route.abort(); }
      return route.continue();
    });
    st.after(async () => {
      state.issueGate?.release(); state.verifyGate?.release();
      try { assert.deepEqual(state.errors, [], "no JavaScript errors"); assert.deepEqual(state.unexpected, [], "no unaccounted API calls"); }
      finally { await context.close(); }
    });
    const path = `/${state.mode === "login" ? "ingresar" : "registro"}/${business.slug}`;
    await page.goto(`${origin}${path}${state.source ? "?origen=" + state.source : ""}`, { waitUntil: "networkidle" });
    const issues = () => state.calls.filter(call => call.method === "POST" && /\/wallet\/(apple|google)$/.test(call.path));
    const messages = () => state.calls.filter(call => call.path.endsWith("/request-code"));
    const verifications = () => state.calls.filter(call => call.path.endsWith("/verify"));
    return { page, context, state, path, issues, messages, verifications };
  }

  async function noOverflow(page) {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "the enrollment must fit the viewport");
  }
  async function requestCode(h, phone = "55551234", name = "María") {
    await expect(h.page.locator("#joinForms")).toBeVisible();
    await expect(h.page.locator("#joinVerifyStage")).toBeHidden();
    await h.page.locator("#phone").fill(phone);
    if (await h.page.locator("#name").isVisible()) {
      await h.page.locator("#name").fill(name);
      await h.page.locator("#name").press("Enter");
    } else await h.page.locator("#phone").press("Enter");
    await expect(h.page.locator("#joinVerifyStage")).toBeVisible();
    await expect(h.page.locator("#joinRequestForm")).toBeHidden();
    await expect(h.page.locator("#code")).toBeFocused();
    await expect(h.page.locator("#phone")).toHaveJSProperty("readOnly", true);
    assert.equal(h.messages().length, 1, "keyboard submit must request a code once");
  }
  async function verifyCode(h, code = "123456") {
    await h.page.locator("#code").fill(code);
    await h.page.locator("#code").press("Enter");
  }

  for (const sourceFailure of [false, true]) {
    await t.test(`source enrollment preserves normal verification when attribution ${sourceFailure ? "is unavailable" : "works"}`, async st => {
      const h = await fixture(st, { source: "abcdefghijklmnop", sourceFailure });
      await requestCode(h);
      assert.equal(h.messages()[0].payload.visitToken, undefined);
      await verifyCode(h);
      await expect(h.page.locator("#done")).toBeVisible();
      assert.equal(h.verifications()[0].payload.visitToken, sourceFailure ? undefined : "A".repeat(43));
      assert.equal(h.state.calls.filter(call => call.path.endsWith("/acquisition/visit")).length, 1);
      assert.equal(await h.page.evaluate(() => Object.values(localStorage).some(value => value.includes("AAAAAAAAAAAA"))), false);
    });
  }

  for (const settings of [
    { label: "mobile", viewport: { width: 390, height: 844 }, theme: "light" },
    { label: "desktop", viewport: { width: 1440, height: 1000 }, theme: "dark" }
  ]) {
    await t.test(`${settings.label}: keyboard registration opens Wallet choices and issues only on click`, async st => {
      const h = await fixture(st, settings);
      if (process.env.WALLET_ENROLLMENT_ALLOW_FONTS === "1") {
        const loaded = await h.page.evaluate(async () => {
          await Promise.all(['400 16px "Inter"', '600 24px "Bricolage Grotesque"', '400 32px "Fraunces"'].map(font => document.fonts.load(font)));
          await document.fonts.ready;
          return ["Inter", "Bricolage Grotesque", "Fraunces"].every(family => Array.from(document.fonts).some(face => face.family.includes(family) && face.status === "loaded"));
        });
        assert.equal(loaded, true, "visual verification must load all three retained fonts");
      }
      await noOverflow(h.page);
      await h.page.screenshot({ path: `/tmp/wallet-enrollment-${settings.label}-phone.png`, fullPage: true });
      await requestCode(h);
      assert.deepEqual(h.messages()[0].payload, { phone: "55551234", name: "María" });
      await noOverflow(h.page);
      await h.page.screenshot({ path: `/tmp/wallet-enrollment-${settings.label}-code.png`, fullPage: true });
      await verifyCode(h);
      await expect(h.page.locator("#done")).toBeVisible();
      await expect(h.page.locator("#joinForms")).toBeHidden();
      await expect(h.page.locator("#btnAppleWallet")).toBeVisible();
      await expect(h.page.locator("#btnGoogleWallet")).toBeVisible();
      assert.equal(new URL(h.page.url()).pathname, h.path, "verification must not redirect to the dashboard");
      assert.equal(h.verifications().length, 1);
      assert.deepEqual(h.verifications()[0].payload, { phone: "55551234", code: "123456", name: "María" });
      assert.equal(h.issues().length, 0, "verification must not issue a pass automatically");
      await noOverflow(h.page);
      await h.page.screenshot({ path: `/tmp/wallet-enrollment-${settings.label}-ready.png`, fullPage: true });
      if (settings.label === "mobile") {
        await h.page.locator("#btnAppleWallet").click();
        await expect.poll(() => h.state.calls.filter(call => call.path.endsWith("/apple/download")).length).toBe(1);
      } else {
        await h.page.locator("#btnGoogleWallet").click();
        await expect.poll(() => h.state.providerNavigations.length).toBe(1);
      }
      assert.equal(h.issues().length, 1);
    });
  }

  await t.test("same-business login resumes without phone messages or pass issuance", async st => {
    const h = await fixture(st, { session: "same", mode: "login" });
    await expect(h.page.locator("#done")).toBeVisible();
    await expect(h.page.locator("#joinForms")).toBeHidden();
    await expect(h.page.locator("#btnGoogleWallet")).toBeVisible();
    assert.equal(h.messages().length, 0);
    assert.equal(h.verifications().length, 0);
    assert.equal(h.issues().length, 0);
    assert.equal(new URL(h.page.url()).pathname, h.path);
  });

  await t.test("a session for another business stays in the phone form", async st => {
    const h = await fixture(st, { session: "other" });
    await expect(h.page.locator("#joinForms")).toBeVisible();
    await expect(h.page.locator("#done")).toBeHidden();
    assert.equal(h.state.calls.filter(call => call.path === "/api/customer/wallet").length, 0);
    assert.equal(h.issues().length, 0);
  });

  await t.test("a rejected login code stays recoverable and changing phone resets the stage", async st => {
    const h = await fixture(st, { mode: "login" });
    await requestCode(h);
    await expect(h.page.locator("#btnResendCode")).toBeDisabled();
    await expect(h.page.locator("#verificationPhone")).toContainText("55551234");
    await verifyCode(h, "654321");
    await expect(h.page.locator("#joinVerifyFeedback")).toContainText("Código inválido");
    await expect(h.page.locator("#done")).toBeHidden();
    await expect(h.page.locator("#btnVerify")).toBeEnabled();
    assert.equal(h.issues().length, 0);
    await h.page.locator("#btnChangePhone").click();
    await expect(h.page.locator("#joinVerifyStage")).toBeHidden();
    await expect(h.page.locator("#joinRequestForm")).toBeVisible();
    await expect(h.page.locator("#phone")).toHaveJSProperty("readOnly", false);
    await expect(h.page.locator("#phone")).toBeFocused();
    await expect(h.page.locator("#code")).toHaveValue("");
    await expect(h.page.locator("#btnCode")).toBeEnabled();
  });

  await t.test("unavailable providers retain the authenticated web-card fallback", async st => {
    const h = await fixture(st, { providers: { apple: false, google: false } });
    await requestCode(h);
    await verifyCode(h);
    await expect(h.page.locator("#done")).toBeVisible();
    await expect(h.page.locator("#nativeWalletSection")).toBeHidden();
    await expect(h.page.locator("#done .join-web-card a")).toHaveAttribute("href", "/mi-tarjeta/");
    await expect(h.page.locator("#walletEnrollmentFeedback")).toContainText("navegador");
    assert.equal(h.issues().length, 0);
  });

  await t.test("a Wallet status failure can be retried without sending another code", async st => {
    const h = await fixture(st, { session: "same", walletFailures: 1 });
    await expect(h.page.locator("#done")).toBeVisible();
    await expect(h.page.locator("#btnRetryWallet")).toBeVisible();
    await expect(h.page.locator("#nativeWalletSection")).toBeHidden();
    await h.page.locator("#btnRetryWallet").click();
    await expect(h.page.locator("#btnGoogleWallet")).toBeVisible();
    await expect(h.page.locator("#btnRetryWallet")).toBeHidden();
    assert.equal(h.messages().length, 0);
    assert.equal(h.state.calls.filter(call => call.path === "/api/customer/wallet").length, 2);
    assert.equal(h.issues().length, 0);
  });

  await t.test("offline controls recover on reconnect without issuing a pass", async st => {
    const h = await fixture(st, { session: "same" });
    await expect(h.page.locator("#btnGoogleWallet")).toBeVisible();
    await h.context.setOffline(true);
    await expect(h.page.locator("#btnAppleWallet")).toBeDisabled();
    await expect(h.page.locator("#btnGoogleWallet")).toBeDisabled();
    await expect(h.page.locator("#nativeWalletStatus")).toContainText("sin conexión");
    await h.context.setOffline(false);
    await expect(h.page.locator("#btnGoogleWallet")).toBeEnabled();
    await expect.poll(() => h.state.calls.filter(call => call.path === "/api/customer/wallet").length).toBeGreaterThanOrEqual(2);
    assert.equal(h.issues().length, 0);
  });

  await t.test("network loss after successful verification retries Wallet without consuming another code", async st => {
    const h = await fixture(st, { meFailuresAfterVerify: 1 });
    await requestCode(h);
    await verifyCode(h);
    await expect(h.page.locator("#done")).toBeVisible();
    await expect(h.page.locator("#joinForms")).toBeHidden();
    await expect(h.page.locator("#btnRetryWallet")).toBeVisible();
    await expect(h.page.locator("#walletEnrollmentFeedback")).toContainText("verificado");
    await h.page.locator("#btnRetryWallet").click();
    await expect(h.page.locator("#btnGoogleWallet")).toBeVisible();
    assert.equal(h.messages().length, 1);
    assert.equal(h.verifications().length, 1);
    assert.equal(h.issues().length, 0);
  });

  await t.test("a different customer session on reconnect returns to verification", async st => {
    const h = await fixture(st, { session: "same" });
    await expect(h.page.locator("#done")).toBeVisible();
    await h.context.setOffline(true);
    h.state.customerId = "different-customer";
    await h.context.setOffline(false);
    await expect(h.page.locator("#joinForms")).toBeVisible();
    await expect(h.page.locator("#done")).toBeHidden();
    await expect(h.page.locator("#joinRequestFeedback")).toContainText("sesión cambió");
    assert.equal(h.issues().length, 0);
  });

  await t.test("cross-tab logout blocks navigation from a pending issue response", async st => {
    const issueGate = gate();
    const h = await fixture(st, { session: "same", issueGate });
    await expect(h.page.locator("#btnGoogleWallet")).toBeVisible();
    await h.page.locator("#btnGoogleWallet").click();
    await expect.poll(() => h.issues().length).toBe(1);
    const sibling = await h.context.newPage();
    await sibling.goto(`${origin}/icon.svg`);
    await sibling.evaluate(() => localStorage.setItem("pf_customer_epoch", crypto.randomUUID()));
    await expect(h.page.locator("#done")).toBeHidden();
    await expect(h.page.locator("#joinForms")).toBeVisible();
    const response = h.page.waitForResponse(res => new URL(res.url()).pathname === "/api/customer/wallet/google");
    issueGate.release();
    await response;
    await h.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined)))));
    assert.equal(h.state.providerNavigations.length, 0);
    assert.equal(new URL(h.page.url()).pathname, h.path);
  });

  await t.test("cross-tab logout invalidates an already pending verification response", async st => {
    const verifyGate = gate();
    const h = await fixture(st, { verifyGate });
    await requestCode(h);
    await verifyCode(h);
    await expect.poll(() => h.verifications().length).toBe(1);
    const sibling = await h.context.newPage();
    await sibling.goto(`${origin}/icon.svg`);
    await sibling.evaluate(() => localStorage.setItem("pf_customer_epoch", crypto.randomUUID()));
    await expect(h.page.locator("#joinRequestFeedback")).toContainText("sesión cambió");
    const response = h.page.waitForResponse(res => new URL(res.url()).pathname.endsWith("/join/verify"));
    verifyGate.release();
    await response;
    await expect(h.page.locator("#btnVerify")).toBeEnabled();
    await expect(h.page.locator("#done")).toBeHidden();
    await expect(h.page.locator("#joinRequestForm")).toBeVisible();
    assert.equal(h.state.calls.filter(call => call.path === "/api/customer/wallet").length, 0);
  });
});
