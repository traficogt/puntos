import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { request as httpRequest } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createGuides } from '../../src/middleware/guides.js';
import { createSearchVisibility } from '../../src/middleware/search-visibility.js';
import { guideCatalog, parseGuideCatalog } from '../../src/content/guides/catalog.js';

const marketingOrigin = 'https://puntosfieles.com';
const appOrigin = 'https://app.puntosfieles.com';
const article = {
  status: 'published', slug: 'prueba-de-recompensas',
  title: 'Una guía de prueba', description: 'Descripción de una guía usada únicamente en los tests.',
  body: [{ type: 'heading', text: 'Una pregunta concreta' }, { type: 'paragraph', text: 'Contenido de prueba, nunca publicado.' }]
};
const draft = { status: 'draft', slug: 'borrador-interno', title: 'Título privado del borrador' };
const catalog = entries => ({ version: 1, articles: entries });

async function fixture(t, entries = []) {
  const app = express();
  const guides = parseGuideCatalog(catalog(entries));
  app.use(createSearchVisibility({ marketingOrigin, appOrigin, guides }));
  app.use(createGuides({ marketingOrigin, guides }));
  app.use((_req, res) => res.status(404).send('Not found'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test address');
  return (path, { host = 'puntosfieles.com', method = 'GET' } = {}) => new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port: address.port, path, method, headers: { Host: host } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject); req.end();
  });
}

test('production guide catalog contains no articles', () => {
  assert.deepEqual(guideCatalog, { version: 1, articles: [] });
});

test('empty hub is useful, canonical, and excluded from search and the sitemap', async t => {
  const request = await fixture(t);
  const response = await request('/guias/');
  assert.equal(response.status, 200);
  assert.match(response.headers['x-robots-tag'], /noindex/);
  assert.match(response.headers['x-robots-tag'], /noarchive/);
  assert.match(response.text, /<html lang="es">/);
  assert.match(response.text, /Todavía no hay artículos publicados/);
  assert.match(response.text, /href="\/#como-funciona"/);
  assert.match(response.text, /href="\/#contacto"/);
  assert.match(response.text, /rel="canonical" href="https:\/\/puntosfieles.com\/guias\/"/);
  assert.match(response.text, /name="robots" content="noindex, follow, noarchive"/);
  assert.equal((response.text.match(/<h1\b/g) || []).length, 1);
  assert.doesNotMatch(response.text, /"@type":"Article"|<article\b|Lorem ipsum/i);
  const sitemap = await request('/sitemap.xml');
  assert.equal((sitemap.text.match(/<loc>/g) || []).length, 5);
  assert.doesNotMatch(sitemap.text, /guias/);
});

test('draft articles never appear on public routes, hub, or sitemap', async t => {
  const request = await fixture(t, [draft]);
  const response = await request('/guias/borrador-interno');
  assert.equal(response.status, 404);
  assert.match(response.headers['x-robots-tag'], /noindex.*noarchive/);
  for (const path of ['/guias/', '/guias/borrador-interno', '/guias/no-existe', '/sitemap.xml']) {
    const page = await request(path);
    assert.doesNotMatch(page.text, /Título privado del borrador/);
  }
  assert.match((await request('/guias/')).headers['x-robots-tag'], /noindex/);
  assert.equal((await request('/guias/borrador-interno/')).status, 404);
});

test('published guide appears in hub, sitemap, canonical HTML, and truthful Article data', async t => {
  const request = await fixture(t, [{ ...article, author: { type: 'Person', name: 'Autora de prueba', url: 'https://example.com/autora' }, datePublished: '2026-01-15', dateModified: '2026-01-16' }, draft]);
  const response = await request('/guias/prueba-de-recompensas');
  assert.equal(response.status, 200);
  assert.equal(response.headers['x-robots-tag'], undefined);
  assert.match(response.text, /<title>Una guía de prueba \| PuntosFieles<\/title>/);
  assert.match(response.text, /rel="canonical" href="https:\/\/puntosfieles.com\/guias\/prueba-de-recompensas"/);
  assert.match(response.text, /href="\/guias\/"/);
  assert.match(response.text, /<time datetime="2026-01-15">/);
  assert.match(response.text, /<h2[^>]*>Una pregunta concreta<\/h2>/);
  const schema = JSON.parse(response.text.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
  assert.equal(schema['@type'], 'Article');
  assert.equal(schema.author.name, 'Autora de prueba');
  assert.equal(schema.author['@type'], 'Person');
  assert.equal(schema.datePublished, '2026-01-15');
  assert.equal(schema.dateModified, '2026-01-16');
  assert.equal(schema.mainEntityOfPage, marketingOrigin + '/guias/prueba-de-recompensas');
  const hub = await request('/guias/');
  assert.equal(hub.headers['x-robots-tag'], undefined);
  assert.match(hub.text, /href="\/guias\/prueba-de-recompensas"/);
  assert.doesNotMatch(hub.text, /Todavía no hay|Título privado/);
  const sitemap = await request('/sitemap.xml');
  assert.match(sitemap.text, /<loc>https:\/\/puntosfieles.com\/guias\/<\/loc>/);
  assert.match(sitemap.text, /<loc>https:\/\/puntosfieles.com\/guias\/prueba-de-recompensas<\/loc>/);
  assert.doesNotMatch(sitemap.text, /borrador/);
});

test('article template never invents authors, dates, or reviews', async t => {
  const request = await fixture(t, [article]);
  const response = await request('/guias/prueba-de-recompensas');
  const schema = JSON.parse(response.text.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
  for (const key of ['author', 'datePublished', 'dateModified', 'aggregateRating']) assert.equal(schema[key], undefined);
  assert.doesNotMatch(response.text, /<time\b/);
});

test('guide aliases preserve query strings and only normalize published articles', async t => {
  const request = await fixture(t, [article]);
  for (const [from, to] of [['/guias?origen=menu', '/guias/?origen=menu'], ['/guias/prueba-de-recompensas/?origen=menu', '/guias/prueba-de-recompensas?origen=menu'], ['/soporte/', '/soporte'], ['/privacidad/', '/privacidad'], ['/terminos/', '/terminos']]) {
    const response = await request(from);
    assert.equal(response.status, 308);
    assert.equal(response.headers.location, to);
  }
  assert.equal((await request('/guias/no-existe/')).status, 404);
  assert.equal((await request('/guias/no/existe')).status, 404);
  const head = await request('/guias/', { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(head.text, '');
  assert.equal((await request('/guias/', { method: 'POST' })).status, 404);
});

test('guides stay off app and unknown hosts', async t => {
  const request = await fixture(t, [article]);
  for (const host of ['app.puntosfieles.com', 'unknown.example']) {
    for (const path of ['/guias/', '/guias/prueba-de-recompensas', '/sitemap.xml']) {
      const response = await request(path, { host });
      assert.equal(response.status, 404);
      assert.match(response.headers['x-robots-tag'], /noindex/);
    }
  }
});

test('article text and metadata are escaped and unsafe links are rejected', async t => {
  const markup = '<script>alert("fixture")</script>';
  const request = await fixture(t, [{ ...article, title: markup, description: markup, body: [{ type: 'paragraph', text: markup }, { type: 'list', items: [markup] }, { type: 'link', text: markup, href: '/#contacto' }] }]);
  const response = await request('/guias/prueba-de-recompensas');
  assert.doesNotMatch(response.text, /<script>alert/);
  assert.match(response.text, /&lt;script&gt;/);
  assert.match(response.text, /\\u003cscript>/);
  assert.equal((response.text.match(/<script\b/g) || []).length, 1);
  // eslint-disable-next-line no-script-url -- Rejection fixture; this value is never executed.
  for (const href of ['javascript:alert(1)', '//outside.example', 'data:text/html,hello', 'http://outside.example', '/\\outside.example']) {
    assert.throws(() => parseGuideCatalog(catalog([{ ...article, body: [{ type: 'link', text: 'Enlace', href }] }])));
  }
});

test('catalog rejects invalid and duplicate slugs, incomplete publication, and impossible dates', () => {
  for (const slug of ['Cómo-premiar', 'espacios aqui', '../secret', 'dos--guiones', 'mayusculaA', '%2e%2e', '']) {
    assert.throws(() => parseGuideCatalog(catalog([{ ...article, slug }])));
  }
  assert.throws(() => parseGuideCatalog(catalog([article, article])));
  assert.throws(() => parseGuideCatalog(catalog([{ ...draft, status: 'published' }])));
  assert.throws(() => parseGuideCatalog(catalog([{ ...article, datePublished: '2026-02-30' }])));
  assert.throws(() => parseGuideCatalog(catalog([{ ...article, datePublished: '2026-03-01', dateModified: '2026-02-28' }])));
  assert.throws(() => parseGuideCatalog({ version: 2, articles: [] }));
});

test('homepage links to the guides hub', async () => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed repository page fixture.
  const homepage = await readFile(new URL('../../public/index.html', import.meta.url), 'utf8');
  assert.match(homepage, /href="\/guias\/">Guías<\/a>/);
});
