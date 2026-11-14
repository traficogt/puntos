import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import path from 'node:path';
import { createEditorialReview, EDITORIAL_REVIEW_PATH } from '../../src/middleware/editorial-review.js';
import { createSearchVisibility } from '../../src/middleware/search-visibility.js';

async function fixture(t) {
  const app = express();
  app.use(createSearchVisibility({ marketingOrigin: 'http://127.0.0.1', appOrigin: 'http://app.example' }));
  app.use(createEditorialReview());
  app.use(express.static(path.resolve('public'), { extensions: ['html'], redirect: false }));
  app.use((_req, res) => res.status(404).send('Not found'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing address');
  return (url, options) => fetch(`http://127.0.0.1:${address.port}${url}`, { redirect: 'manual', ...options });
}

test('review document and assets are unindexed and never cached, including HEAD', async t => {
  const request = await fixture(t);
  for (const name of ['', 'article.css', 'volver-640.webp', 'volver-1152.webp', 'progreso-640.webp', 'progreso-1152.webp']) {
    for (const method of ['GET', 'HEAD']) {
      const response = await request(EDITORIAL_REVIEW_PATH + name, { method });
      assert.equal(response.status, 200);
      assert.match(response.headers.get('x-robots-tag'), /noindex/);
      assert.match(response.headers.get('cache-control'), /no-store/);
      if (method === 'HEAD') assert.equal(await response.text(), '');
    }
  }
  const html = await (await request(EDITORIAL_REVIEW_PATH)).text();
  assert.match(html, /<meta name="robots" content="noindex, nofollow, noarchive"/);
  assert.doesNotMatch(html, /rel="canonical"|application\/ld\+json/);
});

test('review cannot be reached through a public filename or catalog and rejects unknown files', async t => {
  const request = await fixture(t);
  for (const url of ['/article-review/index.html', '/src/content/article-review/index.html', '/revision-editorial/', EDITORIAL_REVIEW_PATH + 'SOURCES.md', EDITORIAL_REVIEW_PATH + 'missing.jpg']) {
    assert.equal((await request(url)).status, 404, url);
  }
  for (const url of [EDITORIAL_REVIEW_PATH.slice(0, -1), EDITORIAL_REVIEW_PATH + 'index.html']) {
    const response = await request(url);
    assert.equal(response.status, 307);
    assert.equal(response.headers.get('location'), EDITORIAL_REVIEW_PATH);
    assert.match(response.headers.get('x-robots-tag'), /noindex/);
  }
  assert.equal((await request(EDITORIAL_REVIEW_PATH, { method: 'POST' })).status, 405);
  const sitemap = await (await request('/sitemap.xml')).text();
  assert.doesNotMatch(sitemap, /revision-editorial/);
  const home = await (await request('/')).text();
  assert.doesNotMatch(home, /revision-editorial/);
});
