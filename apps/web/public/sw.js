/*
 * The Back Room, installed.
 *
 * Deliberately small, and deliberately ignorant of the game. Everything a
 * player's evening depends on — chips, seats, sign-in — belongs to the server
 * and goes straight to it; a copy of any of those served from a cache would be
 * a fact invented on the server's behalf. What this keeps is the building's
 * furniture: the hashed build files, which can never go stale because a new
 * build gives them new names, and a page to show when there is no network at
 * all.
 */

// offline.html is only re-fetched into the cache when a new worker installs,
// which only happens when sw.js itself changes — so any edit to offline.html
// must bump this name too, or an installed app keeps serving the old page.
const SHELL = "backroom-shell-v1";
const ASSETS = "backroom-assets";
const OFFLINE = "/offline.html";
/** Enough for a build or two; older hashed files are dead weight after a deploy. */
const ASSET_LIMIT = 80;
/** The same doors CLIENT_ROUTE keeps the page handler away from, on the server. */
const NEVER = /^\/(?:api|auth|socket\.io|og|healthz)(?:\/|$)/;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll([OFFLINE]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names.filter((name) => name !== SHELL && name !== ASSETS).map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") {
    return;
  }
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || NEVER.test(url.pathname)) {
    return;
  }

  if (request.mode === "navigate") {
    // Network first, always: the server writes each page's head for its own
    // address, and a table's goes stale as its seats fill.
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE).then((page) => page ?? Response.error())),
    );
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(fromDevice(request));
  }
});

async function fromDevice(request) {
  const cache = await caches.open(ASSETS);
  const kept = await cache.match(request);
  if (kept !== undefined) {
    return kept;
  }
  const response = await fetch(request);
  // A 404 for an old build's file is not the file, and keeping it would serve
  // the error forever.
  if (response.ok) {
    await cache.put(request, response.clone());
    await trim(cache);
  }
  return response;
}

async function trim(cache) {
  const keys = await cache.keys();
  const surplus = keys.length - ASSET_LIMIT;
  for (const key of keys.slice(0, Math.max(0, surplus))) {
    await cache.delete(key);
  }
}
