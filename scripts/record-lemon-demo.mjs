#!/usr/bin/env node

import { mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const outputDir = path.join(projectRoot, "artifacts", "lemon-squeezy-demo");
const appOrigin = process.env.DEMO_APP_ORIGIN || "http://app.localhost:3001";
const marketingOrigin = process.env.DEMO_MARKETING_ORIGIN || "http://localhost:3001";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    ...options
  });
  if (result.status !== 0) {
    const stderr = String(result.stderr || "").trim();
    const stdout = String(result.stdout || "").trim();
    throw new Error(stderr || stdout || `${command} ${args.join(" ")} failed`);
  }
  return String(result.stdout || "").trim();
}

function parseMagicLinkOutput(text) {
  const lines = String(text || "").split("\n");
  const out = {};
  for (const line of lines) {
    const [rawKey, ...rest] = line.split(":");
    if (!rawKey || !rest.length) continue;
    out[rawKey.trim()] = rest.join(":").trim();
  }
  return out;
}

function runApiNode(code, containerEnv = {}) {
  const envArgs = Object.entries(containerEnv).flatMap(([key, value]) => ["-e", `${key}=${value}`]);
  const stdout = run("docker", [
    "compose",
    "exec",
    "-T",
    ...envArgs,
    "api",
    "node",
    "--input-type=module",
    "-e",
    code
  ]);
  return JSON.parse(stdout);
}

function createMagicLink(args) {
  const stdout = run("docker", [
    "compose",
    "exec",
    "-T",
    "-e",
    `APP_ORIGIN=${appOrigin}`,
    "api",
    "node",
    "src/scripts/create-magic-link.mjs",
    ...args
  ]);
  return parseMagicLinkOutput(stdout);
}

function resolveDemoEntities() {
  return runApiNode(`
    import { withDbClientContext, closeDatabase } from './src/app/database.js';
    import { BusinessRepo } from './src/app/repositories/business-repository.js';
    import { CustomerRepo } from './src/app/repositories/customer-repository.js';

    const preferredPhones = ['50255555555', '55555555'];

    const out = await withDbClientContext({ platformAdmin: true, tenantId: null }, async () => {
      const business = await BusinessRepo.getBySlug('test-cafe');
      if (!business) throw new Error('business_not_found');

      let customer = null;
      for (const phone of preferredPhones) {
        customer = await CustomerRepo.getByBusinessAndPhone(business.id, phone);
        if (customer) break;
      }
      if (!customer) {
        const rows = await CustomerRepo.listByBusiness(business.id, 20);
        customer = rows[rows.length - 1] || rows[0] || null;
      }
      if (!customer) throw new Error('customer_not_found');

      return {
        businessId: business.id,
        businessName: business.name,
        customerId: customer.id,
        customerPhone: customer.phone,
        customerName: customer.name || 'Cliente'
      };
    });

    console.log(JSON.stringify(out));
    await closeDatabase();
  `);
}

function issueCustomerQrToken({ businessId, customerId }) {
  return runApiNode(`
    import { withDbClientContext, closeDatabase } from './src/app/database.js';
    import { issueCustomerQr } from './src/app/services/customer-service.js';

    const out = await withDbClientContext({ platformAdmin: true, tenantId: null }, async () => {
      return issueCustomerQr({ businessId: '${businessId}', customerId: '${customerId}' });
    });

    console.log(JSON.stringify(out));
    await closeDatabase();
  `);
}

async function slowFill(locator, value, delay = 18) {
  await locator.click();
  await locator.fill("");
  await locator.pressSequentially(value, { delay });
}

async function setCaption(page, text) {
  await page.evaluate((captionText) => {
    const existing = document.getElementById("pfDemoCaption");
    if (existing) existing.remove();

    const box = document.createElement("div");
    box.id = "pfDemoCaption";
    box.textContent = captionText;
    Object.assign(box.style, {
      position: "fixed",
      left: "32px",
      right: "32px",
      bottom: "24px",
      zIndex: "999999",
      padding: "14px 18px",
      background: "rgba(5, 10, 18, 0.86)",
      color: "#f8f6ef",
      border: "1px solid rgba(255,255,255,0.14)",
      borderRadius: "16px",
      fontFamily: "Inter, sans-serif",
      fontSize: "22px",
      fontWeight: "600",
      lineHeight: "1.35",
      boxShadow: "0 18px 60px rgba(0,0,0,0.35)",
      backdropFilter: "blur(10px)"
    });
    document.body.appendChild(box);
  }, text);
}

async function waitForCustomerWallet(page) {
  await page.waitForURL(/\/c(?:$|\?)/, { timeout: 20000 }).catch(() => {});
  await page.waitForFunction(() => {
    const main = document.querySelector("#main");
    return Boolean(main && !main.classList.contains("is-hidden"));
  }, null, { timeout: 30000 });
}

async function main() {
  await mkdir(outputDir, { recursive: true });

  const entities = resolveDemoEntities();
  const customerLink = createMagicLink([
    "--actor",
    "customer",
    "--customer-id",
    entities.customerId,
    "--target",
    "customer-wallet"
  ]);
  const staffLink = createMagicLink([
    "--actor",
    "staff",
    "--email",
    "staff@test.com",
    "--target",
    "staff"
  ]);
  const ownerLink = createMagicLink([
    "--actor",
    "staff",
    "--email",
    "owner@test.com",
    "--target",
    "admin-dashboard"
  ]);
  const qr = issueCustomerQrToken({ businessId: entities.businessId, customerId: entities.customerId });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: "dark",
    recordVideo: {
      dir: outputDir,
      size: { width: 1440, height: 900 }
    }
  });
  const page = await context.newPage();

  await context.route("https://privatrack.com/**", (route) => route.abort()).catch(() => {});

  try {
    await page.goto(marketingOrigin, { waitUntil: "domcontentloaded" });
    await setCaption(page, "PuntosFieles helps businesses turn loyalty activity into repeat visits, rewards, and measurable growth.");
    await page.waitForTimeout(2500);
    await page.mouse.wheel(0, 640);
    await page.waitForTimeout(1400);
    await page.mouse.wheel(0, -220);
    await page.waitForTimeout(1500);

    await page.goto(customerLink.url, { waitUntil: "domcontentloaded" });
    await waitForCustomerWallet(page);
    await setCaption(page, "Returning customers can reopen the wallet instantly and see their current balance, available rewards, and live QR.");
    await page.waitForTimeout(2000);
    await page.getByRole("button", { name: "Generar QR" }).click();
    await page.waitForTimeout(2600);
    await page.mouse.wheel(0, 620);
    await page.waitForTimeout(1800);
    await page.mouse.wheel(0, -620);
    await page.waitForTimeout(1200);

    await page.goto(staffLink.url, { waitUntil: "domcontentloaded" });
    await setCaption(page, "Staff use the same app to identify the customer, then register visits, purchases, or reward redemptions.");
    await page.waitForSelector("#staffActionRail");
    await page.waitForTimeout(2000);
    await slowFill(page.locator("#token"), qr.token);
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: "Seleccionar cliente" }).nth(1).click();
    await page.waitForFunction(() => {
      const chip = document.querySelector("#customerReadyChip");
      return chip && /Cliente listo/i.test(chip.textContent || "");
    });
    await page.waitForTimeout(1800);

    const amount = page.locator("#amount");
    if (await amount.isEnabled()) {
      await amount.fill("100");
    }
    await page.getByRole("button", { name: "Registrar" }).click();
    await page.waitForTimeout(2600);

    await page.goto(`${appOrigin}/c`, { waitUntil: "domcontentloaded" });
    await waitForCustomerWallet(page);
    await setCaption(page, "Once activity is recorded, the customer can refresh the wallet and immediately see the updated balance and reward status.");
    await page.waitForTimeout(1800);
    await page.getByRole("button", { name: "Actualizar tarjeta" }).click();
    await page.waitForTimeout(2800);
    await page.mouse.wheel(0, 460);
    await page.waitForTimeout(2200);

    await page.goto(ownerLink.url, { waitUntil: "domcontentloaded" });
    await setCaption(page, "Business owners log in to a growth dashboard that summarizes loyalty performance, retention, revenue impact, and next actions.");
    await page.waitForSelector("#adminGrowthSummary");
    await page.waitForTimeout(2200);
    await page.mouse.wheel(0, 260);
    await page.waitForTimeout(2200);
  } finally {
    const video = page.video();
    await context.close();
    await browser.close();
    if (video) {
      const savedPath = await video.path();
      const finalPath = path.join(outputDir, "puntosfieles-demo-captioned-en.webm");
      await rename(savedPath, finalPath).catch(() => {});
      console.log(`video_path: ${finalPath}`);
      console.log(`business: ${entities.businessName}`);
      console.log(`customer_phone: ${entities.customerPhone}`);
    }
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
