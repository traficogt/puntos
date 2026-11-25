import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import express from "express";
import { chromium } from "playwright";
import { createSelfServiceWeb } from "../../src/middleware/self-service-web.js";

test(
  "simple calculator starts with the four core numbers and computes payback in the same step",
  { timeout: 60000 },
  async (t) => {
    const root = fileURLToPath(new URL("../../public", import.meta.url));
    const app = express();
    app.use((_req, res, next) => {
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; connect-src 'none'",
      );
      next();
    });
    app.get("/__calculator-axe.js", (_req, res) =>
      res.sendFile("axe.min.js", {
        root: fileURLToPath(new URL("../../web/merchant/node_modules/axe-core/", import.meta.url)),
      }),
    );
    app.use(createSelfServiceWeb(root));
    app.use(express.static(root));
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    let browser;
    t.after(async () => {
      try {
        await browser?.close();
      } finally {
        await new Promise((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve(undefined)));
          server.closeAllConnections();
        });
      }
    });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [],
      writes = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (request.method() !== "GET") writes.push(request.url());
    });
    const text = (selector) => page.locator(selector).innerText();
    const visible = (selector) => page.locator(selector).isVisible();
    const calculate = () => page.locator("#calculate-budget").click();
    await page.goto(`http://127.0.0.1:${address.port}/calculadora`);
    assert.equal(await page.locator("#simple-calculator").count(), 1);
    // Four inputs at load: the two budget numbers and the two payback numbers. The
    // optional costs stay behind the closed "Más opciones" details.
    assert.equal(await page.locator("input:visible").count(), 4);
    for (const id of ["rewardCost", "rewardCount", "keptPerSale", "rewardEvery"])
      assert.equal(await visible(`#${id}`), true, id);
    assert.equal(await visible("#monthlyCosts"), false);
    assert.equal(await visible("#additionalSales"), false);
    assert.match(await text(".payback-ask"), /mismo paso/);
    assert.ok((await page.locator(".skip-link").boundingBox()).y < 0);
    assert.equal(await visible("#budget-result"), false);
    // Validation: an empty submit flags the budget fields; the summary link focuses the first.
    await calculate();
    assert.equal(await visible("#budget-result"), false);
    assert.equal(await page.locator("#rewardCost").getAttribute("aria-invalid"), "true");
    assert.equal(await page.locator("#rewardCount").getAttribute("aria-invalid"), "true");
    assert.equal(await page.locator("#keptPerSale").getAttribute("aria-invalid"), null);
    await page.locator("#budget-errors a").first().click();
    assert.equal(await page.evaluate(() => document.activeElement.id), "rewardCost");
    // Budget alone: 20 × GTQ 10 = GTQ 200, with the payback prompt in place of the block.
    await page.fill("#rewardCost", "10");
    await page.fill("#rewardCount", "20");
    await calculate();
    assert.equal(await page.evaluate(() => document.activeElement.id), "budget-heading");
    assert.match(await text("#budget-total"), /GTQ\s*200/);
    assert.match(await text("#budget-verdict"), /20 premios te costarán GTQ\s*200/);
    assert.match(await text("#budget-calculation"), /20 premios × GTQ\s*10/);
    assert.match(await text("#budget-exclusions"), /no incluye/i);
    assert.equal(await visible("#payback-block"), false);
    assert.equal(await visible("#payback-missing"), true);
    // Optional monthly costs join the same total and leave with it.
    await page.locator("#extra-costs summary").click();
    await page.fill("#monthlyCosts", "99");
    assert.equal(await visible("#budget-result"), false);
    await calculate();
    assert.match(await text("#budget-total"), /GTQ\s*299/);
    assert.match(await text("#budget-calculation"), /\+ GTQ\s*99/);
    assert.match(await text("#budget-exclusions"), /Incluye todos estos premios/);
    await page.fill("#monthlyCosts", "");
    await page.locator("#extra-costs summary").click();
    await calculate();
    assert.match(await text("#budget-total"), /GTQ\s*200/);
    assert.equal(await visible("#payback-missing"), true);
    // Payback is computed in the same step and validates both of its inputs together.
    await page.fill("#keptPerSale", "25");
    await calculate();
    assert.equal(await visible("#budget-result"), false);
    assert.equal(await page.locator("#rewardEvery").getAttribute("aria-invalid"), "true");
    await page.locator("#budget-errors a").first().click();
    assert.equal(await page.evaluate(() => document.activeElement.id), "rewardEvery");
    await page.fill("#rewardEvery", "10");
    await calculate();
    // Model: (25 × 10 − 10) / 10 = GTQ 24 net per extra purchase after a GTQ 1 reserve;
    // ceil(200 / 24) = 9 purchases, i.e. fewer than one a day over the month.
    assert.equal(await visible("#payback-block"), true);
    assert.equal(await visible("#payback-missing"), false);
    assert.match(await text("#extra-sales-needed"), /^9 compras extra para cubrir/);
    assert.match(await text("#budget-verdict"), /~9 ventas extra \(menos de 1 venta más al día\)/);
    assert.match(await text("#per-day-note"), /menos de 1 venta más al día/);
    assert.match(
      await text("#per-sale-flow"),
      /GTQ\s*25\.00 ganas → GTQ\s*1\.00 al premio → GTQ\s*24\.00 neto/,
    );
    assert.equal(await visible("#sales-scenario"), false);
    // A sales hypothesis is optional: 10 × 24 − 200 leaves GTQ 40.
    await page.locator("#extra-costs summary").click();
    await page.fill("#additionalSales", "10");
    assert.equal(await visible("#budget-result"), false);
    await calculate();
    assert.match(await text("#sales-scenario"), /^Con 10 compras extra, quedarían GTQ\s*40/);
    await page.emulateMedia({ media: "print" });
    assert.equal(await visible("#budget-form"), false);
    assert.equal(await visible("#payback-block"), false);
    assert.equal(await visible("#print-assumptions"), true);
    const printed = await text("#print-assumptions");
    assert.match(printed, /Moneda: GTQ/);
    assert.match(printed, /20 premios a GTQ\s*10\.00 cada uno/);
    assert.match(printed, /Otros gastos no incluidos/);
    assert.match(
      printed,
      /Cada compra deja GTQ\s*25\.00 antes de premios\. Un premio por cada 10 compras/,
    );
    assert.match(printed, /Reserva por compra adicional: 1 GTQ/);
    assert.match(printed, /Hipótesis: 10 compras adicionales/);
    assert.match(printed, /9 compras extra para cubrir el presupuesto/);
    assert.match(printed, /Quedaría GTQ\s*40\.00/);
    await page.emulateMedia({ media: "screen" });
    assert.equal(await visible("#print-assumptions"), false);
    assert.equal(await visible("#budget-form"), true);
    // Non-positive case: GTQ 1 kept per sale only covers the GTQ 1 reserve, so no
    // number of purchases pays the budget back; the hypothesis shows the shortfall.
    await page.fill("#keptPerSale", "1");
    await calculate();
    assert.match(await text("#extra-sales-needed"), /no alcanza/i);
    assert.doesNotMatch(await text("#budget-verdict"), /Se paga solo/);
    assert.equal(await visible("#per-day-note"), false);
    assert.match(await text("#sales-scenario"), /^Con 10 compras extra, faltarían GTQ\s*200\.00/);
    await page.fill("#additionalSales", "");
    await calculate();
    assert.match(await text("#extra-sales-needed"), /no alcanza/i);
    assert.equal(await visible("#sales-scenario"), false);
    await page.emulateMedia({ media: "print" });
    const printedWithoutScenario = await text("#print-assumptions");
    assert.match(printedWithoutScenario, /20 premios a GTQ\s*10\.00/);
    assert.match(printedWithoutScenario, /No hay un número calculable de compras/);
    assert.match(printedWithoutScenario, /Sin hipótesis de compras adicionales/);
    assert.doesNotMatch(printedWithoutScenario, /Hipótesis:/);
    assert.doesNotMatch(printedWithoutScenario, /Quedaría|Faltaría/);
    await page.emulateMedia({ media: "screen" });
    await page.locator("#extra-costs summary").click();
    // Editing any field withdraws the result (and its print facts) until recalculated.
    await page.fill("#rewardCost", "");
    assert.equal(await visible("#budget-result"), false);
    assert.equal(await text("#print-assumptions"), "");
    await page.fill("#rewardCost", "0");
    await calculate();
    assert.match(await text("#budget-total"), /GTQ\s*0/);
    assert.match(await text("#extra-sales-needed"), /no requiere compras extra/);
    await page.selectOption("#currency", "CLP");
    await page.fill("#rewardCost", "1.5");
    await calculate();
    assert.match(await text("#budget-errors"), /entero/);
    await page.locator("#reset-simple").click();
    assert.equal(await page.locator("input:visible").count(), 4);
    assert.equal(await page.locator("#rewardCost").inputValue(), "");
    assert.equal(await page.locator("#keptPerSale").inputValue(), "");
    assert.equal(await page.locator("#currency").inputValue(), "GTQ");
    assert.equal(await visible("#budget-result"), false);
    await page.locator("#examples summary").click();
    await page.addScriptTag({ url: `http://127.0.0.1:${address.port}/__calculator-axe.js` });
    for (const example of ["retail", "salon", "carwash", "cafe"]) {
      await page.locator(`[data-example="${example}"]`).click();
      assert.match(await text("#example-context"), /ficticio/i);
      assert.equal(await visible("#budget-result"), true);
      assert.equal(await visible("#payback-block"), true, example);
      assert.equal(await visible("#sales-scenario"), true, example);
    }
    await page.locator("#examples summary").click();
    const screenshotDir = fileURLToPath(
      new URL("../../.impeccable/review/calculator-simple/", import.meta.url),
    );
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed repository test artifact directory.
    await mkdir(screenshotDir, { recursive: true });
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(() => document.fonts.ready);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
      assert.deepEqual(
        await page.evaluate(async () =>
          (await /** @type {any} */ (window).axe.run()).violations.map((v) => ({
            id: v.id,
            nodes: v.nodes.map((n) => n.target),
          })),
        ),
        [],
      );
      await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
      await page.screenshot({ path: `${screenshotDir}${width}.png`, fullPage: true });
    }
    // Narrowest width with every input open and the payback block rendered.
    await page.locator("#extra-costs summary").click();
    assert.equal(await page.locator("input:visible").count(), 6);
    assert.equal(await visible("#payback-block"), true);
    assert.deepEqual(
      await page.evaluate(async () =>
        (await /** @type {any} */ (window).axe.run()).violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => n.target),
        })),
      ),
      [],
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({ path: `${screenshotDir}320-payback.png`, fullPage: true });
    assert.deepEqual(errors, []);
    assert.deepEqual(writes, []);
    assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
    await page.locator('a[href="/calculadora/detallada"]').click();
    await page.locator("#calculator-app").waitFor({ state: "visible" });
    assert.equal(await page.locator("#calculator-app").isVisible(), true);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    assert.equal(
      (
        await fetch(`http://127.0.0.1:${address.port}/calculadora/detallada/`, {
          redirect: "manual",
        })
      ).headers.get("location"),
      "/calculadora/detallada",
    );
  },
);

test(
  "public calculator handles examples, unknown costs, errors, mobile, keyboard, currency and exports locally",
  { timeout: 60000 },
  async () => {
    const app = express();
    app.use((_req, res, next) => {
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; connect-src 'none'",
      );
      next();
    });
    app.get("/calculadora", (_req, res) =>
      res.sendFile("calculator/detallada.html", {
        root: fileURLToPath(new URL("../../public", import.meta.url)),
      }),
    );
    app.use(express.static(fileURLToPath(new URL("../../public", import.meta.url))));
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const errors = [],
      writes = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (request.method() !== "GET") writes.push(request.url());
    });
    const screenshots = fileURLToPath(
      new URL("../../.impeccable/review/calculator/", import.meta.url),
    );
    // Fixed, repository-local test artifacts; no request or user input is used.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await mkdir(screenshots, { recursive: true });
    const clickStep = async (step) =>
      page.locator(`.calculator-steps [data-step="${step}"]`).click();
    const calculate = async () => {
      await clickStep(2);
      await page.locator("#calculate").click();
    };
    const load = async (key) => {
      await page.selectOption("#example", key);
      await page.locator("#load-example").click();
    };
    try {
      await page.goto(`http://127.0.0.1:${address.port}/calculadora`);
      await page.locator("#calculator-app").waitFor({ state: "visible" });
      assert.equal(await page.locator("#reward-0-unitCost").inputValue(), "");
      assert.equal(await page.locator("#results").isVisible(), false);
      await page.locator('[data-next="1"]').click();
      assert.equal(await page.locator("#reward-0-units").getAttribute("aria-invalid"), "true");
      await page.locator("#error-summary a").first().click();
      assert.equal(await page.evaluate(() => document.activeElement.id), "reward-0-units");
      await page.fill("#reward-0-units", "10");
      await calculate();
      assert.match(await page.locator("#result-warnings").innerText(), /Presupuesto incompleto/);
      assert.match(await page.locator("#break-even").innerText(), /sin umbral/);

      for (const example of ["retail", "salon", "carwash", "cafe"]) {
        await load(example);
        await calculate();
        assert.equal(await page.locator("#results").isVisible(), true);
        assert.match(await page.locator("#result-context").innerText(), /Ejemplo ficticio/);
        assert.match(await page.locator("#break-even").innerText(), /compras adicionales/);
        assert.match(
          await page.locator("#result-warnings").innerText(),
          /Suscripción PF, Implementación, Mensajes/,
        );
      }
      await load("retail");
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: `${screenshots}desktop.png`,
        fullPage: true,
        animations: "disabled",
      });
      await page.fill("#reward-0-name", "<img src=x onerror=alert(1)>");
      await calculate();
      assert.equal(await page.locator("#reward-breakdown img").count(), 0);
      await page.locator(".calculation-details summary").click();
      assert.match(await page.locator("#reward-breakdown").innerText(), /<img src=x/);
      await load("retail");
      await calculate();
      await page.selectOption("#allowanceMode", "");
      assert.equal(await page.locator("#results").isVisible(), false);
      await page.locator("#calculate").click();
      assert.match(await page.locator("#break-even-note").innerText(), /Falta la reserva/);
      await page.selectOption("#allowanceMode", "amount");
      await page.fill("#rewardAllowance", "36");
      await page.locator("#calculate").click();
      assert.match(await page.locator("#break-even-note").innerText(), /cero o negativa/);
      await page.fill("#rewardAllowance", "3");
      await page.fill("#additional", "0");
      await page.locator("#calculate").click();
      assert.match(await page.locator("#contribution-totals").innerText(), /-GTQ\s*640/);
      await page.fill("#additional", "30");
      await page.locator("#calculate").click();
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: `${screenshots}desktop-results.png`,
        fullPage: true,
        animations: "disabled",
      });
      const downloadEvent = page.waitForEvent("download");
      await page.locator("#download-summary").click();
      const download = await downloadEvent;
      assert.equal(download.suggestedFilename(), "escenario-recompensas-pf.txt");
      const stream = await download.createReadStream();
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      const report = Buffer.concat(chunks).toString("utf8");
      assert.match(report, /PREMIOS BASE/);
      assert.match(report, /sin dato \/ no incluido/);
      assert.match(report, /compras adicionales/i);
      await page.emulateMedia({ media: "print" });
      assert.equal(await page.locator("#print-assumptions").isVisible(), true);
      assert.equal(await page.locator("#calculator-form").isVisible(), false);
      await page.emulateMedia({ media: "screen" });

      await page.setViewportSize({ width: 390, height: 844 });
      await load("salon");
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: `${screenshots}mobile.png`,
        fullPage: true,
        animations: "disabled",
      });
      await calculate();
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: `${screenshots}mobile-results.png`,
        fullPage: true,
        animations: "disabled",
      });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
        false,
      );
      await clickStep(0);
      await page.selectOption("#currency", "CLP");
      await page.fill("#reward-0-unitCost", "1.5");
      await calculate();
      assert.match(await page.locator("#error-summary").innerText(), /entera/);
      await page.locator("#error-summary a").first().click();
      await page.fill("#reward-0-unitCost", "15");
      await page.fill("#reward-0-units", "-1");
      await calculate();
      assert.match(await page.locator("#error-summary").innerText(), /entre 0 y 1000000/);
      await page.locator("#error-summary a").first().click();
      await page.fill("#reward-0-units", "24");
      await calculate();
      assert.match(await page.locator("#full-totals").innerText(), /CLP/);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
        false,
      );
      await clickStep(0);
      await page.locator("#add-reward").focus();
      await page.keyboard.press("Enter");
      assert.equal(await page.evaluate(() => document.activeElement.id), "reward-1-name");
      await page.locator('[data-remove="1"]').click();
      assert.equal(await page.locator(".reward").count(), 1);
      await page.locator("#reset-calculator").click();
      assert.equal(await page.locator("#reward-0-units").inputValue(), "");
      assert.equal(await page.locator("#results").isVisible(), false);
      assert.equal(await page.evaluate(() => localStorage.length), 0);
      assert.equal(await page.evaluate(() => sessionStorage.length), 0);
      assert.deepEqual(writes, []);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve(undefined))),
      );
    }
  },
);
