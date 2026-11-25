// Actual merchant build in demo mode; the trial scenarios come from ?prueba= and no request
// may reach a PF API. Covers the banner (active and last days), the soft-lock screen, the
// compact notice on reading pages, the upgrade request form and the 404 "no banner" default.
import strictAssert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { chromium, expect } from '@playwright/test';
import { build } from 'vite';

let checks = 0;
const assert = { equal: (...args) => { strictAssert.equal(...args); checks++; }, deepEqual: (...args) => { strictAssert.deepEqual(...args); checks++; } };
const merchant = path.resolve(import.meta.dirname, '..');
const project = path.resolve(merchant, '../..');
const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pf-trial-browser-'));
await build({ root: merchant, configFile: path.join(merchant, 'vite.config.js'), build: { outDir, emptyOutDir: true }, logLevel: 'warn' });
const app = express();
app.get('/negocio/', (_req, res) => res.sendFile(path.join(outDir, 'index.html')));
app.get('/runtime-config.js', (_req, res) => res.type('js').send('window.__PF_RUNTIME_CONFIG__={};'));
app.use('/negocio', express.static(outDir));
app.use(express.static(path.join(project, 'public')));
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const axeSource = await fs.readFile(path.join(merchant, 'node_modules/axe-core/axe.min.js'), 'utf8');
let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 950 }, serviceWorkers: 'block' });
  const errors = [], requests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin || url.pathname.startsWith('/api/')) { requests.push(url.href); return route.abort(); }
    return route.continue();
  });
  const axe = async () => { await page.evaluate(axeSource); return page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)); };

  // Default demo: the trial endpoint answers 404, nothing about trials is shown.
  await page.goto(`${origin}/negocio/?demo=1#resumen`);
  await expect(page.getByText('Vista previa · datos de ejemplo', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Inicio', exact: true }).or(page.locator('main h1').first())).toBeVisible();
  assert.equal(await page.getByTestId('trial-banner').count(), 0);
  assert.equal(await page.getByTestId('trial-lock-screen').count(), 0);
  assert.equal(await page.getByText('Plan Impulsa', { exact: true }).count(), 1, 'the footer shows the display name instead of the code');

  // Active trial: blue banner with the days left and the upgrade request form.
  await page.goto(`${origin}/negocio/?demo=1&prueba=activa#resumen`);
  const banner = page.getByTestId('trial-banner');
  await expect(banner).toContainText('Te quedan 9 días de prueba gratis con Conecta.');
  await expect(banner).toContainText('solo lectura');
  assert.equal(await page.getByText('Plan Conecta', { exact: true }).count(), 1);
  await banner.getByRole('button', { name: 'Mejorar plan', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Mejorar plan', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Pronto podrás pagar con tarjeta desde aquí.');
  await dialog.getByRole('button', { name: 'Enviar solicitud', exact: true }).click();
  await expect(dialog).toContainText('Escribe un teléfono o WhatsApp donde podamos contactarte.');
  await dialog.getByLabel('Teléfono o WhatsApp').fill('5555 1234');
  await dialog.getByRole('button', { name: 'Enviar solicitud', exact: true }).click();
  await expect(dialog).toContainText('Recibimos tu solicitud');
  await expect(dialog).toContainText('activar Impulsa');
  assert.deepEqual(await axe(), []);
  await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await expect(dialog).toBeHidden();

  // Last days: the banner turns yellow (Mantine colour attribute) and counts down.
  await page.goto(`${origin}/negocio/?demo=1&prueba=ultimos-dias#resumen`);
  await expect(page.getByTestId('trial-banner')).toContainText('Te quedan 2 días de prueba gratis con Conecta.');
  assert.equal(await page.getByTestId('trial-banner').getAttribute('data-tone'), 'yellow');
  assert.equal(await page.goto(`${origin}/negocio/?demo=1&prueba=activa#resumen`).then(() => page.getByTestId('trial-banner').getAttribute('data-tone')), 'blue');

  // Locked: the home explains the read-only state; other pages keep reading behind a notice.
  await page.goto(`${origin}/negocio/?demo=1&prueba=bloqueada#resumen`);
  const lock = page.getByTestId('trial-lock-screen');
  await expect(lock.getByRole('heading', { name: 'Tu prueba terminó', exact: true })).toBeVisible();
  await expect(lock).toContainText('Lo que ven tus clientes');
  await expect(lock).toContainText('Su tarjeta sigue visible con el saldo y el historial.');
  await expect(lock).toContainText('Conservamos clientes, puntos y configuración hasta el');
  assert.equal(await page.getByTestId('trial-banner').count(), 0);
  assert.deepEqual(await axe(), []);
  await lock.getByRole('button', { name: 'Ver clientes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Clientes', exact: true })).toBeVisible();
  await expect(page.getByTestId('trial-lock-alert')).toContainText('Tu prueba terminó: el panel está en modo de lectura');
  await expect(page.getByRole('button', { name: 'Abrir perfil de Ana López', exact: true })).toBeVisible();
  await page.getByTestId('trial-lock-alert').getByRole('button', { name: 'Mejorar plan', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Mejorar plan', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/negocio/?demo=1&prueba=bloqueada#resumen`);
  await expect(page.getByTestId('trial-lock-screen')).toBeVisible();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(await axe(), []);
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  console.log(JSON.stringify({ kind: 'trial-browser', checks, passed: true }));
  console.log('Trial browser: no banner on 404, active and last-days banners, upgrade request, lock screen, compact notice and axe at 1280/390 passed.');
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(outDir, { recursive: true, force: true });
}
