// Offline-first service worker.
//
// Strategies, by resource type:
//   • Pinned LibreOffice-WASM payload, self-hosted at same-origin `/wasm/<pin>/`
//     (the default — version-locked, ~52 MB, immutable per pin)
//     → CACHE-FIRST (download once, then serve from cache; enables offline).
//   • Same LibreOffice-WASM payload if loaded from the ZetaOffice CDN instead
//     → CACHE-FIRST (same reasoning, for setups that point back at the CDN).
//   • Same-origin app shell (HTML / JS / CSS / vendored zeta.js)
//     → NETWORK-FIRST (always get the latest; fall back to cache when offline).
//
// Network-first for the shell is important: a cache-first shell would pin users
// (and you, during development) to a stale build until the cache is busted. The
// `/wasm/<pin>/` path is exempt because the pin id changes when the bytes do, so
// a fresh pin is a fresh URL — cache-first there can never go stale.
//
// Corruption safety: we only persist a response after its body has fully
// downloaded. `Cache.put()` reads the body stream, so a connection dropped
// mid-download makes it reject — we then delete the entry instead of leaving a
// truncated payload that cache-first would serve as "complete" forever. (Belt &
// suspenders: the editor also drops the WASM cache before a user-triggered reload
// after a boot failure — see purgeWasmCache() in src/main.ts.)
//
// Cross-origin isolation: the page runs under COEP `require-corp`. Same-origin
// `/wasm/` needs no CORP header; the CDN sends `Cross-Origin-Resource-Policy:
// cross-origin`. Cached responses preserve their headers, so both satisfy COEP
// offline.

const CACHE = 'embeddocx-v4';
const CDN_PREFIX = 'https://cdn.zetaoffice.net/';
const WASM_PATH = '/wasm/';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Store `response` (must be a clone the caller no longer reads). `Cache.put`
// consumes the body; if it was truncated, put() rejects → we delete any partial
// so a later reload re-fetches cleanly instead of serving corrupt bytes.
async function persist(request, response) {
  try {
    const cache = await caches.open(CACHE);
    await cache.put(request, response);
  } catch (e) {
    try {
      const cache = await caches.open(CACHE);
      await cache.delete(request);
    } catch (_) {
      /* ignore */
    }
  }
}

// Cache-first for the big, immutable WASM payload (pinned /wasm/ or CDN).
async function wasmCacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  let res;
  try {
    res = await fetch(request);
  } catch (e) {
    // Offline and not cached yet → explicit failure (the app shows a boot error).
    return new Response('Offline: editor runtime is not cached yet.', {
      status: 503,
      statusText: 'Service Unavailable',
    });
  }
  if (res && res.ok && res.status === 200) {
    persist(request, res.clone()); // clone now (sync), before the page consumes res
  }
  return res;
}

// Network-first for the app shell; fall back to cache when offline.
async function shellNetworkFirst(request) {
  try {
    const res = await fetch(request);
    if (res && res.ok && res.status === 200) persist(request, res.clone());
    return res;
  } catch (e) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw e;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = request.url;

  // Pinned WASM payload (same-origin `/wasm/<pin>/...`) or CDN WASM → cache-first.
  if (url.startsWith(self.location.origin + WASM_PATH) || url.startsWith(CDN_PREFIX)) {
    event.respondWith(wasmCacheFirst(request));
    return;
  }

  // Same-origin app shell → network-first.
  if (url.startsWith(self.location.origin)) {
    event.respondWith(shellNetworkFirst(request));
  }
});
