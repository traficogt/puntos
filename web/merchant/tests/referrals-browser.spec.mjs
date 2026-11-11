import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import helmet from "helmet";
import { chromium } from "playwright";
import { build } from "vite";
import { demoReferrals } from "../src/demo-referrals.js";

const merchant = path.resolve(import.meta.dirname, "..");
const project = path.resolve(merchant, "../..");
const artifacts = path.join(project, "artifacts/referrals");
const outDir = path.join(artifacts, "build");
// Fixed repository-relative test output, never request/user input.
// eslint-disable-next-line security/detect-non-literal-fs-filename
await fs.mkdir(artifacts, { recursive: true });
await build({
  root: merchant,
  configFile: path.join(merchant, "vite.config.js"),
  build: {
    outDir,
    emptyOutDir: true,
    rollupOptions: {
      input: path.join(import.meta.dirname, "fixtures/referrals.html"),
    },
  },
  logLevel: "warn",
});
const app = express();
app.use(
  helmet({
    contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } },
  }),
);
app.get("/test-axe.js", (_req, res) =>
  res.sendFile(path.join(merchant, "node_modules/axe-core/axe.min.js")),
);
app.get("/negocio/referrals-test", (_req, res) =>
  res.sendFile(path.join(outDir, "tests/fixtures/referrals.html")),
);
app.use("/negocio", express.static(outDir));
app.use(express.static(path.join(project, "public")));
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const baseline = {
  enabled: true,
  referrer_reward_points: 100,
  referred_reward_points: 50,
  min_purchase_to_complete: 50,
  reward_on_signup: false,
  custom_message: "Conservar mensaje anterior",
};
let checks = 0;
async function check(label, action) {
  await action();
  checks++;
  console.log(`PASS ${label}`);
}
async function session({ width = 1440, dark = false, locked = false } = {}) {
  const context = await browser.newContext({
    viewport: { width, height: 1000 },
  });
  await context.addCookies([
    { name: "pf_csrf_readable", value: "test-csrf", url: origin },
  ]);
  const state = {
    settings: structuredClone(baseline),
    puts: [],
    requests: [],
    errors: [],
    failGrowth: false,
    failSave: false,
    empty: false,
  };
  await context.route("**/api/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    state.requests.push(url.pathname);
    const send = (data, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(data),
      });
    if (url.pathname === "/api/admin/referral-settings") {
      if (request.method() === "PUT") {
        assert.equal(request.headers()["x-csrf-token"], "test-csrf");
        state.puts.push(request.postDataJSON());
        if (state.failSave) return send({ error: "Save failed" }, 500);
        state.settings = request.postDataJSON();
      }
      return send({ ok: true, settings: state.settings });
    }
    if (url.pathname === "/api/admin/referral-growth") {
      if (state.failGrowth) return send({ error: "Read failed" }, 500);
      const result = demoReferrals(url);
      if (state.empty) {
        result.referrals = [];
        result.summary = {
          registered: 0,
          purchased: 0,
          purchased_and_rewarded: 0,
          awaiting_purchase: 0,
          purchase_rate_pct: null,
          reward_status: { pending: 0, completed: 0, rewarded: 0, other: 0 },
          recorded_reward_points: 0,
        };
        result.pagination = { total: 0, offset: 0, limit: 25, has_more: false };
      }
      return send(result);
    }
    if (url.pathname === "/api/admin/customer-enrollment")
      return send({
        business: {
          id: "11111111-1111-4111-8111-111111111111",
          name: "Café Jacaranda",
          slug: "cafe-jacaranda",
        },
        registration_url: `${origin}/registro/cafe-jacaranda`,
      });
    if (url.pathname === "/api/admin/customer-enrollment/qr.svg")
      return route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192"><rect width="192" height="192" fill="white"/><rect x="32" y="32" width="128" height="128" fill="black"/></svg>',
      });
    return send({ error: "Unexpected route" }, 404);
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => state.errors.push(error.message));
  await page.goto(
    `${origin}/negocio/referrals-test?${new URLSearchParams({ ...(dark ? { dark: "1" } : {}), ...(locked ? { locked: "1" } : {}) })}`,
  );
  return { context, page, state };
}
async function choose(page, label, option) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}
async function accessCheck(page, label) {
  await page.addScriptTag({ url: `${origin}/test-axe.js` });
  const report = await page.evaluate(() =>
    window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa"] }),
  );
  // Fixed test label and repository-relative artifact path.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await fs.writeFile(
    path.join(artifacts, `axe-${label}.json`),
    JSON.stringify(report.violations, null, 2),
  );
  assert.deepEqual(
    report.violations.map((item) => ({
      id: item.id,
      nodes: item.nodes.map((node) => node.target),
    })),
    [],
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
}
try {
  const { context, page, state } = await session();
  await check(
    "purchase funnel, independent rewards and responsive desktop",
    async () => {
      await page
        .getByRole("table", { name: "Clientes recomendados", exact: true })
        .waitFor();
      await page
        .getByText("No es un mínimo por ticket.", { exact: false })
        .waitFor();
      await page.screenshot({
        path: path.join(artifacts, "desktop.png"),
        fullPage: true,
      });
      await accessCheck(page, "desktop");
    },
  );
  await check(
    "row filters, pagination and unchanged cohort summary",
    async () => {
      await page
        .getByRole("button", { name: "Siguiente", exact: true })
        .click();
      await page.getByText("11–20 de 29", { exact: true }).waitFor();
      await choose(
        page,
        "Mostrar clientes recomendados",
        "Sin compra registrada",
      );
      await page.getByText("1–10 de 10", { exact: true }).waitFor();
      const table = page.getByRole("table", {
        name: "Clientes recomendados",
        exact: true,
      });
      assert.equal(
        await table
          .getByRole("cell", { name: "Sin compra registrada", exact: true })
          .count(),
        10,
      );
    },
  );
  await check(
    "saving sends a genuine settings PUT with CSRF and clears dirty state",
    async () => {
      await page
        .getByRole("textbox", {
          name: "Puntos para quien recomienda",
          exact: true,
        })
        .fill("75");
      await page.locator("main[data-dirty=true]").waitFor();
      await page
        .getByRole("button", { name: "Guardar incentivos", exact: true })
        .click();
      await page.getByText("Incentivos guardados.", { exact: false }).waitFor();
      assert.equal(state.puts.at(-1).referrer_reward_points, 75);
      assert.equal(state.puts.at(-1).custom_message, baseline.custom_message);
      await page.locator("main[data-dirty=false]").waitFor();
    },
  );
  await check(
    "save failure retains draft, retry persists it, and discard restores baseline",
    async () => {
      await page
        .getByRole("textbox", {
          name: "Puntos para el nuevo cliente",
          exact: true,
        })
        .fill("60");
      state.failSave = true;
      await page
        .getByRole("button", { name: "Guardar incentivos", exact: true })
        .click();
      await page
        .getByText("No pudimos guardar los incentivos.", { exact: false })
        .waitFor();
      assert.equal(
        await page
          .getByRole("textbox", {
            name: "Puntos para el nuevo cliente",
            exact: true,
          })
          .inputValue(),
        "60",
      );
      state.failSave = false;
      await page
        .getByRole("button", { name: "Guardar incentivos", exact: true })
        .click();
      await page.getByText("Incentivos guardados.", { exact: false }).waitFor();
      await page
        .getByRole("textbox", {
          name: "Puntos para el nuevo cliente",
          exact: true,
        })
        .fill("90");
      await page
        .getByRole("button", { name: "Descartar cambios", exact: true })
        .click();
      assert.equal(
        await page
          .getByRole("textbox", {
            name: "Puntos para el nuevo cliente",
            exact: true,
          })
          .inputValue(),
        "60",
      );
    },
  );
  await check(
    "detects a concurrent settings change before overwriting it",
    async () => {
      await page
        .getByRole("textbox", {
          name: "Puntos para el nuevo cliente",
          exact: true,
        })
        .fill("80");
      state.settings.referrer_reward_points = 200;
      const writes = state.puts.length;
      await page
        .getByRole("button", { name: "Guardar incentivos", exact: true })
        .click();
      await page
        .getByText("Los incentivos cambiaron en otra sesión.", { exact: false })
        .waitFor();
      assert.equal(state.puts.length, writes);
    },
  );
  await check(
    "read failure is visible and retry recovers without inventing zero metrics",
    async () => {
      state.failGrowth = true;
      await choose(
        page,
        "Recomendaciones registradas",
        "En los últimos 90 días",
      );
      await page
        .getByText("Tus datos no se han sustituido por ceros.", {
          exact: false,
        })
        .waitFor();
      state.failGrowth = false;
      await page
        .getByRole("button", { name: "Reintentar", exact: true })
        .click();
      await page
        .getByRole("table", { name: "Clientes recomendados", exact: true })
        .waitFor();
      assert.equal(
        await page
          .getByRole("textbox", {
            name: "Puntos para el nuevo cliente",
            exact: true,
          })
          .inputValue(),
        "80",
      );
    },
  );
  assert.deepEqual(state.errors, []);
  await context.close();
  for (const dark of [false, true]) {
    const mobile = await session({ width: 390, dark });
    await check(
      `mobile ${dark ? "dark" : "light"} layout and accessibility`,
      async () => {
        await mobile.page
          .getByRole("table", { name: "Clientes recomendados", exact: true })
          .waitFor();
        await accessCheck(mobile.page, dark ? "mobile-dark" : "mobile");
        await mobile.page.screenshot({
          path: path.join(artifacts, dark ? "mobile-dark.png" : "mobile.png"),
          fullPage: true,
        });
        assert.deepEqual(mobile.state.errors, []);
      },
    );
    await mobile.context.close();
  }
  const empty = await session();
  await check("empty state and signup mode explain the trigger", async () => {
    empty.state.empty = true;
    await choose(
      empty.page,
      "Recomendaciones registradas",
      "En los últimos 90 días",
    );
    await empty.page
      .getByText("Todavía no hay recomendaciones en este período", {
        exact: true,
      })
      .waitFor();
    await choose(
      empty.page,
      "Cuándo se evalúa el premio",
      "Al aplicar el código en el registro",
    );
    await empty.page
      .getByText("No se exige una compra.", { exact: false })
      .waitFor();
    assert.equal(
      await empty.page
        .getByRole("textbox", {
          name: "Importe acumulado mínimo (Q)",
          exact: true,
        })
        .count(),
      0,
    );
  });
  await empty.context.close();
  const locked = await session({ locked: true });
  await check("locked plans load no referral or enrollment data", async () => {
    await locked.page
      .getByText("Esta función no está incluida", { exact: false })
      .waitFor();
    assert.deepEqual(locked.state.requests, []);
  });
  await locked.context.close();
  console.log(
    `${checks} referral browser checks passed; screenshots: ${artifacts}`,
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
