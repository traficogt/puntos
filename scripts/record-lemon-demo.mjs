#!/usr/bin/env node

import { copyFile, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const outputDir = path.join(projectRoot, "artifacts", "lemon-squeezy-demo");
const appOrigin = process.env.DEMO_APP_ORIGIN || "http://app.localhost:3001";
const marketingOrigin = process.env.DEMO_MARKETING_ORIGIN || "http://localhost:3001";

const legacyOutputFilename = "puntosfieles-demo-captioned-en.webm";

const reviewProfiles = {
  short60: {
    filename: "puntosfieles-demo-60s-captioned-en.webm",
    targetSeconds: 60,
    scenes: {
      landing: {
        caption: "This is the public landing page for the loyalty platform.",
        budgetMs: 8000,
        settleMs: 1200,
        scrollDownMs: 1200,
        scrollUpMs: 900,
        endPauseMs: 1600
      },
      wallet: {
        caption: "This is the customer wallet, where members review points, rewards, and their QR code.",
        budgetMs: 18500,
        introMs: 1800,
        qrMs: 2400,
        rewardsDownMs: 3200,
        rewardsUpMs: 1800,
        endPauseMs: 2600
      },
      staff: {
        caption: "This is the staff console for identifying a customer and recording loyalty activity.",
        budgetMs: 15300,
        introMs: 1200,
        tokenEntryMs: 300,
        afterSelectMs: 1800,
        afterRegisterMs: 2000
      },
      walletRefresh: {
        caption: "After staff records activity, the customer can refresh the wallet and see the updated balance.",
        budgetMs: 9500,
        introMs: 1500,
        afterRefreshMs: 1800,
        scrollDownMs: 1500,
        endPauseMs: 1700
      },
      dashboard: {
        caption: "This is the owner dashboard for monitoring growth, retention, and reward performance.",
        budgetMs: 5500,
        introMs: 1100,
        scrollMs: 900,
        endPauseMs: 1200
      }
    }
  },
  review90: {
    filename: "puntosfieles-demo-90s-captioned-en.webm",
    targetSeconds: 90,
    scenes: {
      landing: {
        caption: "This is the public landing page for the loyalty platform.",
        budgetMs: 12000,
        settleMs: 1600,
        scrollDownMs: 1800,
        scrollUpMs: 1200,
        endPauseMs: 2400
      },
      wallet: {
        caption: "This is the customer wallet, where members review points, rewards, and their QR code.",
        budgetMs: 30200,
        introMs: 2200,
        qrMs: 3200,
        rewardsDownMs: 5800,
        rewardsUpMs: 2800,
        endPauseMs: 3600
      },
      staff: {
        caption: "This is the staff console for identifying a customer and recording loyalty activity.",
        budgetMs: 23400,
        introMs: 1400,
        tokenEntryMs: 400,
        afterSelectMs: 2800,
        afterRegisterMs: 2600
      },
      walletRefresh: {
        caption: "After staff records activity, the customer can refresh the wallet and see the updated balance.",
        budgetMs: 13600,
        introMs: 1800,
        afterRefreshMs: 2600,
        scrollDownMs: 2600,
        endPauseMs: 2400
      },
      dashboard: {
        caption: "This is the owner dashboard for monitoring growth, retention, and reward performance.",
        budgetMs: 7700,
        introMs: 1400,
        scrollMs: 1100,
        endPauseMs: 1600
      }
    }
  }
};

function resolveProfile(argv) {
  const index = argv.indexOf("--profile");
  if (index === -1) return "review90";
  const profile = String(argv[index + 1] || "").trim();
  if (!profile || profile.startsWith("--")) {
    throw new Error("Missing value for --profile. Use short60 or review90.");
  }
  if (!Object.prototype.hasOwnProperty.call(reviewProfiles, profile)) {
    throw new Error("Invalid --profile. Use short60 or review90.");
  }
  return profile;
}

function profileConfig(profile) {
  return reviewProfiles[profile];
}

function validateProfile(profile) {
  if (!Number.isFinite(profile.targetSeconds) || profile.targetSeconds <= 0) {
    throw new Error("Invalid profile targetSeconds");
  }
  for (const [sceneName, scene] of Object.entries(profile.scenes)) {
    if (typeof scene.caption !== "string" || !scene.caption.trim()) {
      throw new Error(`Invalid caption for scene ${sceneName}`);
    }
    for (const [key, value] of Object.entries(scene)) {
      if (key === "caption") continue;
      if (key.endsWith("Ms") && (!Number.isFinite(value) || value < 0)) {
        throw new Error(`Invalid timing value for ${sceneName}.${key}`);
      }
    }
  }
}

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

async function runBudgetedScene(page, scene, callback) {
  const startedAt = performance.now();
  await setCaption(page, scene.caption);
  await callback();
  const elapsedMs = performance.now() - startedAt;
  const remainingMs = scene.budgetMs - elapsedMs;
  if (remainingMs > 0) {
    await page.waitForTimeout(Math.ceil(remainingMs));
  }
}

async function main() {
  await mkdir(outputDir, { recursive: true });
  const profileName = resolveProfile(process.argv.slice(2));
  const profile = profileConfig(profileName);
  validateProfile(profile);

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
    await runBudgetedScene(page, profile.scenes.landing, async () => {
      await page.waitForTimeout(profile.scenes.landing.settleMs);
      await page.mouse.wheel(0, 640);
      await page.waitForTimeout(profile.scenes.landing.scrollDownMs);
      await page.mouse.wheel(0, -220);
      await page.waitForTimeout(profile.scenes.landing.scrollUpMs);
      await page.waitForTimeout(profile.scenes.landing.endPauseMs);
    });

    await page.goto(customerLink.url, { waitUntil: "domcontentloaded" });
    await waitForCustomerWallet(page);
    await runBudgetedScene(page, profile.scenes.wallet, async () => {
      await page.waitForTimeout(profile.scenes.wallet.introMs);
      await page.getByRole("button", { name: "Generar QR" }).click();
      await page.waitForTimeout(profile.scenes.wallet.qrMs);
      await page.mouse.wheel(0, 620);
      await page.waitForTimeout(profile.scenes.wallet.rewardsDownMs);
      await page.mouse.wheel(0, -620);
      await page.waitForTimeout(profile.scenes.wallet.rewardsUpMs);
      await page.waitForTimeout(profile.scenes.wallet.endPauseMs);
    });

    await page.goto(staffLink.url, { waitUntil: "domcontentloaded" });
    await runBudgetedScene(page, profile.scenes.staff, async () => {
      await page.waitForSelector("#staffActionRail");
      await page.waitForTimeout(profile.scenes.staff.introMs);
      await page.locator("#token").fill(qr.token);
      await page.waitForTimeout(profile.scenes.staff.tokenEntryMs);
      await page.getByRole("button", { name: "Seleccionar cliente" }).nth(1).click();
      await page.waitForFunction(() => {
        const chip = document.querySelector("#customerReadyChip");
        return chip && /Cliente listo/i.test(chip.textContent || "");
      });
      await page.waitForTimeout(profile.scenes.staff.afterSelectMs);

      const amount = page.locator("#amount");
      if (await amount.isEnabled()) {
        await amount.fill("100");
      }
      await page.getByRole("button", { name: "Registrar" }).click();
      await page.waitForTimeout(profile.scenes.staff.afterRegisterMs);
    });

    await page.goto(`${appOrigin}/c`, { waitUntil: "domcontentloaded" });
    await waitForCustomerWallet(page);
    await runBudgetedScene(page, profile.scenes.walletRefresh, async () => {
      await page.waitForTimeout(profile.scenes.walletRefresh.introMs);
      await page.getByRole("button", { name: "Actualizar tarjeta" }).click();
      await page.waitForTimeout(profile.scenes.walletRefresh.afterRefreshMs);
      await page.mouse.wheel(0, 460);
      await page.waitForTimeout(profile.scenes.walletRefresh.scrollDownMs);
      await page.waitForTimeout(profile.scenes.walletRefresh.endPauseMs);
    });

    await page.goto(ownerLink.url, { waitUntil: "domcontentloaded" });
    await runBudgetedScene(page, profile.scenes.dashboard, async () => {
      await page.waitForSelector("#adminGrowthSummary");
      await page.waitForTimeout(profile.scenes.dashboard.introMs);
      await page.mouse.wheel(0, 260);
      await page.waitForTimeout(profile.scenes.dashboard.scrollMs);
      await page.waitForTimeout(profile.scenes.dashboard.endPauseMs);
    });
  } finally {
    const video = page.video();
    await context.close();
    await browser.close();
    if (video) {
      const savedPath = await video.path();
      const finalPath = path.join(outputDir, profile.filename);
      await rename(savedPath, finalPath).catch(() => {});
      if (finalPath !== path.join(outputDir, legacyOutputFilename)) {
        await copyFile(finalPath, path.join(outputDir, legacyOutputFilename)).catch(() => {});
      }
      console.log(`video_path: ${finalPath}`);
      console.log(`profile: ${profileName}`);
      console.log(`business: ${entities.businessName}`);
      console.log(`customer_phone: ${entities.customerPhone}`);
    }
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
