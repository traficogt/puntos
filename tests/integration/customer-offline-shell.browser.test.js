import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import express from 'express';
import { chromium } from 'playwright';

test('the first offline wallet reload retains the current wallet stylesheet', { timeout: 30000 }, async () => {
  const app = express();
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed repository fixture.
  const wallet = await readFile(new URL('../../public/customer.html', import.meta.url), 'utf8');
  app.use((_req, res, next) => {
    res.set('Cache-Control', 'public, max-age=0, must-revalidate');
    res.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'");
    next();
  });
  app.get(['/mi-tarjeta/', '/customer.html'], (_req, res) => res.type('html').send(wallet));
  app.get('/runtime-config.js', (_req, res) => res.type('js').send(''));
  app.use('/api', (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (req.path === '/customer/me') return res.json({
      business: { id: 'fixture-business', name: 'Café', slug: 'cafe', plan: 'BASICO', features: {} },
      customer: { id: 'fixture-customer', name: 'Cliente', points: 10, pending_points: 0 }
    });
    return res.json({ providers: {}, passes: [], rewards: [], transactions: [], redemptions: [], offers: [], hospitality: [], requests: [] });
  });
  app.use(express.static(fileURLToPath(new URL('../../public', import.meta.url)), { dotfiles: 'allow', etag: false, maxAge: 0 }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  let browser;
  try {
    browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const context = await browser.newContext({ serviceWorkers: 'allow' });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/mi-tarjeta/`);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    });
    const session = await context.newCDPSession(page);
    await session.send('Network.clearBrowserCache');
    await context.setOffline(true);
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelector('#points')?.textContent === '10');
    const retained = await page.evaluate(() => Array.from(document.styleSheets).some(sheet => {
      if (!sheet.href?.endsWith('/styles/customer-wallet-refresh.css')) return false;
      try { return sheet.cssRules.length > 0; } catch { return false; }
    }));
    assert.equal(retained, true, 'wallet detail/refresh styles must survive the first offline reload');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
