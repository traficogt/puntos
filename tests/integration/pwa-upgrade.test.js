process.env.NODE_ENV = "test";

import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = process.env.PWA_BASE_URL || "http://localhost:3001";

test("service worker upgrades swap control and remove old caches", async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(`${baseUrl}/pwa-test/index.html`, { waitUntil: "domcontentloaded", timeout: 20_000 });

    await page.evaluate(async () => {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations
        .filter((registration) => registration.scope.endsWith("/pwa-test/"))
        .map((registration) => registration.unregister()));
      const keys = await caches.keys();
      await Promise.all(keys
        .filter((key) => key.startsWith("pwa-upgrade-"))
        .map((key) => caches.delete(key)));
    });

    await page.reload({ waitUntil: "domcontentloaded", timeout: 20_000 });

    const firstController = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.register("/pwa-test/sw-v1.js", {
        scope: "/pwa-test/",
        updateViaCache: "none"
      });
      if (registration.waiting) {
        registration.waiting.postMessage({ type: "SKIP_WAITING" });
      }
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise((resolve) => {
          navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true });
        });
      }
      return navigator.serviceWorker.controller?.scriptURL || "";
    });

    assert.match(firstController, /\/pwa-test\/sw-v1\.js$/);

    await page.evaluate(async () => {
      const changed = new Promise((resolve) => {
        navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true });
      });

      const registration = await navigator.serviceWorker.register("/pwa-test/sw-v2.js", {
        scope: "/pwa-test/",
        updateViaCache: "none"
      });
      await registration.update();

      if (registration.waiting) {
        registration.waiting.postMessage({ type: "SKIP_WAITING" });
      }

      await changed;
      await navigator.serviceWorker.ready;
    });

    await page.waitForFunction(async () => {
      const keys = await caches.keys();
      return keys.includes("pwa-upgrade-v2") && !keys.includes("pwa-upgrade-v1");
    }, null, { timeout: 20_000 });

    const upgraded = await page.evaluate(async () => ({
      controller: navigator.serviceWorker.controller?.scriptURL || "",
      version: await fetch("/pwa-test/version.txt").then((response) => response.text()),
      cacheKeys: await caches.keys()
    }));

    assert.match(upgraded.controller, /\/pwa-test\/sw-v2\.js$/);
    assert.equal(upgraded.version, "v2");
    assert.ok(upgraded.cacheKeys.includes("pwa-upgrade-v2"));
    assert.ok(!upgraded.cacheKeys.includes("pwa-upgrade-v1"));
  } finally {
    await browser.close();
  }
});
