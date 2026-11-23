import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { guideCatalog, parseGuideCatalog } from "../../src/content/guides/catalog.js";
import { renderGuideArticle } from "../../src/content/guides/render.js";

const origin = "https://puntosfieles.com";
const base = {
  status: "published",
  slug: "guia-prueba",
  title: "Guía de prueba",
  description: "Prueba editorial.",
  body: [{ type: "paragraph", text: "Consejo independiente." }],
};
const parse = (article) => parseGuideCatalog({ version: 1, articles: [article] }).articles[0];

test("a product note is optional and articles do not end with a repeated sales pitch", () => {
  const html = renderGuideArticle({ origin, article: parse(base) });
  assert.doesNotMatch(html, /guide-product-note|Conversemos sobre tu negocio/);
  assert.match(html, /Consejo independiente/);
});

test("an optional note is escaped, labelled and separate from research references", () => {
  const attack = '<img src=x onerror="alert(1)">';
  const article = parse({
    ...base,
    productNote: { text: attack, href: "/ayuda/negocio/costos/", linkText: attack },
    methodNote: ["Alcance de la investigación."],
    references: [
      {
        id: "fuente",
        citation: "Autora, 2026",
        apa: "Autora (2026). Fuente.",
        href: "https://example.com/paper",
      },
    ],
  });
  const html = renderGuideArticle({ origin, article });
  assert.match(html, /<aside class="guide-product-note" aria-labelledby="en-puntosfieles">/);
  assert.match(html, /<h2 id="en-puntosfieles">En PuntosFieles<\/h2>/);
  assert.match(html, /href="\/ayuda\/negocio\/costos\/"/);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.ok(html.indexOf("Consejo independiente.") < html.indexOf("<aside"));
  assert.ok(html.indexOf("<aside") < html.indexOf("<details"));
  assert.ok(html.indexOf("<aside") < html.indexOf('<section class="guide-references"'));
});

test("product notes link only public help tasks, never sign-up, sales, external or executable targets", () => {
  for (const href of [
    // eslint-disable-next-line no-script-url
    "javascript:alert(1)",
    "//example.com/",
    "https://example.com/",
    "/#contacto",
    "/ayuda/../planes/",
    "/ayuda/%2e%2e/planes/",
    "/ayuda/negocio/costos/?campaign=ad",
    "/ayuda/negocio/costos/\n",
  ]) {
    assert.throws(
      () =>
        parse({
          ...base,
          productNote: { text: "Una función.", href, linkText: "Consultar ayuda" },
        }),
      href,
    );
  }
  assert.throws(() =>
    parse({
      ...base,
      productNote: {
        text: "x".repeat(561),
        href: "/ayuda/clientes/puntos/",
        linkText: "Consultar ayuda",
      },
    }),
  );
  assert.throws(() =>
    parse({
      ...base,
      productNote: {
        text: "Una función.",
        href: "/ayuda/clientes/puntos/",
        linkText: "Consultar ayuda",
        buy: true,
      },
    }),
  );
});

test("each authored product note points to an existing help task and survives preview rendering", () => {
  for (const article of guideCatalog.articles.filter((item) => item.productNote)) {
    const { href, text } = article.productNote;
    assert.ok(
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      existsSync(
        new URL(`../../help/docs/${href.slice("/ayuda/".length, -1)}.md`, import.meta.url),
      ),
      href,
    );
    const html = renderGuideArticle({
      origin,
      article,
      preview: { indexPath: "/revision-editorial/prueba/", articles: guideCatalog.articles },
    });
    assert.ok(text.length <= 560);
    assert.match(html, /noindex, nofollow, noarchive, noimageindex/);
    assert.ok(html.includes(`href="${href}"`));
    assert.equal((html.match(/class="guide-product-note"/g) || []).length, 1);
  }
});
