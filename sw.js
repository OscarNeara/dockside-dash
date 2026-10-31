// Offline worker for Dockside Dash. It keeps the game's files so the game plays without a connection after the
// first visit. The build fills in VERSION and PRECACHE (see vite.config.ts); on the dev server it is never started.

/** Changes with every build that changes a file, so old caches get dropped. */
const VERSION = '0dde6591c339';

/** Files stored when the worker installs, as URLs relative to this file. */
const PRECACHE = [
  "assets/install-BeyBeANl.css",
  "assets/install-Cm6a0Vpp.js",
  "assets/nunito-latin-400-normal-r8SDr6Up.woff2",
  "assets/nunito-latin-600-normal-Br8yIETf.woff2",
  "assets/nunito-latin-700-normal-Dort48En.woff2",
  "assets/nunito-latin-800-normal-Dz8SOQK_.woff2",
  "assets/play-Cw6VXfi0.css",
  "assets/play-wnn7BgNH.js",
  "assets/playfair-display-latin-400-normal-CFtfchNt.woff2",
  "assets/playfair-display-latin-700-italic-CB566L-e.woff2",
  "assets/playfair-display-latin-700-normal-CuDiGg7c.woff2",
  "assets/playfair-display-latin-800-italic-PVABM-JB.woff2",
  "assets/playfair-display-latin-800-normal-lwhkvH_6.woff2",
  "assets/site-Cqkq57QF.css",
  "assets/site-DLMOxUnm.js",
  "icons/apple-touch-icon.png",
  "icons/favicon-32.png",
  "icons/favicon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "icons/qr.png",
  "./",
  "manifest.webmanifest",
  "play/"
];

/** Start of every cache name this worker makes, so it only ever deletes its own caches. */
const PREFIX = 'dockside-';

/** The cache for this version's PRECACHE files and the newest copy of each page. */
const CORE = `${PREFIX}core-${VERSION}`;

/** The cache for other files fetched later, such as screenshots and font files for other alphabets. */
const RUNTIME = `${PREFIX}runtime-${VERSION}`;

/** Folders whose files never change under the same name, so a stored copy can be used without asking the network. */
const STATIC_DIRS = ['assets/', 'icons/', 'shots/'];

/** How long a page request may wait for the network before a stored copy is used instead. */
const PAGE_TIMEOUT_MS = 4000;

/** Turns a URL relative to this worker into a full URL. */
function full(path) {
  return new URL(path, self.location.href).href;
}

/** The URL a page is stored under: no query or hash, and "index.html" dropped so "play/" and "play/index.html" match. */
function pageKey(url) {
  const u = new URL(url);
  u.search = '';
  u.hash = '';
  u.pathname = u.pathname.replace(/index\.html$/, '');
  return u.href;
}

/** True for files the worker answers from its caches first: built files, icons, screenshots and the manifest. */
function isStatic(url) {
  return STATIC_DIRS.some((dir) => url.href.startsWith(full(dir))) || url.href === full('manifest.webmanifest');
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CORE)
      // "reload" skips the browser's HTTP cache, so the pages stored here are the ones from this build.
      .then((cache) => cache.addAll(PRECACHE.map((path) => new Request(full(path), { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n.startsWith(PREFIX) && n !== CORE && n !== RUNTIME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') event.respondWith(pageFromNetworkFirst(request));
  else if (isStatic(url)) event.respondWith(fileFromCacheFirst(request));
});

/**
 * Answers a page request from the network so updates arrive, and stores the new copy. Offline, or when the network
 * takes too long, it answers with the stored copy; a game page with any query string gets the stored game page.
 */
async function pageFromNetworkFirst(request) {
  const key = pageKey(request.url);
  const cache = await caches.open(CORE);
  const network = fetch(request).then((response) => {
    if (response.ok && response.type === 'basic') void cache.put(key, response.clone());
    return response;
  });
  // If the stored copy wins the race, a later network failure is expected; this keeps it out of the console.
  network.catch(() => undefined);
  const stored = () => cache.match(key, { ignoreVary: true }).then((hit) => hit ?? caches.match(key, { ignoreVary: true }));
  /** Waits PAGE_TIMEOUT_MS, then gives the stored copy if there is one. */
  const slow = new Promise((resolve) => setTimeout(resolve, PAGE_TIMEOUT_MS)).then(stored);
  try {
    const first = await Promise.race([network, slow]);
    return first ?? (await network);
  } catch {
    const hit = await stored();
    if (hit) return hit;
    const fallback = key.startsWith(full('play')) ? full('play/') : full('./');
    return (await cache.match(fallback, { ignoreVary: true })) ?? Response.error();
  }
}

/**
 * Answers from the caches when the file is there. Otherwise fetches it and stores a copy for next time. It ignores
 * "Vary" headers: some servers send "Vary: Origin", and the browser's module requests carry an Origin header that the
 * install-time requests lack, so a strict match would miss files that are in the cache.
 */
async function fileFromCacheFirst(request) {
  const hit = await caches.match(request, { ignoreVary: true });
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok && response.type === 'basic') {
    const cache = await caches.open(RUNTIME);
    void cache.put(request, response.clone());
  }
  return response;
}
