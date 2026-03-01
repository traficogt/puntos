const CACHE = "pf-v23";
const ASSETS = [
  "/", "/index.html", "/admin.html", "/staff-login.html", "/staff.html", "/join.html", "/customer.html", "/super.html",
  "/styles.css", "/lib.js", "/idb.js", "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png",
  "/index.js", "/admin.js", "/staff-login.js", "/staff.js", "/join.js", "/customer.js", "/super.js", "/admin-dashboard.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Don't cache API
  if (url.pathname.startsWith("/api/")) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(url.pathname).then((r) => r || caches.match("/index.html")))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).then((resp) => {
      const copy = resp.clone();
      caches.open(CACHE).then((c) => c.put(event.request, copy));
      return resp;
    }))
  );
});
