const CACHE = "pwa-upgrade-v2";
const ASSETS = ["/pwa-test/index.html"];

async function purgeOldCaches() {
  const keys = await caches.keys();
  await Promise.all(keys
    .filter((key) => key.startsWith("pwa-upgrade-") && key !== CACHE)
    .map((key) => caches.delete(key)));
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS);
    await purgeOldCaches();
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    await purgeOldCaches();
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === "/pwa-test/version.txt") {
    event.respondWith(new Response("v2", {
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    }));
    return;
  }
  event.respondWith(fetch(event.request).catch(async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(event.request);
    if (cached) return cached;
    throw new Error(`Missing cached fixture asset: ${event.request.url}`);
  }));
});
