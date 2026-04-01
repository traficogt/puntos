process.env.NODE_ENV = "test";

import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = process.env.PWA_BASE_URL || "http://localhost:3001";

async function withPage(fn) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await fn(page, context);
  } finally {
    await browser.close();
  }
}

async function waitForServiceWorker(page) {
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle", timeout: 20_000 });
  await page.waitForFunction(async () => {
    if (!("serviceWorker" in navigator)) return false;
    await navigator.serviceWorker.ready;
    return Boolean(navigator.serviceWorker.controller);
  }, null, { timeout: 20_000 });
}

test("pwa registers a controlling service worker and creates the versioned cache", async () => {
  await withPage(async (page) => {
    await waitForServiceWorker(page);

    const details = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      return {
        controllerUrl: navigator.serviceWorker.controller?.scriptURL || "",
        scope: registration.scope,
        cacheKeys: await caches.keys()
      };
    });

    assert.match(details.controllerUrl, /\/sw\.js$/);
    assert.ok(details.scope.endsWith("/"));
    assert.ok(details.cacheKeys.includes("pf-v25"));
  });
});

test("customer page renders from structured offline cache when the network is unavailable", async () => {
  await withPage(async (page, context) => {
    await waitForServiceWorker(page);

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
    await page.goto(`${baseUrl}/c`, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.waitForTimeout(1200);

    const state = await page.evaluate(() => ({
      mainHidden: document.querySelector("#main")?.hidden,
      needLoginHidden: document.querySelector("#needLogin")?.hidden,
      bizName: document.querySelector("#bizName")?.textContent || "",
      points: document.querySelector("#points")?.textContent || "",
      syncBadge: document.querySelector("#syncBadge")?.textContent || "",
      netBadge: document.querySelector("#netBadge")?.textContent || ""
    }));

    assert.equal(state.mainHidden, false);
    assert.equal(state.needLoginHidden, true);
    assert.match(state.bizName, /Offline Cafe/);
    assert.equal(state.points, "88");
    assert.match(state.syncBadge, /Guardado:/);
    assert.match(state.netBadge, /Sin conexión/);
  });
});

test("homepage shell remains available offline after the service worker warms the cache", async () => {
  await withPage(async (page, context) => {
    await waitForServiceWorker(page);
    await context.setOffline(true);
    await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded", timeout: 20_000 });

    const summary = await page.evaluate(() => ({
      title: document.title,
      heading: document.querySelector("h1")?.textContent || "",
      hasJoinLink: Boolean(document.querySelector('a[href="/admin"]'))
    }));

    assert.match(summary.title, /PuntosFieles/);
    assert.match(summary.heading, /experiencia de lealtad/i);
    assert.equal(summary.hasJoinLink, true);
  });
});

test("staff queue persists offline across reload and syncs successfully after reconnect", async () => {
  await withPage(async (page, context) => {
    await waitForServiceWorker(page);

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

    await context.setOffline(true);
    await page.goto(`${baseUrl}/staff`, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.fill("#token", "qr_offline_valid_token");
    await page.fill("#amount", "55");
    await page.click("#btnAward");
    await page.waitForFunction(() => {
      const badge = document.querySelector("#queueBadge");
      return Boolean(badge && /Cola:\s*1/.test(badge.textContent || ""));
    }, null, { timeout: 20_000 });

    await page.reload({ waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.waitForFunction(() => {
      const badge = document.querySelector("#queueBadge");
      return Boolean(badge && /Cola:\s*1/.test(badge.textContent || ""));
    }, null, { timeout: 20_000 });

    const offlineState = await page.evaluate(() => ({
      queueBadge: document.querySelector("#queueBadge")?.textContent || "",
      queueMeta: document.querySelector("#queueMeta")?.textContent || "",
      queueList: document.querySelector("#queueList")?.textContent || ""
    }));

    assert.match(offlineState.queueBadge, /Cola:\s*1/);
    assert.match(offlineState.queueMeta, /Pendientes:\s*1/);
    assert.match(offlineState.queueList, /queued|syncing|failed/i);

    await context.setOffline(false);
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
    await page.click("#btnSync");
    await page.waitForFunction(() => {
      const badge = document.querySelector("#queueBadge");
      return Boolean(badge && /Cola:\s*0/.test(badge.textContent || ""));
    }, null, { timeout: 20_000 });

    const onlineState = await page.evaluate(() => ({
      queueBadge: document.querySelector("#queueBadge")?.textContent || "",
      queueMeta: document.querySelector("#queueMeta")?.textContent || "",
      queueList: document.querySelector("#queueList")?.textContent || ""
    }));

    assert.match(onlineState.queueBadge, /Cola:\s*0/);
    assert.match(onlineState.queueMeta, /Pendientes:\s*0/);
    assert.match(onlineState.queueList, /\(sin operaciones pendientes\)/i);
  });
});
