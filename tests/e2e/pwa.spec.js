import { test, expect } from "@playwright/test";

const baseUrl = process.env.PWA_BASE_URL || "http://127.0.0.1:3001";

function appUrl(pathname = "/") {
  return `${baseUrl}${pathname}${pathname.includes("?") ? "&" : "?"}sw=noreload`;
}

async function gotoStable(page, url, options) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto(url, options);
      return;
    } catch (error) {
      lastError = error;
      if (!/ERR_ABORTED/i.test(String(error?.message || error))) {
        throw error;
      }
      await page.waitForLoadState("domcontentloaded").catch(() => {});
    }
  }
  throw lastError;
}

async function waitForServiceWorker(page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await gotoStable(page, appUrl("/"), { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.waitForFunction(async () => {
      if (!("serviceWorker" in navigator)) return false;
      const registration = await navigator.serviceWorker.ready;
      return Boolean(registration?.active?.scriptURL);
    }, null, { timeout: 20_000 });

    const controllerUrl = await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL || "");
    if (/\/sw\.js$/.test(controllerUrl)) {
      return;
    }
  }
  throw new Error("Service worker activated but did not take control of the page");
}

test.describe("PWA coverage", () => {
  test("offline runtime caches keep customer and staff flows usable", async ({ page, context }) => {
    test.slow();

    await waitForServiceWorker(page);

    const details = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      return {
        controllerUrl: navigator.serviceWorker.controller?.scriptURL || "",
        scope: registration.scope,
        cacheKeys: await caches.keys()
      };
    });

    expect(details.controllerUrl).toMatch(/\/sw\.js$/);
    expect(details.scope.endsWith("/")).toBeTruthy();
    expect(details.cacheKeys.some((key) => /^pf-v\d+$/.test(key))).toBeTruthy();

    await page.evaluate(async () => {
      const { clearCustomerCache, putCustomerCache } = await import("/idb.js");
      await clearCustomerCache();
      await putCustomerCache("me", {
        business: { id: "biz-offline", name: "Offline Cafe", slug: "offline-cafe" },
        customer: {
          id: "cust-offline",
          name: "Cliente Offline",
          phone: "+50212345678",
          points: 88,
          pending_points: 5,
          lifetime_points: 240,
          last_visit_at: "2026-03-08T00:00:00.000Z"
        }
      });
      await putCustomerCache("rewards", {
        rewards: [
          { id: "rw1", name: "Cafe gratis", description: "Una bebida", points_cost: 60 }
        ]
      });
      await putCustomerCache("history", {
        transactions: [
          { created_at: "2026-03-08T00:00:00.000Z", points_delta: 20, amount_q: 50 }
        ],
        redemptions: []
      });
      await putCustomerCache("tier", {
        tier: {
          name: "Oro",
          tier_level: 3,
          points_multiplier: 1.4,
          current_points: 240,
          points_to_next_tier: 0,
          perks: ["Fila prioritaria"]
        }
      });
      await putCustomerCache("achievements", {
        earned: [],
        inProgress: [
          { name: "Tres visitas", current: 2, total: 3, progress: 66, icon_url: "🏆" }
        ]
      });
      await putCustomerCache("referralCode", {
        referral_code: { code: "AMIGOS24" }
      });
      await putCustomerCache("referralStats", {
        total_referrals: 2,
        completed_referrals: 1,
        pending_referrals: 1
      });
    });

    await context.setOffline(true);
    await gotoStable(page, appUrl("/c"), { waitUntil: "domcontentloaded", timeout: 20_000 });
    await expect.poll(async () => page.locator("#points").textContent(), { timeout: 20_000 }).toBe("88");
    await expect.poll(async () => page.locator("#syncBadge").textContent(), { timeout: 20_000 }).toMatch(/Guardado:/);

    await expect(page.locator("#main")).toBeVisible();
    await expect(page.locator("#needLogin")).toBeHidden();
    await expect(page.locator("#bizName")).toContainText("Offline Cafe");
    await expect(page.locator("#points")).toHaveText("88");
    await expect(page.locator("#syncBadge")).toContainText(/Guardado:/);
    await expect(page.locator("#netBadge")).toContainText(/Sin conexión/);

    await gotoStable(page, appUrl("/"), { waitUntil: "domcontentloaded", timeout: 20_000 });
    await expect(page).toHaveTitle(/PuntosFieles/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/lealtad que se ve premium/i);
    await expect(page.locator('a[href="/admin"]')).toBeVisible();

    await page.evaluate(async () => {
      localStorage.setItem("pf_staff_snapshot", JSON.stringify({
        staff: { id: "staff-offline", role: "OWNER", email: "owner@example.com" },
        permissions: ["staff.award", "staff.sync", "staff.redeem"],
        programRule: {
          program_type: "SPEND",
          program_json: { points_per_q: 0.1, round: "ceil" }
        },
        updatedAt: new Date().toISOString()
      }));

      const { clearAwards } = await import("/idb.js");
      await clearAwards();
    });

    await gotoStable(page, appUrl("/staff"), { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.fill("#token", "qr_offline_valid_token");
    await page.fill("#amount", "55");
    await page.click("#btnAward");
    await expect.poll(async () => page.locator("#queueBadge").textContent(), { timeout: 20_000 }).toMatch(/Cola:\s*1/);

    await page.reload({ waitUntil: "domcontentloaded", timeout: 20_000 });
    await expect.poll(async () => page.locator("#queueBadge").textContent(), { timeout: 20_000 }).toMatch(/Cola:\s*1/);
    await expect(page.locator("#queueMeta")).toContainText(/Pendientes:\s*1/);
    await expect(page.locator("#queueList")).toContainText(/queued|syncing|failed/i);

    await page.route("**/api/staff/me", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ staff: { id: "staff-offline", role: "OWNER", email: "owner@example.com" } })
      });
    });
    await page.route("**/api/staff/sync", async (route) => {
      const payload = JSON.parse(route.request().postData() || "{}");
      const awards = Array.isArray(payload?.awards) ? payload.awards : [];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          results: awards.map((award) => ({ txId: award.txId, ok: true, result: { ok: true } }))
        })
      });
    });

    await context.setOffline(false);
    await page.click("#btnSync");
    await expect.poll(async () => page.locator("#queueBadge").textContent(), { timeout: 20_000 }).toMatch(/Cola:\s*0/);
    await expect(page.locator("#queueMeta")).toContainText(/Pendientes:\s*0/);
    await expect(page.locator("#queueList")).toContainText(/\(sin operaciones pendientes\)/i);
  });

  test("service worker upgrades swap control and replace old caches", async ({ page }) => {
    test.slow();

    await gotoStable(page, `${baseUrl}/pwa-test/index.html`, { waitUntil: "domcontentloaded", timeout: 20_000 });

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

    expect(firstController).toMatch(/\/pwa-test\/sw-v1\.js$/);

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

    await expect.poll(async () => page.evaluate(() => caches.keys()), { timeout: 20_000 }).toEqual(
      expect.arrayContaining(["pwa-upgrade-v2"])
    );

    const upgraded = await page.evaluate(async () => ({
      controller: navigator.serviceWorker.controller?.scriptURL || "",
      version: await fetch("/pwa-test/version.txt").then((response) => response.text()),
      cacheKeys: await caches.keys()
    }));

    expect(upgraded.controller).toMatch(/\/pwa-test\/sw-v2\.js$/);
    expect(upgraded.version).toBe("v2");
    expect(upgraded.cacheKeys).toContain("pwa-upgrade-v2");
    expect(upgraded.cacheKeys).not.toContain("pwa-upgrade-v1");
  });
});
