import { test, expect } from "@playwright/test";
import { startPwaStaticServer } from "../integration/helpers/pwa-static-server.js";

test.use({ serviceWorkers: "block" });
let server;
test.beforeAll(async () => { server = await startPwaStaticServer(); });
test.afterAll(async () => { await server.stop(); });
const scope = { businessId: "business-a", staffId: "staff-a" };

async function setup(page) {
  await page.route("**/equipo/ingresar/", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><html lang=es><title>Ingresar</title><body>Inicia sesión</body></html>" }));
  const state = { offline: false, authenticated: true, loseAck: false, grantAvailable: true, permissions: ["staff.award", "staff.sync", "staff.redeem"], awards: [], syncs: [], storedAtSend: 0, lookups: 0 };
  await page.route("**/api/**", async (route) => {
    if (state.offline) return route.abort("internetdisconnected");
    const pathname = new URL(route.request().url()).pathname;
    let response;
    if (pathname === "/api/staff/me") {
      if (!state.authenticated) return route.fulfill({ status: 401, json: { code: "AUTH_REQUIRED", error: "No autenticado" } });
      response = { staff: { id: scope.staffId, business_id: scope.businessId, role: "OWNER", can_manage_gift_cards: true }, features: { redemptions: true, gift_cards: true } };
    } else if (pathname === "/api/staff/permissions") response = { matrix: { OWNER: state.permissions } };
    else if (pathname === "/api/staff/program") response = { program_type: "SPEND", program_json: { points_per_q: 1 } };
    else if (pathname === "/api/staff/offline-grant") {
      if (!state.grantAvailable) return route.fulfill({ status: 503, json: { error: "Grant temporarily unavailable" } });
      response = { ok: true, grant: "server-signed-offline-grant", expiresAt: new Date(Date.now() + 86400000).toISOString() };
    }
    else if (pathname === "/api/staff/rewards") response = { rewards: [{ id: "reward-a", name: "Café", points_cost: 20 }] };
    else if (pathname === "/api/staff/customer/lookup") { state.lookups++; response = { customer: { id: "customer-a", name: "Cliente", phone: "50255554444", points: 100 } }; }
    else if (pathname === "/api/staff/award") {
      state.awards.push(route.request().postDataJSON());
      state.storedAtSend = await page.evaluate(async (identity) => (await (await import("/idb.js")).listAwards(identity)).length, scope);
      if (state.loseAck) return route.abort("failed");
      response = { customerId: "customer-a", pointsAwarded: 10, newBalance: 110 };
    } else if (pathname === "/api/staff/sync") {
      const body = route.request().postDataJSON(); state.syncs.push(body.awards);
      response = { results: body.awards.map(({ txId }) => ({ txId, ok: true })) };
    } else response = { ok: true };
    return route.fulfill({ json: response });
  });
  return state;
}
async function openStaff(page) {
  await page.goto(`${server.baseUrl}/staff?sw=noreload`);
  await expect(page.locator("#programInfo")).toContainText("Regla activa");
  // The initial HTML already has queue totals, before the grant request and
  // session snapshot finish. These runtime-only messages confirm readiness.
  await expect(page.locator("#queueMeta")).toContainText(/Captura sin conexión disponible|Conéctate para habilitar la captura/);
}
async function selectCustomer(page) {
  await page.fill("#token", "signed-qr-token");
  await page.click("#btnSelectCustomer");
  await expect(page.locator("#btnAward")).toBeEnabled();
}

for (const status of [200, 404]) {
  test(`a delayed customer lookup (${status}) cannot replace the newer selection`, async ({ page }) => {
    await setup(page); await openStaff(page);
    let firstLookup;
    await page.route("**/api/staff/customer/lookup", async route => {
      const token = route.request().postDataJSON().customerQrToken;
      if (token === "customer-first") { firstLookup = route; return; }
      await route.fulfill({ json: { customer: { id: "customer-second", name: "Segundo", points: 30 } } });
    });
    await page.fill("#token", "customer-first");
    await page.click("#btnSelectCustomer");
    await expect.poll(() => Boolean(firstLookup)).toBe(true);
    await page.fill("#token", "customer-second");
    await page.click("#btnSelectCustomer");
    await expect(page.locator("#lastCustomer")).toHaveText("customer-second");
    const completed = page.waitForResponse(response => response.url().endsWith("/customer/lookup") && response.request().postDataJSON().customerQrToken === "customer-first");
    await firstLookup.fulfill({ status, json: status === 200
      ? { customer: { id: "customer-first", name: "Primero", points: 100 } }
      : { error: "Cliente anterior no disponible" } });
    await (await completed).finished();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(page.locator("#lastCustomer")).toHaveText("customer-second");
    await expect(page.locator("#lastCustomerName")).toHaveText("Segundo");
    await expect(page.locator("#lastBalance")).toHaveText("30");
  });
}

test("an award completed for the previous customer does not overwrite the new selection", async ({ page }) => {
  const state = await setup(page); await openStaff(page); await selectCustomer(page);
  let awardRequest;
  await page.route("**/api/staff/award", route => { awardRequest = route; });
  await page.click("#btnAward");
  await expect.poll(() => Boolean(awardRequest)).toBe(true);
  await page.route("**/api/staff/customer/lookup", route => route.fulfill({ json: {
    customer: { id: "customer-b", name: "Segundo", phone: "50255558888", points: 30 }
  } }));
  await page.fill("#token", "customer-b-token");
  await page.click("#btnSelectCustomer");
  await expect(page.locator("#lastCustomer")).toHaveText("customer-b");
  await awardRequest.fulfill({ json: { customerId: "customer-a", pointsAwarded: 10, newBalance: 110 } });
  await expect(page.locator("#queueBadge")).toHaveText("Cola: 0");
  await expect(page.locator("#btnAward")).toBeEnabled();
  await expect(page.locator("#lastCustomer")).toHaveText("customer-b");
  await expect(page.locator("#lastCustomerName")).toHaveText("Segundo");
  await expect(page.locator("#lastBalance")).toHaveText("30");
  await page.unroute("**/api/staff/award");
  await page.click("#btnAward");
  await expect.poll(() => state.awards.length).toBe(1);
  expect(state.awards[0].customerQrToken).toBe("customer-b-token");
});

test("online award is persisted before sending and double clicks cannot create another UUID", async ({ page }) => {
  const state = await setup(page); await openStaff(page); await selectCustomer(page);
  await page.locator("#btnAward").evaluate((button) => { button.dispatchEvent(new Event("click")); button.dispatchEvent(new Event("click")); });
  await expect.poll(() => state.awards.length).toBe(1);
  await expect(page.locator("#queueBadge")).toHaveText("Cola: 0");
  expect(state.storedAtSend).toBe(1);
  expect(state.awards[0].client_ts).toBeTruthy();
  expect(state.awards[0].txId).toMatch(/^[\da-f-]{36}$/i);
});

test("offline capture stays unverified and reconnect automatically submits its stable operation", async ({ page, context }) => {
  const state = await setup(page); await openStaff(page);
  state.offline = true; await context.setOffline(true);
  await page.fill("#token", "raw-unverified-qr");
  await page.click("#btnSelectCustomer");
  await expect(page.locator("#btnAward")).toBeEnabled();
  await expect(page.locator("#customerActionStatus")).toContainText(/verificar|verificará/i);
  await page.click("#btnAward");
  await expect(page.locator("#queueBadge")).toHaveText("Cola: 1");
  expect(state.lookups).toBe(0);
  expect(state.awards).toHaveLength(0);
  state.offline = false; await context.setOffline(false);
  await expect(page.locator("#queueBadge")).toHaveText("Cola: 0");
  expect(state.syncs).toHaveLength(1);
  expect(state.syncs[0][0].offlineGrant).toBe("server-signed-offline-grant");
  expect(state.syncs[0][0].customerQrToken).toBe("raw-unverified-qr");
});

test("startup drains over 200 operations in chunks without touching another account or legacy rows", async ({ page }) => {
  const state = await setup(page);
  await page.goto(`${server.baseUrl}/pwa-test/index.html`);
  await page.evaluate(async (identity) => {
    const db = await import("/idb.js");
    for (let i = 0; i < 251; i++) await db.addAward({ txId: crypto.randomUUID(), ...identity, customerQrToken: "signed-qr", amount_q: 10, visits: 1, items: 1, meta: { ui: "staff" } });
    await db.addAward({ txId: "foreign", businessId: "other", staffId: "other" });
    await db.addAward({ txId: "legacy" });
  }, scope);
  await openStaff(page);
  await expect.poll(() => state.syncs.reduce((count, rows) => count + rows.length, 0)).toBe(251);
  expect(state.syncs.map((rows) => rows.length)).toEqual([100, 100, 51]);
  await expect(page.locator("#queueBadge")).toHaveText("Cola: 0");
  await expect(page.locator("#queueMeta")).toContainText(/sin identidad/i);
});

test("authentication failure stops the award before persistence or sending", async ({ page }) => {
  const state = await setup(page); await openStaff(page); await selectCustomer(page);
  state.authenticated = false;
  await page.click("#btnAward");
  await expect.poll(() => page.url()).toContain("/equipo/ingresar/");
  expect(state.awards).toHaveLength(0);
  const rows = await page.evaluate(async (identity) => (await import("/idb.js")).listAwards(identity), scope);
  expect(rows).toEqual([]);
});

test("lost award acknowledgment is retried automatically with the original UUID", async ({ page }) => {
  const state = await setup(page); await openStaff(page); await selectCustomer(page);
  state.loseAck = true; await page.click("#btnAward");
  await expect(page.locator("#queueBadge")).toHaveText("Cola: 1");
  await expect.poll(() => state.awards.length).toBe(1);
  await expect(page.locator("#queueMeta")).toContainText("Fallidos: 1");
  const txId = state.awards[0].txId;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.locator("#queueBadge")).toHaveText("Cola: 0");
  expect(state.syncs[0][0].txId).toBe(txId);
});

test("redemptions and gift-card spending are explicitly unavailable offline", async ({ page, context }) => {
  const state = await setup(page); await openStaff(page); await selectCustomer(page);
  await expect(page.locator("#btnRedeem")).toBeEnabled();
  state.offline = true; await context.setOffline(true);
  await expect(page.locator("#btnRedeem")).toBeDisabled();
  await expect(page.locator("#btnGiftRedeem")).toBeDisabled();
  await expect(page.locator("#customerRewardState")).toContainText(/conexión/i);
});

test("storage quota failures stop an online award and explain that it was not safely saved", async ({ page }) => {
  const state = await setup(page); await openStaff(page); await selectCustomer(page);
  await page.evaluate(() => { IDBObjectStore.prototype.add = () => { throw new DOMException("Quota exceeded", "QuotaExceededError"); }; });
  await page.click("#btnAward");
  await expect(page.locator("#customerActionStatus")).toContainText(/almacenamiento|guardar/i);
  expect(state.awards).toHaveLength(0);
});

test("revoked online permissions cannot be replaced with older cached permissions", async ({ page }) => {
  const state = await setup(page); await openStaff(page); await selectCustomer(page);
  state.permissions = [];
  await page.click("#btnAward");
  await expect(page.locator("#btnAward")).toBeDisabled();
  expect(state.awards).toHaveLength(0);
  expect(await page.evaluate(async (identity) => (await import("/idb.js")).listAwards(identity), scope)).toEqual([]);
});

test("grant outages allow online awards but do not claim offline capture is ready", async ({ page, context }) => {
  const state = await setup(page); state.grantAvailable = false;
  await openStaff(page); await selectCustomer(page);
  await page.click("#btnAward");
  await expect.poll(() => state.awards.length).toBe(1);
  await expect(page.locator("#queueMeta")).toContainText("Conéctate para habilitar");
  state.offline = true; await context.setOffline(true);
  await expect(page.locator("#btnAward")).toBeDisabled();
});

test("invalid sale amounts are corrected before creating a permanent queued operation", async ({ page }) => {
  const state = await setup(page); await openStaff(page); await selectCustomer(page);
  await page.fill("#amount", "-10");
  await page.click("#btnAward");
  await expect(page.locator("#customerActionStatus")).toContainText(/monto|cantidades/i);
  expect(state.awards).toHaveLength(0);
  expect(await page.evaluate(async (identity) => (await import("/idb.js")).listAwards(identity), scope)).toEqual([]);
});

test("offline logout blocks the local session and retries server logout after reconnect", async ({ page, context }) => {
  const state = await setup(page); await openStaff(page); await selectCustomer(page);
  state.offline = true; await context.setOffline(true);
  await page.click("#btnLogout");
  await expect(page.locator("#toast")).toContainText(/bloqueada|pendiente/i);
  await expect(page.locator("#btnAward")).toBeDisabled();
  expect(await page.evaluate(() => localStorage.getItem("pf_staff_logout_pending"))).toBe("1");
  state.offline = false; await context.setOffline(false);
  await expect.poll(() => page.url()).toContain("/equipo/ingresar/");
  expect(await page.evaluate(() => localStorage.getItem("pf_staff_logout_pending"))).toBeNull();
});

test("logout or account replacement in another tab invalidates cached staff authority", async ({ page, context }) => {
  await setup(page); await openStaff(page); await selectCustomer(page);
  const second = await context.newPage();
  await second.goto(`${server.baseUrl}/pwa-test/index.html`);
  await second.evaluate(() => {
    localStorage.removeItem("pf_staff_snapshot");
    localStorage.setItem("pf_staff_epoch", crypto.randomUUID());
  });
  await expect(page.locator("#btnAward")).toBeDisabled();
  await expect.poll(() => page.url()).toContain("/equipo/ingresar/");
});
