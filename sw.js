/* CraftNext service worker — app-shell cache.
   Static shell: cache-first (fast repeat loads, offline shell).
   Everything else (API, images): network-first with cache fallback,
   so data stays fresh but the site still opens offline. */

const CACHE = "craftnext-v3";

const SHELL = [
  "/",
  "index.html",
  "collection.html",
  "404.html",
  "style.css?v=5",
  "script.js?v=5",
  "api.js?v=5",
  "theme.js?v=5",
  "favicon.svg",
  "manifest.json",
  "Images/placeholder.svg"
];

// Sanitize redirected responses so Chromium never terminates navigation with ERR_FAILED
async function cleanResponse(response) {
  if (!response || !response.redirected) return response;
  try {
    const cloned = response.clone();
    const body = await cloned.blob();
    return new Response(body, {
      headers: cloned.headers,
      status: cloned.status,
      statusText: cloned.statusText,
    });
  } catch (_) {
    return response;
  }
}

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then(async (c) => {
      await Promise.allSettled(
        SHELL.map(async (item) => {
          try {
            const res = await fetch(item);
            if (res.ok) {
              const clean = await cleanResponse(res);
              await c.put(item, clean);
            }
          } catch (_) {}
        })
      );
    }).then(() => self.skipWaiting())
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

  // Top-level HTML page navigations
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request)
        .then(async (res) => {
          if (res.ok) {
            const clone = res.clone();
            const cleanForCache = await cleanResponse(clone);
            caches.open(CACHE).then((c) => c.put(e.request, cleanForCache));
          }
          return cleanResponse(res);
        })
        .catch(async () => {
          return (
            (await caches.match(e.request)) ||
            (await caches.match("/")) ||
            (await caches.match("index.html")) ||
            (await caches.match("404.html"))
          );
        })
    );
    return;
  }

  // Shell files & static assets: cached copy first for instant paint; else network.
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fetched = fetch(e.request)
        .then(async (res) => {
          if (res.ok) {
            const clone = res.clone();
            const cleanForCache = await cleanResponse(clone);
            caches.open(CACHE).then((c) => c.put(e.request, cleanForCache));
          }
          return cleanResponse(res);
        })
        .catch(() => cached || caches.match("404.html"));
      return cached || fetched;
    })
  );
});
