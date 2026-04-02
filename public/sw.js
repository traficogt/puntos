const CACHE = "pf-v32";
const CORE_ASSETS = [
  "/",
  "/admin",
  "/staff/login",
  "/staff",
  "/c",
  "/super",
  "/index.html",
  "/admin.html",
  "/staff-login.html",
  "/staff.html",
  "/join.html",
  "/customer.html",
  "/admin-dashboard.html",
  "/super.html",
  "/styles.css",
  "/styles/base.css",
  "/styles/components.css",
  "/styles/pages.css",
  "/styles/admin-panels.css",
  "/styles/analytics-visuals.css",
  "/styles/responsive.css",
  "/lib.js",
  "/idb.js",
  "/manifest.webmanifest",
  "/icon.svg",
  "/favicon-16.png",
  "/favicon-32.png",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
  "/index.js",
  "/admin.js",
  "/staff-login.js",
  "/staff.js",
  "/join.js",
  "/customer.js",
  "/admin-dashboard.js",
  "/super.js",
  "/customer/format.js",
  "/customer/index.js",
  "/customer/load.js",
  "/customer/me.js",
  "/customer/network.js",
  "/customer/qr.js",
  "/customer/render.js",
  "/staff/index.js",
  "/super/index.js",
  "/admin-dashboard/index.js",
  "/admin-dashboard/core.js",
  "/admin-dashboard/layout.js",
  "/admin-dashboard/session-controller.js",
  "/admin-dashboard/tab-controller.js",
  "/admin-dashboard/view-state.js",
  "/admin-dashboard/branch-filter.js",
  "/admin-dashboard/modules/branches.js",
  "/admin-dashboard/modules/analytics.js",
  "/admin-dashboard/modules/gamification.js",
  "/admin-dashboard/modules/giftcards.js",
  "/admin-dashboard/modules/ops.js",
  "/admin-dashboard/modules/program.js",
  "/admin-dashboard/modules/program-actions.js",
  "/admin-dashboard/modules/program-form.js",
  "/admin-dashboard/modules/program-listeners.js",
  "/admin-dashboard/modules/referrals.js",
  "/admin-dashboard/modules/rewards.js",
  "/admin-dashboard/modules/staff.js",
  "/admin-dashboard/modules/tiers.js",
  "/admin-dashboard/modules/analytics/audit.js",
  "/admin-dashboard/modules/analytics/cohorts.js",
  "/admin-dashboard/modules/analytics/dashboard.js",
  "/admin-dashboard/modules/analytics/operations.js",
  "/admin-dashboard/modules/analytics/render.js",
  "/admin-dashboard/fragments/achievements.html",
  "/admin-dashboard/fragments/analytics.html",
  "/admin-dashboard/fragments/branches.html",
  "/admin-dashboard/fragments/challenges.html",
  "/admin-dashboard/fragments/giftcards.html",
  "/admin-dashboard/fragments/operations.html",
  "/admin-dashboard/fragments/program.html",
  "/admin-dashboard/fragments/referrals.html",
  "/admin-dashboard/fragments/rewards.html",
  "/admin-dashboard/fragments/staff.html",
  "/admin-dashboard/fragments/tiers.html"
];
const NETWORK_FIRST_DESTINATIONS = new Set(["document", "script", "style", "worker", "font"]);
const NAVIGATION_FALLBACKS = new Map([
  ["/", "/index.html"],
  ["/admin", "/admin.html"],
  ["/staff/login", "/staff-login.html"],
  ["/staff", "/staff.html"],
  ["/c", "/customer.html"],
  ["/super", "/super.html"]
]);

function isCacheable(response) {
  return response.ok && (response.type === "basic" || response.type === "default");
}

async function openCache() {
  return caches.open(CACHE);
}

async function precacheAsset(cache, asset) {
  const request = new Request(asset, { cache: "reload" });
  const response = await fetch(request);
  if (isCacheable(response)) {
    await cache.put(asset, response.clone());
  }
}

async function networkFirst(request, fallbackPath = "") {
  const cache = await openCache();

  try {
    const response = await fetch(request);
    if (isCacheable(response)) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (fallbackPath) {
      const fallback = await cache.match(fallbackPath);
      if (fallback) return fallback;
    }
    throw new Error(`Offline and no cached asset for ${request.url}`);
  }
}

function fallbackForPath(pathname) {
  const normalizedPath = pathname.length > 1 && pathname.endsWith("/")
    ? pathname.slice(0, -1)
    : pathname;

  if (NAVIGATION_FALLBACKS.has(normalizedPath)) {
    return NAVIGATION_FALLBACKS.get(normalizedPath) || "";
  }
  if (/^\/join\/[^/]+$/i.test(normalizedPath)) {
    return "/join.html";
  }
  return "";
}

async function staleWhileRevalidate(request) {
  const cache = await openCache();
  const cached = await cache.match(request);

  const networkPromise = fetch(request)
    .then(async (response) => {
      if (isCacheable(response)) {
        await cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  return cached || networkPromise || fetch(request);
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await openCache();
    await Promise.all(CORE_ASSETS.map((asset) => precacheAsset(cache, asset).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  const isNetworkFirst = event.request.mode === "navigate"
    || NETWORK_FIRST_DESTINATIONS.has(event.request.destination)
    || /\.(?:js|css|html)$/i.test(url.pathname);

  if (isNetworkFirst) {
    event.respondWith(
      networkFirst(event.request, event.request.mode === "navigate" ? fallbackForPath(url.pathname) : "")
    );
    return;
  }

  event.respondWith(staleWhileRevalidate(event.request));
});
