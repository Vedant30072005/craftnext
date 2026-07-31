/* CraftNext service worker — app-shell cache.
   Static shell: cache-first (fast repeat loads, offline shell).
   Everything else (API, images): network-first with cache fallback,
   so data stays fresh but the site still opens offline. */

const CACHE = "craftnext-v2";

const SHELL = [
  "index.html",
  "Collection.html",
  "404.html",
  "style.css?v=5",
  "script.js?v=5",
  "api.js?v=5",
  "theme.js?v=5",
  "favicon.svg",
  "manifest.json",
  "Images/placeholder.svg"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // Never cache API calls or non-GET requests.
  if (e.request.method !== "GET" || url.pathname.startsWith("/api/")) return;

  // Cross-origin (fonts, CDN) — let the browser handle it.
  if (url.origin !== location.origin) return;

  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fetched = fetch(e.request)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => cached || caches.match("404.html"));
      // Shell files: cached copy first for instant paint; else network.
      return cached || fetched;
    })
  );
});
