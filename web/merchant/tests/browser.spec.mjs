import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import helmet from "helmet";
import { createSpanishWeb, createSpanishWebRedirects } from "../../../src/middleware/spanish-web.js";
import { chromium } from "playwright";
import { demoActivationInsights } from "../src/demo-activation-insights.js";
import { demoRedemptionReturns } from "../src/demo-redemption-returns.js";
const output = "/var/lib/puntos/releases/spanish-growth-20261110";
const app = express();
app.use(
  helmet({
    contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } },
  }),
);
app.use(createSpanishWebRedirects());
app.use(createSpanishWeb(path.resolve(import.meta.dirname, "../../../public")));
app.get("/runtime-config.js", (_q, r) =>
  r.type("js").send("window.__PF_RUNTIME_CONFIG__={};"),
);
app.use(express.static(path.resolve(import.meta.dirname, "../../../public")));
const server = app.listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const business = "11111111-1111-4111-8111-111111111111";
const baseline = [
  {
    id: "keep",
    name: "Bono de apertura",
    active: false,
    kind: "bonus_points",
    value: 10,
    max_points: 200,
    program_type: "SPEND",
    condition: {
      weekdays: [1, 2],
      start_hour: 0,
      end_hour: 23,
      min_amount_q: 0,
      min_visits: 0,
      min_items: 0,
    },
  },
];
const metric = {
  recorded_sales_q: 18350,
  purchases: 182,
  active_customers: 120,
  repeat_customers: 45,
  repeat_rate_pct: 37.5,
  average_ticket_q: 100.82,
  redemptions: 24,
};
function overview(days) {
  return {
    ok: true,
    generated_at: "2026-11-10T18:00:00Z",
    timezone: "America/Guatemala",
    currency: "GTQ",
    scope: { branch_id: null },
    period: {
      days: Number(days),
      start: "2026-10-12T06:00:00Z",
      end: "2026-11-10T18:00:00Z",
      previous_start: "2026-09-12T06:00:00Z",
      previous_end: "2026-10-11T18:00:00Z",
    },
    current: { ...metric, recorded_sales_q: days === "7" ? 700 : 18350 },
    previous: { ...metric, recorded_sales_q: 15500, repeat_rate_pct: 30 },
    daily: Array.from({ length: 30 }, (_, i) => ({
      date: new Date(Date.UTC(2026, 9, 12 + i)).toISOString().slice(0, 10),
      recorded_sales_q: 100 + (i % 5) * 45,
      purchases: 5 + (i % 5),
    })),
    rewards: [
      { name: "Café de la casa", redemptions: 18, points_redeemed: 1800 },
    ],
    notes: [],
  };
}
const axeSource=await fs.readFile(path.resolve(import.meta.dirname,'../node_modules/axe-core/axe.min.js'),'utf8');
async function accessibility(page,label) {
  await page.evaluate(axeSource);
  const report=await page.evaluate(async()=>window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}));
  await fs.writeFile(`${output}/axe-${label}.json`,JSON.stringify(report.violations,null,2));
  assert.deepEqual(report.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)})),[]);
}
let checks = 0;
async function check(label, fn) {
  await fn();
  checks++;
  console.log(`PASS ${label}`);
}
async function navigate(page, name) {
  const menu = page.getByRole("button", { name: "Cambiar sección del negocio", exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("navigation", { name: "Tu negocio" }).getByRole("button", { name, exact: true }).click();
}
async function session({
  width = 1440,
  dark = false,
  locked = false,
  role = "OWNER",
} = {}) {
  const context = await browser.newContext({
    viewport: { width, height: 1000 },
    colorScheme: dark ? "dark" : "light",
  });
  await context.addInitScript(() => {
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", (event) =>
      window.__csp.push(event.violatedDirective),
    );
  });
  await context.addCookies([
    { name: "pf_csrf_readable", value: "fixture-token", url: origin },
  ]);
  const state = {
    rules: structuredClone(baseline),
    puts: [],
    errors: [],
    delay: 0,
    fail: false,
    saveFail: false,
    logoutFail: false,
    unexpectedRequests: [],
  };
  await context.route("**/api/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      p = url.pathname;
    let data;
    const send = (body, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (p === "/api/staff/me")
      data = { staff: { id: "owner", business_id: business, role } };
    else if (p === "/api/admin/region")
      data = {
        region: { country: "GT", currency: "GTQ", timezone: "America/Guatemala", locale: "es-GT", minorUnits: 2 },
        currency_confirmed: true,
      };
    else if (p === "/api/admin/plan")
      data = {
        plan: locked ? "EMPRENDEDOR" : "NEGOCIO",
        features: {
          analytics: !locked,
          campaign_rules: !locked,
          multi_branch: !locked,
        },
      };
    else if (p === "/api/admin/customer-enrollment")
      data = {
        business: {
          id: business,
          name: "Café Jacaranda",
          slug: "cafe-jacaranda",
        },
        registration_url: `${origin}/registro/cafe-jacaranda`,
      };
    else if (p.endsWith("/qr.svg"))
      return route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="224" height="224"><rect width="224" height="224" fill="white"/><text x="20" y="100">QR de prueba</text></svg>',
      });
    else if (p === "/api/admin/branches")
      data = {
        branches: [
          { id: "22222222-2222-4222-8222-222222222222", name: "Zona 4" },
        ],
      };
    else if (p === "/api/admin/analytics/overview") {
      if (state.fail) return send({ error: "failed" }, 500);
      const days = url.searchParams.get("days");
      if (days === "90" && state.delay)
        await new Promise((r) => setTimeout(r, state.delay));
      data = overview(days);
    } else if (p === "/api/admin/activation-insights/reward-exposure")
      data = demoActivationInsights("reward-exposure");
    else if (p === "/api/admin/activation-insights/staff-activity")
      data = demoActivationInsights("staff-activity");
    else if (p === "/api/admin/analytics/redemption-returns")
      data = demoRedemptionReturns(url);
    else if (p === "/api/admin/launch/program")
      data = { program: { program_type: "SPEND", rate: 0.1, round: "ceil", version: "1".padStart(64, "0") } };
    else if (p === "/api/admin/reward-workspace")
      data = { rewards: [{ id: "coffee", name: "Café", points_cost: 50, active: true, available: true, stock: 10, mappings: [], branch_ids: [] }], branches: [] };
    else if (p === "/api/admin/operations-health")
      data = { next_actions: [] };
    else if (p === "/api/admin/pilots")
      data = { pilots: [], latest_completed: null };
    else if (p === "/api/admin/campaign-rules") {
      if (req.method() === "PUT") {
        assert.equal(req.headers()["x-csrf-token"], "fixture-token");
        state.puts.push(req.postDataJSON());
        if (state.saveFail)
          return send({ error: "No se pudo guardar la campaña." }, 500);
        state.rules = req.postDataJSON().rules;
      }
      data = { rules: state.rules, timezone: "America/Guatemala" };
    } else if (p === "/api/staff/logout") {
      if (state.logoutFail) return send({ error: "offline" }, 500);
      data = { ok: true };
    } else {
      state.unexpectedRequests.push(p);
      return send({ error: p }, 404);
    }
    return send(data);
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => state.errors.push(e.message));
  await page.goto(`${origin}/negocio/`);
  return { context, page, state };
}
try {
  const { context, page, state } = await session();
  await check("overview values, daily table and desktop render", async () => {
    await page.getByText("37.5%").waitFor();
    await page
      .getByRole("button", { name: "Ver los datos del gráfico" })
      .click();
    await page.getByRole("cell", { name: "2026-11-10", exact: true }).waitFor();
    await page
      .getByRole("button", { name: "Ver los datos del gráfico" })
      .click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    await accessibility(page,"overview-desktop");
    await page.screenshot({
      path: `${output}/merchant-desktop.png`,
      fullPage: true,
    });
  });
  await check("latest period response wins", async () => {
    state.delay = 700;
    await page.getByRole("combobox", { name: "Período", exact: true }).click();
    await page.getByRole("option", { name: "Últimos 90 días" }).click();
    await page.getByRole("combobox", { name: "Período", exact: true }).click();
    await page.getByRole("option", { name: "Últimos 7 días" }).click();
    await page.getByText("Q 700.00", { exact: true }).waitFor();
    await page.waitForTimeout(900);
    assert.ok(await page.getByText("Q 700.00", { exact: true }).isVisible());
  });
  await check("error retry without fake zero data", async () => {
    state.fail = true;
    await page.getByRole("button", { name: "Actualizar", exact: true }).click();
    await page.getByRole("alert").waitFor();
    assert.equal(await page.getByText("Q 700.00", { exact: true }).count(), 0);
    state.fail = false;
    await page.getByRole("button", { name: "Reintentar", exact: true }).click();
    await page.getByText("Q 700.00", { exact: true }).waitFor();
  });
  await check("launch enrollment URL and QR", async () => {
    await navigate(page, "Preparar mi programa");
    await page.getByRole("tab", { name: "4. QR y revisión", exact: true }).click();
    await page.getByLabel("Enlace de inscripción").waitFor();
    assert.equal(
      await page.getByLabel("Enlace de inscripción").inputValue(),
      `${origin}/registro/cafe-jacaranda`,
    );
    assert.ok(
      await page
        .getByRole("img", { name: "QR de inscripción de Café Jacaranda" })
        .isVisible(),
    );
  });
  await check(
    "local disabled template, explicit save, all fields preserved",
    async () => {
      await navigate(page, "Reglas de puntos");
      await page.getByRole("button", { name: "Preparar doble puntos" }).click();
      assert.equal(state.puts.length, 0);
      await page
        .getByRole("textbox", { name: /Nombre de la campaña/ })
        .last()
        .fill("Doble puntos sábado y domingo");
      assert.equal(
        await page
          .getByRole("switch", { name: "Activar al guardar" })
          .last()
          .isChecked(),
        false,
      );
      let activePrompt = false;
      const activeDialog = async dialog => { activePrompt = true; await dialog.dismiss(); };
      page.on("dialog", activeDialog);
      await navigate(page, "Reglas de puntos");
      await page.waitForTimeout(100);
      page.off("dialog", activeDialog);
      assert.equal(activePrompt, false, "Active tab must leave the dirty editor unchanged");
      let prompted = false;
      page.once("dialog", async dialog => { prompted = true; await dialog.dismiss(); });
      await page.goBack();
      await page.waitForTimeout(150);
      assert.ok(prompted, "Back must confirm before discarding a campaign draft");
      assert.equal(await page.getByRole("textbox", {name:/Nombre de la campaña/}).last().inputValue(), "Doble puntos sábado y domingo");
      await page.getByRole("button", { name: "Guardar campañas" }).click();
      await page.getByText(/Campañas guardadas/).waitFor();
      assert.deepEqual(state.puts[0].rules[0], baseline[0]);
      assert.equal(state.puts[0].rules[1].active, false);
    },
  );
  await check(
    "failed save preserves draft; discard restores latest save",
    async () => {
      await page
        .getByRole("textbox", { name: /Nombre de la campaña/ })
        .last()
        .fill("Borrador");
      state.saveFail = true;
      await page.getByRole("button", { name: "Guardar campañas" }).click();
      await page
        .getByText("No se pudo guardar la campaña.", { exact: true })
        .waitFor();
      assert.equal(
        await page
          .getByRole("textbox", { name: /Nombre de la campaña/ })
          .last()
          .inputValue(),
        "Borrador",
      );
      page.once("dialog", (d) => d.accept());
      await page
        .getByRole("button", { name: "Descartar", exact: true })
        .click();
      assert.equal(
        await page
          .getByRole("textbox", { name: /Nombre de la campaña/ })
          .last()
          .inputValue(),
        "Doble puntos sábado y domingo",
      );
    },
  );
  await check("cross-tab invalidation removes private content", async () => {
    await page.evaluate(() =>
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "pf_staff_epoch",
          newValue: "changed",
        }),
      ),
    );
    await page.getByRole("heading", { name: "Ingresa a tu negocio" }).waitFor();
    assert.equal(
      await page.getByText("Café Jacaranda", { exact: true }).count(),
      0,
    );
  });
  assert.deepEqual(state.errors, []);
  assert.deepEqual(state.unexpectedRequests, []);
  assert.deepEqual(await page.evaluate(() => window.__csp), []);
  await context.close();
  for (const dark of [false, true]) {
    const s = await session({ width: 390, dark });
    await s.page.getByText("37.5%").waitFor();
    await check(
      `mobile ${dark ? "dark" : "light"} keyboard and no horizontal overflow`,
      async () => {
        assert.ok(
          await s.page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
        await s.page.keyboard.press("Tab");
        assert.ok(
          await s.page
            .getByRole("link", { name: "Saltar al contenido" })
            .evaluate((node) => node === document.activeElement),
        );
        await s.page.keyboard.press("Tab");
        await s.page.screenshot({
          path: `${output}/merchant-mobile-${dark ? "dark" : "light"}.png`,
          fullPage: true,
        });
        await navigate(s.page, "Reglas de puntos");
        await s.page
          .getByRole("button", { name: "Preparar doble puntos" })
          .click();
        assert.ok(
          await s.page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
      },
    );
    await accessibility(s.page,`campaign-mobile-${dark?"dark":"light"}`);
    assert.deepEqual(s.state.errors, []);
    assert.deepEqual(s.state.unexpectedRequests, []);
    assert.deepEqual(await s.page.evaluate(() => window.__csp), []);
    await s.context.close();
  }
  const locked = await session({ locked: true });
  await check("plan lock", async () => {
    await locked.page
      .getByText(
        "Esta función no está incluida en el plan actual de tu negocio.",
      )
      .waitFor();
    await navigate(locked.page, "Reglas de puntos");
    await locked.page
      .getByRole("heading", { name: "Campañas de puntos" })
      .waitFor();
  });
  await locked.context.close();
  const manager = await session({ role: "MANAGER" });
  await check("nonowner legacy access", async () => {
    await manager.page
      .getByRole("heading", { name: "Este panel es para propietarios" })
      .waitFor();
    assert.ok(
      await manager.page
        .getByRole("link", { name: "Abrir administración" })
        .isVisible(),
    );
    assert.equal(await manager.page.getByRole("link", { name: "Abrir administración" }).getAttribute("href"), "/administracion/");
  });
  await manager.context.close();
  const exiting = await session();
  await exiting.page.getByText("37.5%").waitFor();
  await check("failed logout clears private UI and offers retry", async () => {
    exiting.state.logoutFail = true;
    await exiting.page
      .getByRole("button", { name: "Salir", exact: true })
      .click();
    await exiting.page
      .getByRole("heading", { name: "Ingresa a tu negocio" })
      .waitFor();
    await exiting.page
      .getByRole("button", { name: "Completar cierre de sesión" })
      .waitFor();
    assert.equal(
      await exiting.page.getByText("Café Jacaranda", { exact: true }).count(),
      0,
    );
  });
  await exiting.context.close();
  await fs.writeFile(
    `${output}/browser-result.json`,
    JSON.stringify({ checks, passed: true }, null, 2),
  );
  console.log(`${checks} browser checks passed`);
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
