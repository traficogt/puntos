import { test, expect } from '@playwright/test';
import { startPwaStaticServer } from '../integration/helpers/pwa-static-server.js';

test.use({ serviceWorkers: 'block' });
let server;
test.beforeAll(async () => { server = await startPwaStaticServer(); });
test.afterAll(async () => { await server.stop(); });
const statement = {
  as_of: '2026-11-11T12:00:00Z', period: { days: 30, start: '2026-10-12T12:00:00Z', end: '2026-11-11T12:00:00Z' },
  points: { earned: 140, redeemed: 30, expired: 9, adjustments: -20 },
  balance: { available: 42, pending: 7 }, rewards: { completed: 2 }
};
test('customer statement is readable, honest about saved data and cleared on logout', async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ status: 401, json: { code: 'AUTH_REQUIRED' } }));
  await page.goto(`${server.baseUrl}/c?sw=noreload`);
  await page.evaluate(() => {
    const main = document.querySelector('#main');
    main.classList.remove('is-hidden');
    main.removeAttribute('hidden');
    document.querySelector('#needLogin').setAttribute('hidden', '');
  });
  await expect(page.locator('#customerStatement')).toHaveCount(1);
  await page.evaluate(async data => {
    const path = '/customer/statement.js';
    const { renderStatement } = await import(path);
    renderStatement(selector => document.querySelector(selector), data, { isLive: true, region: { locale: 'es-GT', timezone: 'America/Guatemala' } });
  }, statement);
  const section = page.locator('#customerStatement');
  await expect(section).toContainText('140');
  await expect(section).toContainText('Consultado al');
  await expect(section).toContainText('Vencidos');
  await expect(section).toContainText('-20');
  await expect(section).toContainText('2 canjes completados');
  await expect(section).toContainText('no tienen una equivalencia en dinero');
  await page.addScriptTag({ path: 'web/merchant/node_modules/axe-core/axe.min.js' });
  for (const width of [390, 1200]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
    expect(await section.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    const violations = await page.evaluate(async () => (await window['axe'].run({ include: ['#customerStatement'] }, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations.map(v => v.id));
    expect(violations).toEqual([]);
    await section.screenshot({ path: `/var/lib/puntos/releases/member-value-20261111/statement-${width}-${theme}.png` });
  }
  await page.evaluate(async data => {
    const path = '/customer/statement.js';
    const { renderStatement } = await import(path);
    renderStatement(selector => document.querySelector(selector), data, { isLive: false });
  }, statement);
  await expect(section).toContainText('Resumen guardado');
  await page.evaluate(async () => {
    const path = '/customer/session.js';
    const { clearWalletView } = await import(path);
    clearWalletView(selector => document.querySelector(selector));
  });
  await expect(section).toBeEmpty();
});
