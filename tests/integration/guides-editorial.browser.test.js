import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import express from "express";
import { chromium } from "playwright";
import { guideCatalog } from "../../src/content/guides/catalog.js";
import { renderGuideArticle } from "../../src/content/guides/render.js";

test(
  "six editorial articles load both image sizes, citation targets and calculator links in local previews",
  { timeout: 60000 },
  async () => {
    const app = express();
    // Local test-only previews; the real routes retain the publication clock.
    app.get("/fixture/:slug", (req, res) => {
      const article = guideCatalog.articles.find((item) => item.slug === req.params.slug);
      if (!article) return res.status(404).end();
      return res.type("html").send(renderGuideArticle({ origin: "http://127.0.0.1", article }));
    });
    app.use(express.static(fileURLToPath(new URL("../../public", import.meta.url))));
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const captures = fileURLToPath(new URL("../../.impeccable/review/editorial/", import.meta.url));
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed repository-owned artifact directory.
    await mkdir(captures, { recursive: true });
    try {
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        for (const article of guideCatalog.articles) {
          await page.goto(`http://127.0.0.1:${address.port}/fixture/${article.slug}`);
          const illustrations = page.locator('main img[src^="/images/articles/"]');
          assert.ok((await illustrations.count()) >= 2, article.slug);
          for (const image of await illustrations.all()) {
            await image.scrollIntoViewIfNeeded();
            await image.evaluate((image) => /** @type {HTMLImageElement} */ (image).decode());
            assert.ok(
              await image.evaluate(
                (image) => /** @type {HTMLImageElement} */ (image).naturalWidth > 0,
              ),
            );
            assert.ok(await image.getAttribute("alt"));
            assert.ok(await image.getAttribute("srcset"));
          }
          assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
            false,
            `${article.slug} at ${width}`,
          );
          for (const reference of article.references) {
            assert.ok((await page.locator(`a[href="#ref-${reference.id}"]`).count()) > 0);
            assert.equal(await page.locator(`#ref-${reference.id}`).count(), 1);
          }
          if (article.slug !== "como-mostrar-progreso-recompensas")
            assert.equal(await page.locator('main a[href="/calculadora"]').count(), 1);
          const note = page.getByRole("complementary", { name: "En PuntosFieles", exact: true });
          assert.equal(await note.count(), article.productNote ? 1 : 0);
          assert.equal(await page.locator('.guide-end a[href="/#contacto"]').count(), 0);
          if (article.productNote) {
            const help = note.getByRole("link", {
              name: article.productNote.linkText,
              exact: true,
            });
            assert.equal(await help.getAttribute("href"), article.productNote.href);
            await help.focus();
            assert.equal(
              await help.evaluate((element) => element === document.activeElement),
              true,
            );
            await note.scrollIntoViewIfNeeded();
            await note.screenshot({
              path: `${captures}${article.slug}-note-${width}.png`,
              animations: "disabled",
            });
          }
          if (
            ["cuanto-cuesta-una-recompensa", "como-disenar-programa-fidelizacion"].includes(
              article.slug,
            )
          ) {
            await page.evaluate(() => window.scrollTo(0, 0));
            await page.screenshot({
              path: `${captures}${article.slug}-${width}.png`,
              fullPage: true,
              animations: "disabled",
            });
          }
        }
      }
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve(undefined))),
      );
    }
  },
);
