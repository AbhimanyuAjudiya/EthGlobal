/*
 * Recharge service worker (web.md §5, T-61): precaches the app shell and serves /offline when the network is
 * gone. API calls are network-only and NEVER cached — /claim, /esim/*, /card/*, /me/*, /gift/*, /agent/*,
 * /sponsor/* carry sealed LPAs, PINs and keys (the API also sends no-store). /plan falls back to the shell; the
 * page then renders the last IndexedDB snapshot with "as of HH:MM".
 */
const VERSION = 'recharge-shell-v1';
const SHELL = ['/', '/offline', '/plan', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];
const NEVER = /^\/(claim|esim|card|me|gift|agent|sponsor|challenge|world|webhooks|facilitator|__local|api)(\/|$)/;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // other origins (the API, the chain RPC, fonts) and every sensitive path: straight to the network, no cache
  if (url.origin !== self.location.origin || NEVER.test(url.pathname)) return;
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(VERSION).then((cache) => cache.put(request, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches
          .match(url.pathname.startsWith('/plan') ? '/plan' : url.pathname)
          .then((hit) => hit || caches.match('/offline')),
      ),
    );
  }
});
