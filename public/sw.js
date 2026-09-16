/* Dulo service worker.
 *
 * Strategy (kept deliberately small):
 *   - /icons/*, /favicon.svg, /offline  -> cache-first (precached on install)
 *   - /_next/static/*                    -> cache-first (content-hashed, immutable)
 *   - navigations (HTML)                 -> network-first, fall back to the cached
 *                                           page, then to /offline
 *   - everything else (/api, RPC, ...)   -> untouched; the app must never serve a
 *                                           stale price or balance from here.
 *
 * Bump CACHE_VERSION whenever the precache list or the strategy changes.
 */

const CACHE_VERSION = "dulo-v2";
const PRECACHE = [
  "/offline",
  "/favicon.svg",
  "/icons/icon.svg",
  "/icons/icon-192.svg",
  "/icons/icon-512.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
];
const OFFLINE_URL = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) =>
        // Add one by one so a single missing asset does not fail the whole install.
        Promise.all(
          PRECACHE.map((url) =>
            cache.add(new Request(url, { cache: "reload" })).catch(() => undefined),
          ),
        ),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

function isCacheFirst(url) {
  return (
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/favicon.svg" ||
    url.pathname === OFFLINE_URL ||
    url.pathname.startsWith("/_next/static/")
  );
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  const hit = await cache.match(request, { ignoreSearch: false });
  if (hit) return hit;
  const res = await fetch(request);
  if (res && res.ok) {
    cache.put(request, res.clone()).catch(() => undefined);
  }
  return res;
}

async function networkFirstNavigation(request) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const res = await fetch(request);
    if (res && res.ok && res.type === "basic") {
      cache.put(request, res.clone()).catch(() => undefined);
    }
    return res;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    const offline = await cache.match(OFFLINE_URL);
    if (offline) return offline;
    return new Response(
      "<!doctype html><title>Offline</title><body style=\"background:#0a0908;color:#fafafa;font-family:system-ui;padding:2rem\"><h1>You are offline</h1><p>Dulo needs a connection to read your on-chain activity.</p>",
      { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;
  // API routes are never cached, even when the browser opens one as a navigation
  // (address bar, "open in new tab"): a stale price or balance must never be served.
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (isCacheFirst(url)) {
    event.respondWith(cacheFirst(request));
  }
  // Anything else (API, RSC payloads, RPC) goes straight to the network.
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});
