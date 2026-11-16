import { test, expect } from '@playwright/test';
import { startPwaStaticServer } from '../integration/helpers/pwa-static-server.js';

test.use({ serviceWorkers: 'block' });
let server;
test.beforeAll(async () => { server = await startPwaStaticServer(); });
test.afterAll(async () => { await server.stop(); });
test.beforeEach(async ({ page }) => {
  // These tests drive the renderers directly. Authentication/bootstrap has its
  // own suites and must not asynchronously clear this synthetic card.
  await page.route('**/customer.js', route => route.fulfill({ contentType: 'application/javascript', body: '' }));
  await page.route('**/api/**', route => route.fulfill({ status: 401, json: { code: 'AUTH_REQUIRED' } }));
  await page.goto(`${server.baseUrl}/c?sw=noreload`);
  await page.evaluate(() => {
    const main = document.querySelector('#main');
    main.classList.remove('is-hidden'); main.removeAttribute('hidden');
    document.querySelector('#needLogin').setAttribute('hidden', '');
  });
});
async function reward(page, points, extra = {}) {
  await page.evaluate(async ({ points, extra }) => {
    const path = '/customer/render.js';
    const { renderRewards } = await import(path);
    const target = { id: 'r', name: 'Café de la casa', points_cost: 100, active: true, available: true };
    const progress = { available_points: points, pending_points: 900, as_of: new Date().toISOString(), reward: { ...target, remaining_points: Math.max(0, 100 - points) }, choices: [target], conditions: 'Válido en Centro.', earning: '', next_refresh_at: null, ...extra.progress };
    renderRewards(selector => document.querySelector(selector), 99999, [target], { progress, isLive: extra.isLive ?? true });
  }, { points, extra });
}
test('progress changes at halfway using available points and keeps the selected target and terms', async ({ page }) => {
  for (const [points, copy] of [[0, 'Tu próxima recompensa: “Café de la casa”.'], [1, 'Ya tienes 1 de 100 puntos para “Café de la casa”.'], [49, 'Ya tienes 49 de 100 puntos para “Café de la casa”.'], [50, 'Te faltan 50 puntos para “Café de la casa”.'], [99, 'Te falta 1 punto para “Café de la casa”.'], [100, 'Tienes los puntos para “Café de la casa”.'], [101, 'Tienes los puntos para “Café de la casa”.']]) {
    await reward(page, points);
    await expect(page.locator('#nextReward')).toHaveText(String(copy));
    await expect(page.locator('#nextRewardBalance')).toContainText(`${points} puntos disponibles`);
    await expect(page.locator('#nextRewardBalance')).toContainText('100 puntos de costo');
    await expect(page.locator('#nextRewardConditions')).toContainText('Válido en Centro.');
    await expect(page.locator('#nextRewardConditions')).toContainText('En caja se confirman');
  }
  await reward(page, 25, { progress: { reward: { id: 'protected', name: 'Original', points_cost: 50, remaining_points: 25, protected: true }, choices: [{ id: 'protected', name: 'Original', points_cost: 50, available: true, protected: true }] } });
  await expect(page.locator('#nextReward')).toHaveText('Te faltan 25 puntos para “Original”.');
});
test('offline, stale, invalid and expired targets never manufacture live progress', async ({ page }) => {
  await reward(page, 20, { isLive: false });
  await expect(page.locator('#nextReward')).toContainText('Datos guardados');
  for (const extra of [
    { progress: { next_refresh_at: '2000-01-01T00:00:00Z' } },
    { progress: { reward: { id: 'r', name: 'Old', points_cost: 100, remaining_points: 80, valid_until: '2000-01-01T00:00:00Z' } } },
    { progress: { reward: null } }
  ]) {
    await reward(page, 20, extra);
    await expect(page.locator('#nextReward')).not.toContainText('Ya tienes');
    await expect(page.locator('#nextRewardBalance')).toBeEmpty();
  }
  for (const points of [-1, null, 'invalid']) {
    await reward(page, points);
    await expect(page.locator('#nextReward')).not.toContainText('Ya tienes');
    await expect(page.locator('#nextReward')).not.toContainText('Tienes los puntos');
    await expect(page.locator('#nextRewardBalance')).toBeEmpty();
  }
});
test('older live responses remain compatible and target deadlines expire without a reload', async ({ page }) => {
  await page.evaluate(async () => {
    const path = '/customer/render.js';
    const { renderRewards } = await import(path);
    renderRewards(selector => document.querySelector(selector), 25, [{ id: 'old', name: 'Respuesta anterior', points_cost: 51 }]);
  });
  await expect(page.locator('#nextReward')).toHaveText('Ya tienes 25 de 51 puntos para “Respuesta anterior”.');
  await page.clock.install();
  const deadline = await page.evaluate(() => new Date(Date.now() + 5000).toISOString());
  await reward(page, 26, { progress: { next_refresh_at: deadline, reward: { id: 'r', name: 'Medio', points_cost: 51, remaining_points: 25 } } });
  await expect(page.locator('#nextReward')).toHaveText('Te faltan 25 puntos para “Medio”.');
  await page.clock.fastForward(5001);
  await expect(page.locator('#nextReward')).toContainText('Actualiza la tarjeta');
  await expect(page.locator('#nextRewardBalance')).toBeEmpty();
  await expect(page.locator('.cus-reward-ready')).toHaveCount(0);
});
test('history explains origins and statuses, falls back for old cached rows and escapes all content', async ({ page }, testInfo) => {
  await page.evaluate(async () => {
    const path = '/customer/render.js';
    const { renderHistory } = await import(path);
    const base = { created_at: '2026-11-16T12:00:00Z', points_delta: 20, amount_q: 100 };
    renderHistory(selector => document.querySelector(selector), [
      { ...base, provenance: { kind: 'purchase', status: 'POSTED', includes_bonus: true } },
      { ...base, provenance: { kind: 'referral_bonus', status: 'PENDING' } },
      { ...base, provenance: { kind: 'achievement_bonus', status: 'REVERSED' } },
      { ...base, provenance: { kind: 'opening_balance', status: 'EXPIRED' } },
      { ...base, source: 'online', meta: { note: '<img src=x onerror=alert(1)>' } },
      { ...base, provenance: { kind: '<script>evil</script>', status: 'untrusted' } }
    ], [{ ...base, reward_name: '<img src=x onerror=alert(1)>', code: '<script>evil</script>', points_cost: 10, status: 'CANCELLED' }]);
  });
  const history = page.locator('#tx');
  await expect(history).toContainText('Compra · Incluye bonificación');
  await expect(history).toContainText('Bono por referido · Pendiente de confirmar');
  await expect(history).toContainText('Bono por logro · Revertido');
  await expect(history).toContainText('Saldo inicial importado · Vencido');
  await expect(history).toContainText('Origen no documentado');
  expect((await history.textContent()).match(/100[.,]00/g)?.length).toBe(1);
  await expect(page.locator('#red')).toContainText('Cancelado');
  await expect(page.locator('#red')).toContainText('<img src=x');
  await expect(page.locator('#tx img, #red img, #tx script, #red script')).toHaveCount(0);
  await page.addScriptTag({ path: 'web/merchant/node_modules/axe-core/axe.min.js' });
  for (const width of [390, 1200]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
    expect(await history.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    const violations = await page.evaluate(async () => (await window['axe'].run({ include: ['#tx', '#red'] }, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations.map(v => v.id));
    expect(violations).toEqual([]);
    await history.screenshot({ path: testInfo.outputPath(`history-${width}-${theme}.png`) });
  }
});
