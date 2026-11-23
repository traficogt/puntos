import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { guideCatalog, parseGuideCatalog } from "../../src/content/guides/catalog.js";
import { renderGuideArticle, escapeHtml } from "../../src/content/guides/render.js";

const origin = "https://puntosfieles.com";
test("every prepared article has working citation targets, APA sources and local illustrated assets", () => {
  for (const article of guideCatalog.articles) {
    const html = renderGuideArticle({ origin, article });
    assert.ok(article.references.length >= 2, article.slug);
    for (const reference of article.references) {
      assert.ok(
        html.includes(`href="#ref-${reference.id}"`),
        `${article.slug}: bibliography entry must be cited`,
      );
      assert.ok(
        html.includes(`id="ref-${reference.id}"`),
        `${article.slug}: citation must have a target`,
      );
      assert.ok(html.includes(`href="${escapeHtml(reference.href)}"`));
      assert.ok(reference.italic.length > 0, `${article.slug}: APA title/periodical emphasis`);
    }
    for (const image of [
      article.hero,
      ...article.body.filter((block) => block.type === "figure"),
    ]) {
      assert.ok(image.alt);
      for (const src of [image.src, image.srcSmall].filter(Boolean)) {
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- Repository-owned image paths validated by the catalog schema.
        assert.ok(existsSync(new URL(`../../public${src}`, import.meta.url)), src);
      }
    }
    const schema = JSON.parse(
      html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1],
    );
    assert.equal(schema.author.name, "PuntosFieles");
    assert.equal(schema.image, origin + article.hero.src);
    assert.deepEqual(
      schema.citation,
      article.references.map((reference) => reference.href),
    );
  }
});

test("rich citation, caption and methodology text cannot inject executable HTML", () => {
  const attack = '<img src=x onerror="alert(1)">';
  const article = parseGuideCatalog({
    version: 1,
    articles: [
      {
        status: "published",
        slug: "cita-segura",
        title: "Texto seguro",
        description: "Una prueba de escapado.",
        hero: {
          src: "/images/articles/test.webp",
          width: 100,
          height: 100,
          alt: attack,
          caption: attack,
        },
        body: [
          { type: "paragraph", text: `Según Autora, 2026: ${attack}` },
          { type: "callout", text: attack, note: attack },
        ],
        references: [
          {
            id: "autora",
            citation: "Autora, 2026",
            apa: attack,
            italic: [attack],
            href: "https://example.com/paper?a=1&b=2",
          },
        ],
        methodNote: [attack],
        artCredit: attack,
      },
    ],
  }).articles[0];
  const html = renderGuideArticle({ origin, article });
  assert.ok(html.includes('<a class="citation" href="#ref-autora">Autora, 2026</a>'));
  assert.ok(html.includes("<em>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</em>"));
  assert.ok(html.includes("<figcaption>&lt;img"));
  assert.ok(html.includes('href="https://example.com/paper?a=1&amp;b=2"'));
  assert.doesNotMatch(html, /<img src=x|<script>alert|alt="<img/);
  assert.equal((html.match(/<script\b/g) || []).length, 1);
});
