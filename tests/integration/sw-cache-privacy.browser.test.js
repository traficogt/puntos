import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import express from 'express';

test('real browser never retains a private mixed-case API response across customer logout', { timeout: 30000 }, async () => {
const app = express();
app.disable('etag');
let sessionActive = false;
const visits = [];
const dummyMe = {
  ok: true,
  business: { id: 'dummy-business', name: 'Dummy business', slug: 'dummy', plan: 'BASICO', features: {} },
  customer: { id: 'dummy-customer-a', name: 'DUMMY_A_PRIVATE_NAME', phone: 'DUMMY_A_PRIVATE_PHONE', points: 37, pending_points: 0, lifetime_points: 37 }
};
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; connect-src 'self'");
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  next();
});
app.post('/fixture/login', (_req, res) => {
  sessionActive = true;
  res.cookie('dummy_session', 'dummy-a', { httpOnly: true, sameSite: 'strict', path: '/' });
  res.cookie('dummy_csrf', 'dummy-csrf', { sameSite: 'strict', path: '/' });
  res.json({ ok: true });
});
const api = express.Router();
api.use((req, res, next) => {
  const allowed = sessionActive && /(?:^|;\s*)dummy_session=dummy-a(?:;|$)/.test(req.headers.cookie || '');
  visits.push({ path: req.originalUrl, method: req.method, authorized: allowed });
  if (!allowed) return res.status(401).json({ error: 'No autenticado', code: 'AUTH_REQUIRED' });
  next();
});
api.get('/customer/me', (_req, res) => res.json(dummyMe));
api.post('/public/customer/logout', (req, res) => {
  if (req.headers['x-csrf-token'] !== 'dummy-csrf') return res.status(403).json({ error: 'CSRF' });
  sessionActive = false;
  res.clearCookie('dummy_session', { path: '/' });
  res.json({ ok: true });
});
api.get('/customer/rewards', (_req, res) => res.json({ rewards: [] }));
api.get('/customer/history', (_req, res) => res.json({ transactions: [], redemptions: [] }));
api.get('/customer/statement', (_req, res) => res.json({ statement: null }));
app.use('/api', api);
app.get('/fixture/blank', (_req, res) => res.type('html').send('<!doctype html><title>Dummy fixture</title><p>Fixture</p>'));
app.get('/fixture/private.js', (_req, res) => res.set('Cache-Control', 'public, No-StOrE').type('js').send('private fixture'));
app.get('/fixture/private.txt', (_req, res) => res.set('Cache-Control', 'private="Set-Cookie", max-age=60').type('text').send('private fixture'));
app.get('/fixture/public.js', (_req, res) => res.set('Cache-Control', 'public, max-age=60').type('js').send('public fixture'));
app.get('/fixture/wallet', (_req, res) => res.type('html').send('<!doctype html><title>Dummy wallet</title><button id="btnLogout">Logout</button><main id="main"><span id="who"></span><span id="points"></span></main><div id="needLogin" hidden></div><a id="mixed" href="/API/customer/me" target="_blank">Open exact mixed-case URL</a><script type="module" src="/fixture/setup.js"></script>'));
app.get('/ingresar/dummy', (_req, res) => res.type('html').send('<!doctype html><title>Logged out</title><p>Logged out</p>'));
app.get('/fixture/setup.js', (_req, res) => res.type('js').send(`
import { initCustomerPage } from '/customer/index.js';
const api = async (path, opts = {}) => {
  const response = await fetch(path, { ...opts, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'x-csrf-token': 'dummy-csrf' } });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error), { status: response.status, code: data.code });
  return data;
};
await initCustomerPage({ api, $: selector => document.querySelector(selector), toast: () => {}, mountIosInstallHint: () => {}, modalAlert: async () => {} });
await navigator.serviceWorker.ready;
if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
window.fixtureReady = true;
`));
// Only source JavaScript is served from the read-only target. Other precache requests are 404.
app.use((req, res, next) => req.path.endsWith('.js') ? next() : res.status(404).end());
app.use(express.static(fileURLToPath(new URL('../../public', import.meta.url)), { redirect: false, etag: false, maxAge: 0 }));
app.use((_req, res) => res.status(404).end());
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const address = server.address();
assert.ok(address && typeof address !== 'string');
const base = `http://127.0.0.1:${address.port}`;
let browser;
try {
  browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  context.setDefaultTimeout(10000);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', err => errors.push(String(err).slice(0, 180)));
  await page.goto(`${base}/fixture/blank`);
  // Model an entry left by the old worker before the new generation activates.
  await page.evaluate(async payload => {
    const oldCache = await caches.open('pf-v51');
    await oldCache.put('/API/customer/me', new Response(JSON.stringify(payload), { headers: { 'Cache-Control': 'no-store' } }));
  }, dummyMe);
  await page.evaluate(() => fetch('/fixture/login', { method: 'POST' }));
  await page.goto(`${base}/fixture/wallet`);
  await page.waitForFunction(() => Reflect.get(window, 'fixtureReady') === true);
  const initial = await page.evaluate(async () => ({
    controlled: Boolean(navigator.serviceWorker.controller),
    displayedA: document.querySelector('#who').textContent.includes('DUMMY_A_PRIVATE_NAME'),
    idbA: /** @type {{customer?: {id?: string}}} */ ((await (await import('/idb.js')).getCustomerCacheSnapshot({ businessId: 'dummy-business', customerId: 'dummy-customer-a' })).sections.me)?.customer?.id,
    legacyCachePresent: (await caches.keys()).includes('pf-v51'),
    lowercaseCached: Boolean(await caches.match('/api/customer/me'))
  }));
  assert.equal(initial.controlled, true);
  assert.equal(initial.displayedA, true);
  assert.equal(initial.idbA, 'dummy-customer-a');
  assert.equal(initial.legacyCachePresent, false, 'activation purges the old generation and its private entries');
  assert.equal(initial.lowercaseCached, false);
  const assetCaching = await page.evaluate(async () => {
    const result = {};
    for (const path of ['/fixture/private.js', '/fixture/private.txt', '/fixture/public.js']) {
      await (await fetch(path)).text();
      Reflect.set(result, path, Boolean(await caches.match(path)));
    }
    return result;
  });
  assert.deepEqual(assetCaching, { '/fixture/private.js': false, '/fixture/private.txt': false, '/fixture/public.js': true });
  const popupPromise = page.waitForEvent('popup');
  await page.locator('#mixed').click();
  const popup = await popupPromise;
  await popup.waitForLoadState('domcontentloaded');
  const online = JSON.parse(await popup.locator('body').innerText());
  assert.equal(online.customer.id, 'dummy-customer-a');
  const stored = await page.evaluate(async () => {
    const response = await caches.match('/API/customer/me');
    return response ? { type: response.type, cacheControl: response.headers.get('cache-control'), value: await response.json() } : null;
  });
  assert.equal(stored, null, 'an authenticated mixed-case API response must never enter Cache Storage');
  await popup.close();
  await Promise.all([
    page.waitForURL('**/ingresar/dummy?motivo=salida'),
    page.locator('#btnLogout').click()
  ]);
  const loggedOut = await page.evaluate(async () => {
    const snapshot = await (await import('/idb.js')).getCustomerCacheSnapshot({ businessId: 'dummy-business', customerId: 'dummy-customer-a' });
    const fresh = await fetch('/api/customer/me', { cache: 'no-store' });
    return {
      localIdentity: localStorage.getItem('pf_customer_identity'),
      blocked: localStorage.getItem('pf_customer_blocked'),
      idbSections: Object.keys(snapshot.sections),
      freshLowercaseStatus: fresh.status,
      mixedCacheStillPresent: Boolean(await caches.match('/API/customer/me'))
    };
  });
  assert.equal(sessionActive, false);
  assert.equal(loggedOut.localIdentity, null);
  assert.equal(loggedOut.blocked, '1');
  assert.deepEqual(loggedOut.idbSections, []);
  assert.equal(loggedOut.freshLowercaseStatus, 401);
  assert.equal(loggedOut.mixedCacheStillPresent, false);
  const cookies = await context.cookies();
  assert.equal(cookies.some(cookie => cookie.name === 'dummy_session'), false);
  const offlineResponses = [];
  page.on('response', response => {
    if (response.url() === `${base}/API/customer/me`) offlineResponses.push(response.status());
  });
  await context.setOffline(true);
  await assert.rejects(page.goto(`${base}/API/customer/me`, { waitUntil: 'domcontentloaded' }), /ERR_INTERNET_DISCONNECTED|ERR_FAILED|ERR_NETWORK_CHANGED/);
  assert.deepEqual(offlineResponses, [], 'offline navigation must not receive a cached private response');
  assert.deepEqual(errors, []);
  await context.close();
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}

});
