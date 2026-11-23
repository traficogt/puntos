import { test, expect } from "@playwright/test";
import { apiGet, expectOk } from "./lib.js";

// Basic participation reporting is part of every plan. A freshly created business lands on the
// entry tier, so this covers the case that matters most: an owner WITHOUT the paid analytics
// suite still gets the Reportes tab, its KPIs and the soft-cap headroom card.
test.use({ serviceWorkers: "block" });

function rand(len = 6) {
  return Math.random()
    .toString(36)
    .slice(2, 2 + len);
}

async function useRandomClientIp(page) {
  const ip = `10.211.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200) + 1}`;
  await page.setExtraHTTPHeaders({ "x-forwarded-for": ip });
}

async function createBusinessViaUi(page) {
  const token = rand(8);
  await page.goto("/admin", { waitUntil: "domcontentloaded" });
  await page.fill("#businessName", `Cafe Reportes ${token}`);
  await page.fill("#email", `owner-${token}@example.com`);
  await page.fill("#password", "OrchardLanternMarble2026!");
  const signup = page.waitForResponse(
    (resp) => resp.request().method() === "POST" && resp.url().includes("/api/admin/signup"),
  );
  await page.click("#btnCreate");
  expect((await signup).ok(), "admin signup should succeed").toBeTruthy();
  await expect(page.locator("#result")).toBeVisible();
}

test("entry-tier owner gets Reportes with KPIs and plan capacity, but not deep analytics", async ({
  page,
}) => {
  await useRandomClientIp(page);
  await createBusinessViaUi(page);
  await page.goto("/admin-dashboard.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#main")).toBeVisible();

  const plan = await apiGet(page, "/api/admin/plan");
  expectOk(plan, "plan should be readable");
  expect(plan.body.features.basic_reporting, "basic reporting is on every tier").toBe(true);
  expect(plan.body.features.analytics, "a fresh business is not on the paid analytics tier").toBe(
    false,
  );
  expect(typeof plan.body.usage?.active_customers, "plan exposes soft-cap usage").toBe("number");

  const reportesTab = page.locator('.tab[data-tab="reportes"]');
  await expect(reportesTab).toBeVisible();
  await expect(page.locator('.tab[data-tab="analytics"]')).toBeHidden();

  await reportesTab.click();
  await expect(page.locator("#reportes-content")).toBeVisible();
  await expect(page.locator("#reportesKpis .metric-tile")).toHaveCount(7);
  await expect(page.locator("#reportesKpis")).toContainText("Clientes activos");
  await expect(page.locator("#reportes-content")).toContainText("no el total de ventas");

  const usage = page.locator("#reportesPlanUsage");
  await expect(usage).toContainText(/\d+ de \d+ clientes activos/);
  await expect(usage.locator("progress")).toHaveCount(1);

  await page.selectOption("#reportesPeriod", "7");
  await expect(page.locator("#reportesKpis .metric-tile")).toHaveCount(7);

  const deep = await apiGet(page, "/api/admin/analytics/cohorts");
  expect(deep.status, "deep analytics stays locked on the entry tier").toBe(403);
});

test("entry-tier owner sees the basic-report link and the done-for-you exit in the merchant panel", async ({
  page,
}) => {
  await useRandomClientIp(page);
  await createBusinessViaUi(page);
  await page.goto("/negocio/", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Tus números básicos")).toBeVisible();
  await expect(page.getByText("Abrir Reportes")).toBeVisible();
  const exitButton = page.getByRole("button", {
    name: "Prefiero que PuntosFieles lo configure por mí",
  });
  await expect(exitButton).toBeVisible();
  await exitButton.click();
  await page.getByLabel(/Teléfono o WhatsApp/).fill("+502 5555 0000");
  const request = page.waitForResponse(
    (resp) =>
      resp.request().method() === "POST" && resp.url().includes("/api/admin/concierge-request"),
  );
  await page.getByRole("button", { name: "Enviar solicitud" }).click();
  expect((await request).ok(), "concierge request should be accepted").toBeTruthy();
  await expect(page.getByText("Te contactaremos pronto")).toBeVisible();
});

test("the analytics overview keeps deep diagnostics behind a collapsed disclosure", async ({
  page,
}) => {
  await page.goto("/demostracion/?vista=libre", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Ver análisis detallado" })).toBeVisible();
});
