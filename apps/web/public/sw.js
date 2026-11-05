/* global self, caches */
/*
 * Recharge service worker (web.md §5, T-61): precaches the app shell and serves it when the network is gone. API
 * calls are network-only and NEVER cached — /claim, /esim/*, /card/*, /me/*, /gift/*, /agent/*, /sponsor/* carry
 * sealed LPAs, PINs and keys (the API also sends no-store), and no /plan/<key> document is ever stored.
 *
 * Offline /plan/<key> (RT-W-06): the navigation is answered with the precached /plan shell. That page reads the
 * key from the address bar and renders the plan from this device's last IndexedDB snapshot ("Offline · as of
 * 14:02"), or an honest offline card when there is none. The shell's own /_next/static scripts, styles and fonts
 * are precached with it (read from the cached HTML), so it hydrates without a network.
 */
const VERSION = 'recharge-shell-v2';
const DOCUMENTS = ['/', '/offline', '/plan'];
const FILES = ['/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];
const NEVER =
  /^\/(claim|esim|card|me|gift|agent|sponsor|challenge|world|webhooks|facilitator|__local|api)(\/|$)/;
const STATIC = /(?:src|href)="(\/_next\/static\/[^"?#]+)"/g;

/** The hashed scripts, styles and fonts a cached document needs to hydrate. */
function staticAssets(html) {
  const found = new Set();
  for (const match of html.matchAll(STATIC)) found.add(match[1]);
  return [...found];
}

async function precache() {
  const cache = await caches.open(VERSION);
  await cache.addAll(FILES);
  const assets = new Set();
  for (const path of DOCUMENTS) {
    const res = await fetch(path, { cache: 'no-store', credentials: 'same-origin' });
    if (!res.ok) throw new Error(`precache ${path}: ${res.status}`);
    await cache.put(path, res.clone());
    for (const asset of staticAssets(await res.text())) assets.add(asset);
  }
  await cache.addAll([...assets]);
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
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
  // other origins (the API, the chain RPC) and every sensitive path: straight to the network, no cache
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
    // /plan and /plan/<anything> share the precached /plan shell; nothing per key is ever stored
    const shell = /^\/plan(\/|$)/.test(url.pathname) ? '/plan' : url.pathname;
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(shell).then((hit) => hit || caches.match('/offline')),
      ),
    );
  }
});
