// Service worker: makes the game installable and fully playable offline.
//
// The whole app is static, so "offline" is mostly a caching question. Two
// caching rules, chosen by what the file actually is:
//
//   Immutable content (level JSON, the dictionary, icons) is cache-first
//   and never revalidated. A level file's contents are fixed the moment
//   it's generated - if a level ever changes it gets a new filename, and
//   the ladder points at the new one. Revalidating 100 level files on
//   every load would spend the player's data to learn nothing.
//
//   The app shell (HTML/CSS/JS, the ladder, the manifest) is
//   stale-while-revalidate: served instantly from cache so the game opens
//   at once even on a dead connection, and refreshed in the background so
//   a fix lands on the next launch instead of never.
//
// The dictionary (~1MB, more than half the payload) is deliberately NOT
// precached. It's only needed by the custom-grid generator, which most
// players never open - the 100 levels and the daily are fully playable
// without it. It gets cached the first time someone actually generates a
// grid, and is then available offline like everything else.
//
// Bump CACHE_VERSION when the precache list changes; activate deletes
// every cache that isn't the current one.

const CACHE_VERSION = "v1";
const CACHE_NAME = `scanword-${CACHE_VERSION}`;

// Everything needed to open the app and reach a puzzle. Relative URLs
// resolve against the worker's own location, so this all keeps working
// when the app is served from a subdirectory (e.g. GitHub Pages).
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./manifest.webmanifest",
  "./js/grid-skeleton.js",
  "./js/word-filler.js",
  "./js/generator.js",
  "./js/scoring.js",
  "./js/progress.js",
  "./js/daily.js",
  "./js/app.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon.svg",
  "./data/levels/ladder.json",
  "./data/levels/manifest.json",
];

// Paths whose contents never change once published.
function isImmutable(url) {
  return (
    (url.pathname.includes("/data/levels/") && url.pathname.endsWith(".json") && !url.pathname.endsWith("ladder.json")) ||
    url.pathname.endsWith("/data/dictionary.js") ||
    url.pathname.includes("/icons/")
  );
}

// The level list is read from ladder.json at install time rather than
// hardcoded here, so adding levels doesn't mean editing the worker - and
// the two can't silently drift apart.
async function levelUrls() {
  try {
    const res = await fetch("./data/levels/ladder.json", { cache: "no-cache" });
    if (!res.ok) return [];
    const ladder = await res.json();
    return (ladder.levels || []).map((l) => `./data/levels/${l.file}`);
  } catch (err) {
    return [];
  }
}

// addAll() is atomic: one 404 among 100 level files would reject the whole
// batch and leave the install with nothing cached. Levels are cached
// individually and best-effort so a single bad file costs one level, not
// the offline mode. The core assets do use addAll - if those can't be
// cached there is no working install to speak of, and failing loudly is
// better than a half-installed app that breaks on the first flight.
async function cacheAllBestEffort(cache, urls) {
  await Promise.all(
    urls.map(async (url) => {
      try {
        const res = await fetch(url, { cache: "no-cache" });
        if (res.ok) await cache.put(url, res);
      } catch (err) {
        /* skip: this one level just won't be available offline */
      }
    })
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(CORE_ASSETS);
      await cacheAllBestEffort(cache, await levelUrls());
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith("scanword-") && n !== CACHE_NAME).map((n) => caches.delete(n)));
      await self.clients.claim();
    })()
  );
});

// Lets the page ask a waiting worker to take over immediately, instead of
// waiting for every tab to close. Triggered only by an explicit message,
// never on its own - swapping the shell out from under a puzzle in
// progress is exactly the kind of surprise this shouldn't cause.
self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});

async function staleWhileRevalidate(request, cache) {
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((res) => {
      if (res && res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => null);

  if (cached) return cached;
  const fresh = await network;
  if (fresh) return fresh;
  throw new Error("offline and not cached: " + request.url);
}

async function cacheFirst(request, cache) {
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res && res.ok) cache.put(request, res.clone());
  return res;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      // A navigation to any URL under the app should open the app, even
      // offline and even for a path that was never visited online (the
      // manifest's shortcut URL carries a query string, which would
      // otherwise miss the cache entry for "./").
      if (request.mode === "navigate") {
        try {
          return await staleWhileRevalidate(request, cache);
        } catch (err) {
          return (await cache.match("./index.html")) || (await cache.match("./")) || Response.error();
        }
      }

      try {
        return isImmutable(url) ? await cacheFirst(request, cache) : await staleWhileRevalidate(request, cache);
      } catch (err) {
        return Response.error();
      }
    })()
  );
});
