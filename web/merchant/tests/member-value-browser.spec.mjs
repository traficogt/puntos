import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import express from 'express';
import { chromium, expect } from '@playwright/test';

const merchant = path.resolve(import.meta.dirname, '..'), project = path.resolve(merchant, '../..');
const output = '/var/lib/puntos/releases/member-value-20261111/combined-browser';
await fs.mkdir(output, { recursive: true });
const app = express();
app.get('/demostracion/', (_req, res) => res.sendFile(path.join(project, 'public/merchant/index.html')));
app.get('/test-axe.js', (_req, res) => res.sendFile(path.join(merchant, 'node_modules/axe-core/axe.min.js')));
app.use('/negocio', express.static(path.join(project, 'public/merchant')));
app.use(express.static(path.join(project, 'public')));
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const origin = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch();
try {
  for (const width of [390, 1200]) for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport: { width, height: 950 }, colorScheme: theme, serviceWorkers: 'block' });
    await context.route('https://privatrack.com/**', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
    const page = await context.newPage(), errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request.url()); });
    await page.goto(`${origin}/demostracion/#resumen`);
    const report = page.locator('section[aria-labelledby="redemption-returns-heading"]');
    await expect(report.getByText('Con 30 días completos', { exact: true })).toBeVisible();
    await expect(report).toContainText('12 de 30 clientes volvieron');
    await page.addScriptTag({ url: `${origin}/test-axe.js` });
    await report.scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(await page.evaluate(async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa'] })).violations.map(v => v.id)), []);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${output}/returns-${width}-${theme}.png`, fullPage: true });
    await page.goto(`${origin}/demostracion/#cortesias`);
    await expect(page.getByRole('heading', { name: 'Resultados por autorización' })).toBeVisible();
    await expect(page.getByText('1 sin costo registrado', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Autorizar cortesía', exact: true }).click();
    const value = await page.getByLabel('Recompensa aprobada').locator('option').nth(1).getAttribute('value');
    await page.getByLabel('Recompensa aprobada').selectOption(value);
    await page.getByLabel(/Presupuesto total/).fill('12');
    await page.getByRole('button', { name: 'Usar prueba de hasta 5 unidades' }).click();
    await expect(page.getByLabel(/^Unidades totales/)).toHaveValue('2');
    await page.addScriptTag({ url: `${origin}/test-axe.js` });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(await page.evaluate(async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa'] })).violations.map(v => v.id)), []);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${output}/hospitality-${width}-${theme}.png`, fullPage: true });
    await page.locator('section[aria-labelledby="hospitality-results-heading"] [data-scrollarea-viewport]').evaluate(el => { el.scrollLeft = el.scrollWidth; });
    await page.screenshot({ path: `${output}/hospitality-costs-${width}-${theme}.png`, fullPage: true });
    assert.deepEqual(errors, []); assert.deepEqual(requests, []);
    await context.close();
  }
  console.log('Combined demo: return report, exact courtesy cap, unknown costs, four layouts, axe and zero real API requests passed.');
} finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
