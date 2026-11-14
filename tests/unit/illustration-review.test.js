import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import path from 'node:path';
import { createIllustrationReview, ILLUSTRATION_REVIEW_PATH } from '../../src/middleware/illustration-review.js';
import { createSearchVisibility } from '../../src/middleware/search-visibility.js';

async function fixture(t) {
  const app = express();
  app.use(createSearchVisibility({ marketingOrigin: 'http://127.0.0.1', appOrigin: 'http://app.example' }));
  app.use(createIllustrationReview());
  app.use(express.static(path.resolve('public'), { extensions: ['html'], redirect: false }));
  app.use((_req, res) => res.status(404).send('Not found'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing address');
  return (url, options) => fetch(`http://127.0.0.1:${address.port}${url}`, { redirect: 'manual', ...options });
}

test('gallery and every linked image size stay unindexed and uncached', async t => {
  const request = await fixture(t);
  const document = await request(ILLUSTRATION_REVIEW_PATH);
  assert.equal(document.status, 200);
  const html = await document.text();
  assert.match(html, /<meta name="robots" content="noindex, nofollow, noarchive"/);
  assert.equal((html.match(/<img\b/g) || []).length, 10);
  const images = new Set([...html.matchAll(/\.\/([a-z0-9-]+\.webp)/g)].map(match => match[1]));
  assert.equal(images.size, 20);
  const views = [...html.matchAll(/href="\.\/([a-z0-9-]+\.html)"/g)].map(match => match[1]);
  assert.equal(views.length, 10);
  for (const filename of ['', 'gallery.css', ...images, ...views]) {
    for (const method of ['GET', 'HEAD']) {
      const response = await request(ILLUSTRATION_REVIEW_PATH + filename, { method });
      assert.equal(response.status, 200, filename);
      assert.match(response.headers.get('x-robots-tag'), /noindex/);
      assert.match(response.headers.get('cache-control'), /no-store/);
      if (method === 'HEAD') assert.equal(await response.text(), '');
      else await response.arrayBuffer();
    }
  }
});

test('gallery has no public entry, source file access, or alternate index URL', async t => {
  const request = await fixture(t);
  for (const filename of ['PROMPTS.md', 'assets.json', 'originals/01-plaza.png', 'missing.webp']) {
    const response = await request(ILLUSTRATION_REVIEW_PATH + filename);
    assert.equal(response.status, 404);
    assert.match(response.headers.get('x-robots-tag'), /noindex/);
  }
  assert.equal((await request('/illustration-review/index.html')).status, 404);
  for (const url of [ILLUSTRATION_REVIEW_PATH.slice(0, -1), ILLUSTRATION_REVIEW_PATH + 'index.html']) {
    const response = await request(url);
    assert.equal(response.status, 307);
    assert.equal(response.headers.get('location'), ILLUSTRATION_REVIEW_PATH);
    assert.match(response.headers.get('x-robots-tag'), /noindex/);
  }
  assert.equal((await request(ILLUSTRATION_REVIEW_PATH, { method: 'POST' })).status, 405);
  for (const route of ['/', '/sitemap.xml']) assert.doesNotMatch(await (await request(route)).text(), /revision-ilustraciones/);
});
