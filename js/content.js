// Where puzzle content comes from, and how the app notices new content.
//
// The app used to address levels by relative path (`data/levels/...`),
// which is fine for a website and wrong for a store build: wrapped in a
// native shell those paths point at files inside the app bundle, so
// "here are 100 more levels" would mean shipping a new binary and waiting
// for review - and every player who didn't update would see nothing. So
// nothing in the app names a content path directly any more. Everything
// goes through contentUrl(), resolved against a base that is configuration
// rather than code.
//
// Resolution order, most specific first:
//
//   1. localStorage "scanword.contentBase" - an on-device override, so a
//      staging content set can be tested on a real phone without a build.
//   2. contentBase from content-config.json - the deployed setting, and
//      the one a store build changes to point at a CDN.
//   3. BUNDLED_BASE - the copy shipped with the app. Always present, so
//      the game works on first launch before any network call, and keeps
//      working if the content host is unreachable.
//
// The index (content.json) carries a contentVersion that changes whenever
// any level file's bytes change. It is persisted separately from the
// service worker cache on purpose: a service worker is not guaranteed to
// run everywhere the app will (notably a WKWebView store build), and the
// app still has to open offline there.

const BUNDLED_BASE = "data/levels/";
const CONFIG_URL = "content-config.json";
const BASE_OVERRIDE_KEY = "scanword.contentBase";
const CONTENT_STATE_KEY = "scanword.content.v1";

function normalizeBase(base) {
  if (!base) return BUNDLED_BASE;
  return base.endsWith("/") ? base : base + "/";
}

// Cached so a resolved base is stable for the session - content URLs
// changing mid-session would mix two content sets in one puzzle list.
let resolvedBase = null;
let configPromise = null;

function baseOverride() {
  try {
    return localStorage.getItem(BASE_OVERRIDE_KEY);
  } catch (err) {
    return null; // storage disabled; the deployed setting still applies
  }
}

async function resolveContentBase() {
  if (resolvedBase) return resolvedBase;

  const override = baseOverride();
  if (override) {
    resolvedBase = normalizeBase(override);
    return resolvedBase;
  }

  if (!configPromise) {
    configPromise = fetch(CONFIG_URL, { cache: "no-cache" })
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null);
  }
  const config = await configPromise;
  resolvedBase = normalizeBase(config && config.contentBase);
  return resolvedBase;
}

// Synchronous view of the base, for callers that run after the config has
// already been resolved (everything after loadContentIndex()).
function contentBase() {
  return resolvedBase || normalizeBase(baseOverride()) || BUNDLED_BASE;
}

function contentUrl(path) {
  return contentBase() + String(path).replace(/^\/+/, "");
}

// --- the index --------------------------------------------------------
function readContentState() {
  try {
    const raw = localStorage.getItem(CONTENT_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.index ? parsed : null;
  } catch (err) {
    return null;
  }
}

function writeContentState(state) {
  try {
    localStorage.setItem(CONTENT_STATE_KEY, JSON.stringify(state));
  } catch (err) {
    // A ~20KB index not fitting is survivable: the network and the service
    // worker cache both still serve it. Losing the game is not.
  }
}

function isUsableIndex(index) {
  return !!(index && Array.isArray(index.levels) && index.levels.length);
}

async function fetchIndexFrom(base) {
  const res = await fetch(base + "content.json", { cache: "no-cache" });
  if (!res.ok) throw new Error("content index fetch failed: " + res.status);
  const index = await res.json();
  if (!isUsableIndex(index)) throw new Error("content index has no levels");
  return index;
}

// Returns { index, source, version, previousVersion, updated }.
//
// Network first, because the whole point is to notice new content - but
// never at the cost of opening the app. Three fallbacks in order: the last
// index this device saw, then the bundled copy, and only then failure.
async function loadContentIndex() {
  const base = await resolveContentBase();
  const saved = readContentState();
  const previousVersion = saved ? saved.version || null : null;

  try {
    const index = await fetchIndexFrom(base);
    const version = index.contentVersion || null;
    writeContentState({ version, base, index, fetchedAt: Date.now() });
    return { index, source: "network", version, previousVersion, updated: !!previousVersion && version !== previousVersion };
  } catch (err) {
    // Offline, or the content host is down.
    if (saved && saved.base === base && isUsableIndex(saved.index)) {
      return { index: saved.index, source: "saved", version: previousVersion, previousVersion, updated: false };
    }
    if (base !== BUNDLED_BASE) {
      try {
        const index = await fetchIndexFrom(BUNDLED_BASE);
        // Fall back to bundled content *and* the base that goes with it,
        // or level URLs would point at a host that just failed.
        resolvedBase = BUNDLED_BASE;
        return { index, source: "bundled", version: index.contentVersion || null, previousVersion, updated: false };
      } catch (bundledErr) {
        /* fall through */
      }
    }
    throw err;
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    BUNDLED_BASE,
    BASE_OVERRIDE_KEY,
    CONTENT_STATE_KEY,
    normalizeBase,
    contentBase,
    contentUrl,
    resolveContentBase,
    loadContentIndex,
  };
}
