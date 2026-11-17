import { test, expect } from '@playwright/test';
import { startPwaStaticServer } from '../integration/helpers/pwa-static-server.js';

// Browser checks for the website wallet and demo form. All API responses are
// local fixtures served on a random loopback port; no external service is used.
test.use({ serviceWorkers: 'block' });
let server;
test.beforeAll(async () => { server = await startPwaStaticServer(); });
test.afterAll(async () => { await server.stop(); });

const region = { country: 'GT', currency: 'GTQ', timezone: 'America/Guatemala', locale: 'es-GT', minorUnits: 2 };
const reward = { id: 'reward-a', name: 'Café de la casa', points_cost: 1500, active: true, available: true, branch_ids: [] };

function fixtures(version) {
  const now = new Date().toISOString();
  return {
    '/api/customer/me': { business: { id: 'business-a', slug: 'cafe', name: 'Café', plan: 'NEGOCIO', features: { tiers: true }, region, customer_branding: {} },
      customer: { id: 'customer-a', name: 'Ana', phone: '50255550000', points: 1499, pending_points: 0, lifetime_points: 12345, last_visit_at: now } },
    '/api/customer/wallet': { providers: {}, passes: [] },
    '/api/customer/rewards': { rewards: [reward], progress: { available_points: 1499, pending_points: 0, as_of: now, reward: { ...reward, remaining_points: 1 }, choices: [reward], conditions: 'Válido en Centro.', earning: '', next_refresh_at: null } },
    '/api/customer/history': { transactions: [{ created_at: now, points_delta: 10, amount_q: 25, provenance: { kind: 'purchase', status: 'POSTED' } }], redemptions: [] },
    '/api/customer/statement': { statement: { as_of: now, period: { days: 30, start: now, end: now }, points: { earned: 12345, redeemed: 0, expired: 0, adjustments: 0 }, balance: { available: 1499, pending: 1 }, rewards: { completed: version } } },
    '/api/customer/tier': { tier: { tier_level: 1, name: 'Bronce', points_multiplier: 1, current_points: 1499, points_to_next_tier: -300, next_tier_name: 'Plata', next_tier_points: 1200, perks: [] } },
    '/api/customer/growth-offers': { offers: [{ id: 'offer', name: version === 1 ? 'Oferta de la semana' : 'Oferta nueva', bonus_points: 1, minimum_purchase_q: 40, expires_at: new Date(Date.now() + 86400000).toISOString() }] },
    '/api/customer/reward-entitlements': { points: 1499, server_now: now, region, cycle: null, promises: [], hospitality: [] },
    '/api/customer/demand-notebook': { rewards: [], requests: [] }
  };
}

async function openWallet(page) {
  const state = { version: 1, cards: 0, gate: null, sessionEnded: false };
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/customer/me') {
      state.cards += 1;
      if (state.sessionEnded) return route.fulfill({ status: 401, json: { error: 'No autenticado', code: 'AUTH_REQUIRED' } });
    }
    if (path === '/api/public/customer/qr.svg') return route.fulfill({ status: 401, json: { error: 'No autenticado', code: 'AUTH_REQUIRED', request_id: 'r-1' } });
    const body = fixtures(state.version)[path];
    if (!body) return route.fulfill({ status: 404, json: { error: 'No encontrado', code: 'NOT_FOUND' } });
    if (state.gate && path !== '/api/customer/me') await state.gate;
    return route.fulfill({ json: body });
  });
  await page.goto(`${server.baseUrl}/c?sw=noreload`);
  await expect(page.locator('#growthOffers')).toContainText('Oferta de la semana');
  return state;
}

test('returning to the tab refreshes once and never blanks the visible card', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const state = await openWallet(page);
  await expect(page.locator('#tx')).toContainText('Compra');
  await expect(page.locator('#customerStatement')).toContainText('1 canje completado en');
  await expect(page.locator('#tierProgress')).toHaveText('Ya tienes los puntos para Plata; tu nivel se actualizará pronto.');
  await expect(page.locator('#rewards')).toContainText('Costo: 1,500 puntos');
  await expect(page.locator('#rewards')).toContainText('Te falta 1 punto');
  await expect(page.locator('#growthOffers')).toContainText('1 punto extra');
  const cardsBefore = state.cards;

  let release = /** @type {(value?: unknown) => void} */ (() => {});
  state.gate = new Promise(resolve => { release = resolve; });
  state.version = 2;
  // A real tab return dispatches both events.
  await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); });
  await expect.poll(() => state.cards).toBe(cardsBefore + 1);
  for (let sample = 0; sample < 5; sample++) {
    await page.waitForTimeout(100);
    await expect(page.locator('#tx')).toContainText('Compra');
    await expect(page.locator('#customerStatement')).toContainText('1 canje completado en');
    await expect(page.locator('#rewards')).toContainText('Café de la casa');
    await expect(page.locator('#growthOffers')).toContainText('Oferta de la semana');
    await expect(page.locator('#growthOffersSection')).toBeVisible();
  }
  release();
  await expect(page.locator('#growthOffers')).toContainText('Oferta nueva');
  await expect(page.locator('#customerStatement')).toContainText('2 canjes completados');
  await page.waitForTimeout(300);
  expect(state.cards).toBe(cardsBefore + 1);

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('an ended session found by the QR control signs out without showing raw JSON', async ({ page }) => {
  const state = await openWallet(page);
  const toasts = [];
  await page.exposeFunction('recordToast', text => toasts.push(text));
  await page.evaluate(() => new MutationObserver(() => window['recordToast'](document.querySelector('#toast')?.textContent || ''))
    .observe(document.querySelector('#toast'), { childList: true, characterData: true, subtree: true }));
  state.sessionEnded = true;
  await page.getByRole('button', { name: 'Generar QR', exact: true }).click();
  await page.waitForURL(/\/ingresar\/cafe\?motivo=sesion-vencida$/);
  expect(toasts.filter(text => /[{}]|AUTH_REQUIRED|request_id/.test(text))).toEqual([]);
});

test('the demo form explains short messages, rate limits and verification failures', async ({ page }) => {
  await page.route('https://challenges.cloudflare.com/**', route => route.fulfill({ body: '', contentType: 'application/javascript' }));
  await page.route('https://privatrack.com/**', route => route.fulfill({ body: '' }));
  const responses = [
    { status: 429, json: { error: 'Too many attempts. Try again in 900 seconds.', code: 'RATE_LIMITED' } },
    { status: 400, json: { error: 'Verificación fallida. Intenta de nuevo.', code: 'VERIFICATION_FAILED' } }
  ];
  let requests = 0;
  await page.route('**/api/public/contact', route => { requests += 1; return route.fulfill(responses.shift()); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${server.baseUrl}/?sw=off`);
  await expect(page.locator('#cfMessage')).toHaveAttribute('minlength', '10');
  await page.getByLabel('Nombre', { exact: true }).fill('Ana López');
  await page.getByLabel('Negocio', { exact: true }).fill('Café de prueba');
  await page.getByLabel('Correo o teléfono').fill('ana@example.com');
  await page.getByLabel('¿Qué quieres resolver?').fill('Hola');
  await page.locator('#contactForm').evaluate(form => {
    const token = document.createElement('input');
    token.type = 'hidden'; token.name = 'cf-turnstile-response'; token.value = 'test-verification-token';
    form.append(token);
  });
  await page.locator('#contactSubmit').click();
  await expect(page.locator('#contactStatus')).toContainText('al menos 10 caracteres');
  await expect(page.locator('#cfMessage')).toBeFocused();
  expect(requests).toBe(0);
  await page.getByLabel('¿Qué quieres resolver?').fill('Organizar el programa de lealtad.');
  await page.locator('#contactSubmit').click();
  await expect(page.locator('#contactStatus')).toHaveText('Recibimos varias solicitudes desde tu conexión. Espera unos minutos e inténtalo de nuevo.');
  await page.locator('#contactSubmit').click();
  await expect(page.locator('#contactStatus')).toHaveText('No pudimos confirmar la verificación. Complétala de nuevo y envía tu solicitud.');
  expect(requests).toBe(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('the theme toggle flips once per click after the system theme changes', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await openWallet(page);
  const theme = () => page.evaluate(() => document.documentElement.dataset.theme);
  expect(await theme()).toBe('light');
  for (const colorScheme of /** @type {const} */ (['dark', 'light', 'dark'])) await page.emulateMedia({ colorScheme });
  await expect.poll(theme).toBe('dark');
  const toggle = page.locator('#themeToggle');
  await expect(toggle).toHaveAttribute('aria-label', 'Cambiar a tema claro');
  await toggle.click();
  await expect.poll(theme).toBe('light');
  await expect(toggle).toHaveAttribute('aria-label', 'Cambiar a tema oscuro');
  await toggle.click();
  await expect.poll(theme).toBe('dark');
});
