import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import path from 'node:path';
import { request as httpRequest } from 'node:http';
import { createEditorialReview } from '../../src/middleware/editorial-review.js';
import { createGuides } from '../../src/middleware/guides.js';
import { createSearchVisibility } from '../../src/middleware/search-visibility.js';
import { guideCatalog } from '../../src/content/guides/catalog.js';
import { escapeHtml, renderGuideArticle } from '../../src/content/guides/render.js';

const previewPath = '/revision-editorial/a6517680e9c4b4b7afde1ba7/';
const origin = 'https://puntosfieles.com';
const slugs = ['como-disenar-programa-fidelizacion', 'cuanto-cuesta-una-recompensa', 'cuantas-visitas-para-una-recompensa', 'ventaja-empezar-con-sellos', 'como-mostrar-progreso-recompensas'];
const articles = slugs.map(slug => guideCatalog.articles.find(article => article.slug === slug));

async function fixture(t) {
  const app = express();
  const now = () => Date.parse('2026-11-16T12:00:00Z');
  app.use(createSearchVisibility({ marketingOrigin: origin, appOrigin: 'https://app.puntosfieles.com', now }));
  app.use(createEditorialReview({ marketingOrigin: origin }));
  app.use(createGuides({ marketingOrigin: origin, now }));
  app.use(express.static(path.resolve('public'), { extensions: ['html'], redirect: false }));
  app.use((_req, res) => res.status(404).send('Not found'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test address');
  return (url, method = 'GET', host = 'puntosfieles.com') => new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port: address.port, path: url, method, headers: { Host: host } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), text: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject); req.end();
  });
}

function assertPrivate(response) {
  assert.equal(response.headers['x-robots-tag'], 'noindex, nofollow, noarchive, noimageindex');
  assert.equal(response.headers['cache-control'], 'private, no-store');
  assert.equal(response.headers['referrer-policy'], 'no-referrer');
}

test('preview index links exactly the five approved articles without publication claims', async t => {
  const request = await fixture(t);
  const response = await request(previewPath);
  assert.equal(response.status, 200);
  assertPrivate(response);
  assert.match(response.text, /<meta name="robots" content="noindex, nofollow, noarchive, noimageindex"/);
  assert.ok(response.text.includes(`rel="canonical" href="${origin}${previewPath}"`));
  assert.ok(response.text.includes(`property="og:url" content="${origin}${previewPath}"`));
  assert.doesNotMatch(response.text, /application\/ld\+json|Publicado el|datePublished/);
  for (const article of articles) {
    assert.ok(response.text.includes(escapeHtml(article.title)));
    assert.ok(response.text.includes(`href="${previewPath}${article.slug}"`));
    assert.ok(response.text.includes(article.hero.src));
  }
  assert.doesNotMatch(response.text, /funcionan-los-programas-de-fidelizacion/);
  const head = await request(previewPath, 'HEAD');
  assert.equal(head.status, 200); assert.equal(head.text, ''); assertPrivate(head);
});

for (const article of articles) test(`preview preserves article, references and both existing images: ${article.slug}`, async t => {
  const request = await fixture(t);
  const url = previewPath + article.slug;
  const response = await request(url);
  assert.equal(response.status, 200);
  assertPrivate(response);
  assert.ok(response.text.includes(`<h1>${escapeHtml(article.title)}</h1>`));
  assert.match(response.text, /<meta name="robots" content="noindex, nofollow, noarchive, noimageindex"/);
  assert.ok(response.text.includes(`rel="canonical" href="${origin}${url}"`));
  assert.ok(response.text.includes(`property="og:url" content="${origin}${url}"`));
  assert.match(response.text, /Publicación prevista/);
  assert.doesNotMatch(response.text, /application\/ld\+json|Publicado el|datePublished/);
  const body = /<div class="guide-body">([\s\S]*?)<\/div><footer/;
  assert.equal(response.text.match(body)?.[1], renderGuideArticle({ origin, article }).match(body)?.[1]);
  assert.ok(response.text.includes(`href="${previewPath}"`));
  for (const other of articles.filter(other => other.slug !== article.slug)) assert.ok(response.text.includes(`href="${previewPath}${other.slug}"`));
  for (const reference of article.references) {
    assert.ok(response.text.includes(`id="ref-${reference.id}"`));
    assert.ok(response.text.includes(`href="${escapeHtml(reference.href)}"`));
    assert.ok(response.text.includes(escapeHtml(reference.citation)));
  }
  for (const src of [article.hero.src, article.hero.srcSmall]) {
    assert.ok(response.text.includes(src));
    const image = await request(src);
    assert.equal(image.status, 200); assert.match(image.headers['content-type'], /image\/webp/);
    assert.ok(image.body.length > 100);
  }
  const head = await request(url, 'HEAD');
  assert.equal(head.status, 200); assert.equal(head.text, ''); assertPrivate(head);
});

test('preview canonical and sharing metadata use configured origin, never the request Host', async t => {
  const request = await fixture(t);
  for (const url of [previewPath, previewPath + slugs[0]]) {
    const response = await request(url, 'GET', 'untrusted.example');
    assert.equal(response.status, 200); assertPrivate(response);
    assert.ok(response.text.includes(`rel="canonical" href="${origin}${url}"`));
    assert.ok(response.text.includes(`property="og:url" content="${origin}${url}"`));
    assert.doesNotMatch(response.text, /untrusted\.example/);
  }
});

test('preview rejects other slugs and methods and never leaks into public discovery', async t => {
  const before = JSON.stringify(guideCatalog);
  const request = await fixture(t);
  for (const suffix of ['missing', 'funcionan-los-programas-de-fidelizacion', 'manifest.json', '../manifest.json', `${slugs[0]}/extra`]) {
    const response = await request(previewPath + suffix);
    assert.equal(response.status, 404); assertPrivate(response);
  }
  for (const url of [previewPath, previewPath + slugs[0]]) {
    const response = await request(url, 'POST');
    assert.equal(response.status, 405); assert.equal(response.headers.allow, 'GET, HEAD'); assertPrivate(response);
  }
  for (const [from, to] of [[previewPath.slice(0, -1), previewPath], [previewPath + 'index.html', previewPath], [previewPath + slugs[0] + '/', previewPath + slugs[0]]]) {
    const response = await request(from);
    assert.equal(response.status, 307); assert.equal(response.headers.location, to); assertPrivate(response);
  }
  for (const url of ['/', '/guias/', '/sitemap.xml']) {
    const response = await request(url);
    assert.equal(response.status, 200);
    assert.doesNotMatch(response.text, /revision-editorial/);
    for (const slug of slugs) assert.ok(!response.text.includes(slug));
  }
  for (const slug of slugs) assert.equal((await request('/guias/' + slug)).status, 404);
  assert.equal(JSON.stringify(guideCatalog), before);
});
