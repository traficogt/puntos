const CACHE = "pwa-upgrade-v1";
const ASSETS = ["/pwa-test/index.html"];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS);
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
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
    event.respondWith(new Response("v1", {
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
