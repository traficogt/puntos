import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { request as httpRequest } from "node:http";
import {
  parseGuideCatalog,
  getPublishedGuides,
  getGuideSearchPaths,
} from "../../src/content/guides/catalog.js";
import { createGuides } from "../../src/middleware/guides.js";
import { createSearchVisibility } from "../../src/middleware/search-visibility.js";

const marketingOrigin = "https://puntosfieles.com";
const appOrigin = "https://app.puntosfieles.com";
const release = "2026-11-21T09:00:00-06:00";
const article = {
  status: "scheduled",
  slug: "guia-programada",
  title: "Título reservado hasta el sábado",
  description: "Descripción reservada de una guía programada.",
  publishAt: release,
  datePublished: "2026-11-21",
  body: [{ type: "paragraph", text: "Contenido reservado hasta la publicación." }],
};
const catalog = (articles) => ({ version: 1, articles });

async function fixture(t, entries, now) {
  const app = express();
  const guides = parseGuideCatalog(catalog(entries));
  app.use(createSearchVisibility({ marketingOrigin, appOrigin, guides, now }));
  app.use(createGuides({ marketingOrigin, guides, now }));
  app.use((_req, res) => res.status(404).send("Not found"));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test address");
  return (path, { method = "GET", host = "puntosfieles.com" } = {}) =>
    new Promise((resolve, reject) => {
      const req = httpRequest(
        { hostname: "127.0.0.1", port: address.port, path, method, headers: { Host: host } },
        (res) => {
          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () =>
            resolve({
              status: res.statusCode,
              headers: res.headers,
              text: Buffer.concat(chunks).toString(),
            }),
          );
        },
      );
      req.on("error", reject);
      req.end();
    });
}

test("one running app releases a scheduled article at its exact instant across GET, HEAD, hub and sitemap", async (t) => {
  let time = Date.parse(release) - 1;
  const draft = {
    ...article,
    status: "draft",
    slug: "guia-cancelada",
    title: "Borrador cancelado",
    publishAt: "2026-11-14T09:00:00-06:00",
    datePublished: "2026-11-14",
  };
  const request = await fixture(t, [article, draft], () => time);
  for (const method of ["GET", "HEAD"]) {
    for (const path of ["/guias/guia-programada", "/guias/guia-programada/"]) {
      const response = await request(path, { method });
      assert.equal(response.status, 404);
      assert.match(response.headers["x-robots-tag"], /noindex.*noarchive/);
      assert.equal(response.headers["cache-control"], "no-store");
      assert.doesNotMatch(response.text, /Título reservado|Contenido reservado|guia-programada/);
      assert.equal(response.headers.location, undefined);
    }
  }
  const beforeHub = await request("/guias/");
  assert.equal(beforeHub.status, 200);
  assert.match(beforeHub.headers["x-robots-tag"], /noindex/);
  assert.equal(beforeHub.headers["cache-control"], "no-store");
  assert.doesNotMatch(beforeHub.text, /Título reservado|guia-programada|Borrador cancelado/);
  const beforeMap = await request("/sitemap.xml");
  assert.equal(beforeMap.headers["cache-control"], "no-store");
  assert.doesNotMatch(beforeMap.text, /guias/);

  for (const instant of [Date.parse(release), Date.parse(release) + 7 * 24 * 60 * 60 * 1000]) {
    time = instant;
    const page = await request("/guias/guia-programada");
    assert.equal(page.status, 200);
    assert.equal(page.headers["x-robots-tag"], undefined);
    assert.equal(page.headers["cache-control"], "no-store");
    assert.match(page.text, /Título reservado/);
    assert.match(page.text, /Contenido reservado/);
    assert.match(page.text, /<time datetime="2026-11-21">/);
    const schema = JSON.parse(
      page.text.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1],
    );
    assert.equal(schema.datePublished, release);
    assert.equal((await request("/guias/guia-programada/")).status, 308);
    const head = await request("/guias/guia-programada", { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(head.headers["x-robots-tag"], undefined);
    assert.equal(head.text, "");
    const hub = await request("/guias/");
    assert.equal(hub.headers["x-robots-tag"], undefined);
    assert.match(hub.text, /href="\/guias\/guia-programada"/);
    assert.doesNotMatch(hub.text, /Borrador cancelado/);
    const sitemap = await request("/sitemap.xml");
    assert.match(sitemap.text, /<loc>https:\/\/puntosfieles.com\/guias\/<\/loc>/);
    assert.match(
      sitemap.text,
      /<loc>https:\/\/puntosfieles.com\/guias\/guia-programada<\/loc><lastmod>2026-11-21<\/lastmod>/,
    );
    assert.doesNotMatch(sitemap.text, /guia-cancelada/);
    assert.equal((await request("/sitemap.xml", { method: "HEAD" })).text, "");
    assert.equal((await request("/guias/guia-cancelada")).status, 404);
    assert.equal((await request("/guias/guia-cancelada/")).status, 404);
    for (const host of ["app.puntosfieles.com", "unknown.example"]) {
      for (const path of ["/guias/", "/guias/guia-programada", "/sitemap.xml"]) {
        const response = await request(path, { host });
        assert.equal(response.status, 404);
        assert.match(response.headers["x-robots-tag"], /noindex/);
        assert.doesNotMatch(response.text, /Título reservado|Contenido reservado/);
      }
    }
  }
});

test("search headers and article body share the request clock when a release occurs between middleware calls", async (t) => {
  let time = Date.parse(release) - 1;
  const request = await fixture(t, [article], () => time++);
  const before = await request("/guias/guia-programada");
  assert.equal(before.status, 404);
  assert.match(before.headers["x-robots-tag"], /noindex/);
  const released = await request("/guias/guia-programada");
  assert.equal(released.status, 200);
  assert.equal(released.headers["x-robots-tag"], undefined);
});

test("catalog helpers re-evaluate injected clock without mutating scheduled entries", () => {
  const guides = parseGuideCatalog(catalog([article]));
  let time = Date.parse(release) - 1;
  const now = () => new Date(time);
  assert.deepEqual(getPublishedGuides(guides, now), []);
  assert.deepEqual(getGuideSearchPaths(guides, now), []);
  time += 1;
  assert.deepEqual(
    getPublishedGuides(guides, now).map((guide) => guide.slug),
    [article.slug],
  );
  assert.deepEqual(getGuideSearchPaths(guides, now), ["/guias/", "/guias/guia-programada"]);
  assert.equal(guides.articles[0].status, "scheduled");
});

test("published articles cannot bypass a future date or explicit publication time", async (t) => {
  let time = Date.parse("2026-11-21T05:59:59.999Z");
  const { publishAt: _publishAt, ...withoutTime } = article;
  const dated = { ...withoutTime, status: "published", slug: "fecha-futura" };
  const timed = { ...article, status: "published" };
  const request = await fixture(t, [dated, timed], () => time);
  assert.equal((await request("/guias/fecha-futura")).status, 404);
  assert.equal((await request("/guias/guia-programada")).status, 404);
  time += 1;
  assert.equal((await request("/guias/fecha-futura")).status, 200);
  assert.equal((await request("/guias/guia-programada")).status, 404);
  time = Date.parse(release);
  assert.equal((await request("/guias/guia-programada")).status, 200);
});

test("sitemap uses genuine revision dates and leaves undated pages without lastmod", async (t) => {
  const { publishAt: _publishAt, datePublished: _datePublished, ...undated } = article;
  const request = await fixture(
    t,
    [
      { ...article, dateModified: "2026-11-22" },
      { ...undated, status: "published", slug: "sin-fecha" },
    ],
    () => Date.parse("2026-11-23T00:00:00Z"),
  );
  const sitemap = await request("/sitemap.xml");
  assert.match(sitemap.text, /guia-programada<\/loc><lastmod>2026-11-22<\/lastmod>/);
  assert.match(sitemap.text, /sin-fecha<\/loc><\/url>/);
  assert.match(sitemap.text, /guias\/<\/loc><\/url>/);
});

test("schedule validation rejects missing timezone, invalid instants and Guatemala date mismatches", () => {
  for (const publishAt of [
    undefined,
    "2026-11-21",
    "2026-11-21T09:00:00",
    "2026-02-30T09:00:00-06:00",
    "2026-11-21T24:00:00-06:00",
    "2026-11-21T09:60:00-06:00",
    "2026-11-21T09:00:00+99:00",
    "not-a-date",
  ]) {
    assert.throws(() => parseGuideCatalog(catalog([{ ...article, publishAt }])));
  }
  for (const datePublished of [undefined, "2026-11-20", "2026-02-30"]) {
    assert.throws(() => parseGuideCatalog(catalog([{ ...article, datePublished }])));
  }
  assert.doesNotThrow(() =>
    parseGuideCatalog(catalog([{ ...article, publishAt: "2026-11-22T02:00:00Z" }])),
  );
  assert.throws(() =>
    parseGuideCatalog(catalog([{ ...article, publishAt: "2026-11-22T06:00:00Z" }])),
  );
  assert.throws(() =>
    parseGuideCatalog(catalog([{ ...article, status: "published", datePublished: undefined }])),
  );
});

const richArticle = {
  ...article,
  category: "Fundamentos",
  readingMinutes: 8,
  hero: {
    src: "/images/articles/prueba.webp",
    srcSmall: "/images/articles/prueba-640.webp",
    alt: "Una escena ilustrada.",
    width: 1536,
    height: 1024,
    caption: "Una escena que invita a volver.",
  },
  artCredit: "Ilustración editorial aprobada.",
  methodNote: ["Las propuestas propias se distinguen de los hallazgos."],
  references: [
    {
      id: "autora-2026",
      citation: "Autora, 2026",
      apa: "Autora. (2026). Título del estudio. Revista.",
      href: "https://doi.org/10.1000/example",
      italic: ["Revista"],
    },
  ],
  body: [
    {
      type: "figure",
      src: "/images/articles/prueba.png",
      alt: "Otra vista.",
      width: 1000,
      height: 700,
      caption: "Una escena de ejemplo.",
    },
    { type: "callout", text: "Idea central.", note: "Una distinción relevante." },
  ],
};

test("rich editorial schema supports local images, references, method notes and text callouts", () => {
  assert.deepEqual(parseGuideCatalog(catalog([richArticle])).articles[0], richArticle);
});

test("rich editorial schema rejects unsafe image paths, malformed references and raw HTML blocks", () => {
  for (const src of [
    "https://example.com/image.webp",
    "/images/articles/../secret.webp",
    "/images/articles/%2e%2e/secret.webp",
    "//outside.example/img.png",
    "/images/articles/test.svg",
    "/images/articles/test.webp?x=1",
  ]) {
    assert.throws(() =>
      parseGuideCatalog(catalog([{ ...richArticle, hero: { ...richArticle.hero, src } }])),
    );
    assert.throws(() =>
      parseGuideCatalog(catalog([{ ...richArticle, body: [{ ...richArticle.body[0], src }] }])),
    );
  }
  for (const hero of [
    { ...richArticle.hero, alt: "" },
    { ...richArticle.hero, width: 0 },
    { ...richArticle.hero, height: 1.5 },
    { ...richArticle.hero, srcSmall: "/elsewhere/image.png" },
  ]) {
    assert.throws(() => parseGuideCatalog(catalog([{ ...richArticle, hero }])));
  }
  assert.throws(() =>
    parseGuideCatalog(
      catalog([
        { ...richArticle, references: [richArticle.references[0], richArticle.references[0]] },
      ]),
    ),
  );
  assert.throws(() =>
    parseGuideCatalog(
      catalog([
        {
          ...richArticle,
          references: [{ ...richArticle.references[0], href: "http://example.com" }],
        },
      ]),
    ),
  );
  assert.throws(() =>
    parseGuideCatalog(
      catalog([{ ...richArticle, references: [{ ...richArticle.references[0], citation: "" }] }]),
    ),
  );
  assert.throws(() => parseGuideCatalog(catalog([{ ...richArticle, readingMinutes: -1 }])));
  assert.throws(() =>
    parseGuideCatalog(catalog([{ ...richArticle, body: [{ type: "html", html: "<p>HTML</p>" }] }])),
  );
});
