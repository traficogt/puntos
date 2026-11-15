import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { test, expect } from '@playwright/test';
import { apiGet, expectOk } from './lib.js';

// Browser-engine checks only: no Wallet issuance, native app or device claims.
test.beforeEach(async ({ context, baseURL }, testInfo) => {
  expect(process.env.E2E_WEBKIT_ISOLATED, 'Use the isolated WebKit runner').toBe('1');
  const origin = new URL(baseURL).origin;
  expect(new URL(origin).hostname).toBe('127.0.0.1');
  const client = (testInfo.titlePath.includes('mobile') ? 3 : 1)
    + (testInfo.title.startsWith('phone correction') ? 1 : 0);
  await context.setExtraHTTPHeaders({ 'x-forwarded-for': `10.224.0.${client}` });
  await context.route('**/*', route => new URL(route.request().url()).origin === origin
    ? route.continue() : route.abort());
});

async function business(page, context) {
  const suffix = randomUUID();
  const name = `Café WebKit ${suffix.slice(0, 8)}`;
  const response = await page.request.post('/api/admin/signup', {
    data: { businessName: name, email: `webkit-${suffix}@example.com`,
      password: 'OrchardLanternMarble2026!', program_type: 'SPEND' }
  });
  expect(response.ok(), `Synthetic business signup: ${response.status()}`).toBe(true);
  const body = await response.json();
  expect(body.business.slug).toBeTruthy();
  await context.clearCookies();
  return { slug: body.business.slug, name };
}

async function requestCode(page, slug, phone, mode = 'join') {
  await page.locator('#phone').fill(phone);
  if (mode === 'join') await page.locator('#name').fill('Cliente WebKit');
  const response = page.waitForResponse(resp => resp.request().method() === 'POST'
    && new URL(resp.url()).pathname === `/api/public/business/${slug}/${mode}/request-code`);
  await page.locator('#btnCode').click();
  const received = await response;
  const body = await received.json();
  expect(received.ok(), `OTP request: ${received.status()} ${body.error || ''}`).toBe(true);
  const { dev_code: code } = body;
  expect(String(code), 'Development provider must supply the fixture OTP').toMatch(/^\d{6}$/);
  await expect(page.locator('#joinVerifyStage')).toBeVisible();
  await expect(page.locator('#code')).toBeFocused();
  return String(code);
}

async function verifyCode(page, slug, code, mode = 'join') {
  await page.locator('#code').fill(code);
  const response = page.waitForResponse(resp => resp.request().method() === 'POST'
    && new URL(resp.url()).pathname === `/api/public/business/${slug}/${mode}/verify`);
  // Exercise native form submission in WebKit, including mobile-size layouts.
  await page.locator('#code').press('Enter');
  expect((await response).ok()).toBe(true);
  await expect(page.locator('#done')).toBeVisible();
  await expect(page.locator('#doneTitle')).toBeFocused();
  await expect(page.locator('#walletEnrollmentFeedback')).toContainText('navegador');
  await expect(page.locator('#btnAppleWallet')).toBeHidden();
  await expect(page.locator('#btnGoogleWallet')).toBeHidden();
}

async function openCard(page, name) {
  await page.getByRole('link', { name: 'Ver mi tarjeta y mis puntos', exact: true }).click();
  await page.waitForURL(/\/mi-tarjeta\/$/);
  await expect(page.locator('#main')).toBeVisible();
  await expect(page.locator('#bizName')).toHaveText(`Tus puntos en ${name}`);
  await expect(page.locator('#who')).toContainText('Cliente WebKit');
  await expect(page.locator('#points')).toHaveText('0');
  const me = await apiGet(page, '/api/customer/me');
  expectOk(me);
  return me.body.customer.id;
}

async function expectNoOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

for (const [label, width] of [['desktop', 1440], ['mobile', 390]]) {
  test.describe(String(label), () => {
    test.use({ viewport: { width: Number(width), height: 900 } });

    test('enrollment, QR, reload and returning access preserve the customer card', async ({ page, context }) => {
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const fixture = await business(page, context);
      const phone = label === 'mobile' ? '55551234' : '55551334';
      await page.goto(`/join/${fixture.slug}`);
      const code = await requestCode(page, fixture.slug, phone);
      const firstCodeReceivedAt = Date.now();
      await verifyCode(page, fixture.slug, code);
      await expectNoOverflow(page);
      const customerId = await openCard(page, fixture.name);
      const qr = page.waitForResponse(resp => new URL(resp.url()).pathname === '/api/public/customer/qr.svg');
      await page.getByRole('button', { name: 'Generar QR', exact: true }).click();
      expect((await qr).ok()).toBe(true);
      await expect(page.locator('#qrWrap svg')).toBeVisible();
      await expect(page.locator('#qrExp')).not.toHaveText('QR: —');
      await expectNoOverflow(page);
      await page.reload();
      await expect(page.locator('#bizName')).toHaveText(`Tus puntos en ${fixture.name}`);
      expect((await apiGet(page, '/api/customer/me')).body.customer.id).toBe(customerId);

      await page.getByRole('button', { name: 'Salir', exact: true }).click();
      await page.waitForURL(new RegExp(`/ingresar/${fixture.slug}\\?motivo=salida$`));
      await expect(page.locator('#joinRequestForm')).toBeVisible();
      // Respect the real server's 60-second resend cooldown, including consumed
      // codes. Do not change authentication limits or retry requests to pass.
      await delay(Math.max(0, firstCodeReceivedAt + 61_000 - Date.now()));
      const returningCode = await requestCode(page, fixture.slug, phone, 'login');
      await verifyCode(page, fixture.slug, returningCode, 'login');
      expect(await openCard(page, fixture.name)).toBe(customerId);
      expect(errors).toEqual([]);
    });

    test('phone correction and invalid OTP keep enrollment recoverable', async ({ page, context }) => {
      const fixture = await business(page, context);
      await page.goto(`/join/${fixture.slug}`);
      await requestCode(page, fixture.slug, label === 'mobile' ? '55551235' : '55551335');
      await page.getByRole('button', { name: 'Cambiar teléfono', exact: true }).click();
      await expect(page.locator('#phone')).toBeFocused();
      await expect(page.locator('#joinVerifyStage')).toBeHidden();
      const code = await requestCode(page, fixture.slug, label === 'mobile' ? '55551236' : '55551336');
      await page.locator('#code').fill(code === '000000' ? '111111' : '000000');
      const invalid = page.waitForResponse(resp => resp.request().method() === 'POST'
        && new URL(resp.url()).pathname === `/api/public/business/${fixture.slug}/join/verify`);
      await page.locator('#btnVerify').click();
      expect((await invalid).ok()).toBe(false);
      await expect(page.locator('#joinVerifyFeedback')).not.toHaveText('Verificando código...');
      await expect(page.locator('#joinVerifyFeedback')).not.toBeEmpty();
      await expect(page.locator('#done')).toBeHidden();
      await expect(page.locator('#btnVerify')).toBeEnabled();
      await verifyCode(page, fixture.slug, code);
      await openCard(page, fixture.name);
      await expectNoOverflow(page);
    });
  });
}
