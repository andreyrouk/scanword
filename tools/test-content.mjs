// Proves content is genuinely decoupled from the app.  node tools/test-content.mjs
//
// The claim being tested is the one that matters before a store build:
// puzzle content can be published from somewhere else entirely, so
// shipping 100 more levels does not mean shipping a new binary and waiting
// for review. Asserting that needs content served from a *different
// origin* than the app - anything same-origin would pass whether or not
// the indirection works.
//
// So this runs two servers: the app on one port, a stand-in CDN on
// another, with content-config.json pointing the app at the CDN. Then it
// checks the three things that have to hold:
//
//   1. the app loads and plays entirely from the remote content set
//   2. new content on the CDN is picked up with no app file changed
//   3. the app still opens and plays when the CDN is unreachable
//
// (3) is what keeps this safe to ship: content hosting becoming a single
// point of failure for opening the game would be a bad trade.

import { createServer } from "node:http";
import { readFile, stat, readdir } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const LEVELS = join(ROOT, "data/levels");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

let passed = 0;
const failures = [];
const check = (name, cond, detail = "") => {
  if (cond) passed++;
  else failures.push(`${name}${detail ? " - " + detail : ""}`);
};

// --- the stand-in CDN -------------------------------------------------
// Serves data/levels/ at its root, cross-origin, with CORS - exactly the
// shape a real content host would have.
let cdnHits = 0;
const cdnServed = new Set(); // distinct paths, for waiting without polling the browser
let cdnIndexOverride = null; // set to serve a different content set
let cdn = null;
let cdnPort = 0;

function cdnHandler(req, res) {
  cdnHits++;
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  cdnServed.add(path);
  const cors = { "access-control-allow-origin": "*", "cache-control": "no-store" };

  if (path === "/content.json" && cdnIndexOverride) {
    res.writeHead(200, { ...cors, "content-type": TYPES[".json"] });
    res.end(JSON.stringify(cdnIndexOverride));
    return;
  }
  const file = join(LEVELS, normalize(path).replace(/^(\.\.[/\\])+/, ""));
  readFile(file)
    .then((body) => {
      res.writeHead(200, { ...cors, "content-type": TYPES[extname(file)] || "application/octet-stream" });
      res.end(body);
    })
    .catch(() => res.writeHead(404, cors).end("not found"));
}

async function startCdn() {
  cdn = createServer(cdnHandler);
  await new Promise((r) => cdn.listen(cdnPort, "127.0.0.1", r));
  cdnPort = cdn.address().port;
}
async function stopCdn() {
  cdn.closeAllConnections();
  await new Promise((r) => cdn.close(r));
  cdn = null;
}

// --- the app server ---------------------------------------------------
// Identical to a real deploy except that content-config.json is answered
// dynamically, which is how a build would point at its own CDN.
let contentBase = null; // null = serve the file as committed (bundled)
const app = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path === "/content-config.json" && contentBase) {
    res.writeHead(200, { "content-type": TYPES[".json"], "cache-control": "no-store" });
    res.end(JSON.stringify({ contentBase }));
    return;
  }
  const file = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ""));
  (async () => {
    const target = (await stat(file)).isDirectory() ? join(file, "index.html") : file;
    const body = await readFile(target);
    res.writeHead(200, { "content-type": TYPES[extname(target)] || "application/octet-stream" });
    res.end(body);
  })().catch(() => res.writeHead(404).end("not found"));
});
await new Promise((r) => app.listen(0, "127.0.0.1", r));
const appBase = `http://127.0.0.1:${app.address().port}/`;

await startCdn();
contentBase = `http://127.0.0.1:${cdnPort}/`;

const bundledIndex = JSON.parse(await readFile(join(LEVELS, "content.json"), "utf8"));
const bundledCount = bundledIndex.levels.length;
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });

// Each case gets a fresh context: a shared service worker or localStorage
// would let one case's cached content satisfy the next, and the fallback
// checks would pass without the fallback existing.
async function freshPage(init) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("pageerror", (err) => failures.push("page error: " + err.message));
  if (init) await page.addInitScript(init);
  return { context, page };
}

async function waitForLadder(page, count) {
  await page.waitForFunction((n) => document.querySelectorAll("#ladder .level-tile").length === n, count, { timeout: 20000 });
}

// --- 1. content served from another origin ----------------------------
{
  const { context, page } = await freshPage();
  const remoteRequests = [];
  page.on("request", (r) => {
    if (r.url().startsWith(`http://127.0.0.1:${cdnPort}/`)) remoteRequests.push(new URL(r.url()).pathname);
  });

  await page.goto(appBase, { waitUntil: "load" });
  await waitForLadder(page, bundledIndex.levels.length);

  const info = await page.evaluate(() => ({ base: contentBase(), version: contentInfo.version, source: contentInfo.source }));
  check("the app resolves content to the remote base", info.base === `http://127.0.0.1:${cdnPort}/`, info.base);
  check("and reports it loaded from the network", info.source === "network", info.source);
  check("with the published content version", info.version === bundledIndex.contentVersion, `${info.version}`);
  check("the index came from the remote host", remoteRequests.includes("/content.json"), remoteRequests.slice(0, 3).join(", "));

  // Playing has to pull the level itself from the remote host too.
  await page.click("#playBtn");
  await page.click(".level-tile");
  await page.waitForFunction(() => document.querySelectorAll("#grid .cell").length > 0, null, { timeout: 20000 });
  const levelFetched = remoteRequests.some((p) => /^\/(easy|medium|hard)\/[^/]+\.json$/.test(p));
  check("a level is fetched from the remote host", levelFetched, remoteRequests.join(", "));
  check("and renders", (await page.locator("#grid .cell.letter").count()) > 0);

  // No app file may name a content path any more - that is the whole point.
  const appJs = await readFile(join(ROOT, "js/app.js"), "utf8");
  check("js/app.js contains no hardcoded content path", !/fetch\(["'`]data\/levels/.test(appJs));

  // And the worker must precache the remote set, or a store build with
  // remote content would have no offline mode at all.
  // Wait on the remote entries specifically, not the cache total: the core
  // assets alone can satisfy a total-count wait while the remote precache
  // is still in flight, which would sample it half-done.
  const remoteOrigin = `http://127.0.0.1:${cdnPort}/`;
  const countRemote = () =>
    page.evaluate(async (origin) => {
      const names = await caches.keys();
      if (!names.length) return 0;
      const cache = await caches.open(names[0]);
      return (await cache.keys()).filter((r) => r.url.startsWith(origin)).length;
    }, remoteOrigin);
  // Waited for on the server side. Polling the Cache API from the page
  // enumerates every entry on each tick and competes with the very fetches
  // being waited on - it measured ~1 file/second that way against 100 in a
  // few seconds when left alone.
  const levelPath = /^\/(easy|medium|hard)\/[^/]+\.json$/;
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if ([...cdnServed].filter((p) => levelPath.test(p)).length >= bundledCount) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  await new Promise((r) => setTimeout(r, 1500)); // let the last cache.put settle
  const cachedRemote = await countRemote();
  const servedLevels = [...cdnServed].filter((p) => levelPath.test(p)).length;
  check("the worker requests every remote level", servedLevels === bundledCount, `${servedLevels} of ${bundledCount}`);
  check(
    "and caches the whole remote content set for offline play",
    cachedRemote > bundledCount,
    `${cachedRemote} remote entries, expected > ${bundledCount}`
  );

  await context.close();
}

// --- 2. new content, no app change ------------------------------------
// The headline claim: publish a different content set and the running app
// picks it up. Nothing about the app is touched here.
{
  const shortened = {
    ...bundledIndex,
    contentVersion: "deadbeef1234",
    count: 12,
    levels: bundledIndex.levels.slice(0, 12),
    tiers: { easy: bundledIndex.tiers.easy.slice(0, 4), medium: bundledIndex.tiers.medium.slice(0, 4), hard: bundledIndex.tiers.hard.slice(0, 4) },
  };
  cdnIndexOverride = shortened;

  const { context, page } = await freshPage();
  await page.goto(appBase, { waitUntil: "load" });
  await waitForLadder(page, 12);
  const info = await page.evaluate(() => ({ version: contentInfo.version, count: ladder.levels.length }));
  check("a new content set on the host replaces the old one", info.count === 12, `${info.count} levels`);
  check("and its version is reported", info.version === "deadbeef1234", info.version);

  // Second visit with the version changed again: the app must notice
  // rather than sit on what it saw last time.
  cdnIndexOverride = { ...shortened, contentVersion: "feedface5678", count: 8, levels: bundledIndex.levels.slice(0, 8) };
  await page.reload({ waitUntil: "load" });
  await waitForLadder(page, 8);
  const after = await page.evaluate(() => ({ version: contentInfo.version, previous: contentInfo.previousVersion, updated: contentInfo.updated }));
  check("a later version is picked up on the next launch", after.version === "feedface5678", after.version);
  check("and the change is detected against what was seen before", after.updated && after.previous === "deadbeef1234", JSON.stringify(after));

  cdnIndexOverride = null;
  await context.close();
}

// --- 3. the content host being down must not break the game -----------
{
  await stopCdn();
  const { context, page } = await freshPage();
  await page.goto(appBase, { waitUntil: "load" });
  await waitForLadder(page, bundledIndex.levels.length);

  const info = await page.evaluate(() => ({ source: contentInfo.source, base: contentBase() }));
  check("an unreachable host falls back to the bundled content", info.source === "bundled", info.source);
  check("and level URLs fall back with it", info.base === "data/levels/", info.base);

  await page.click("#playBtn");
  await page.click(".level-tile");
  await page.waitForFunction(() => document.querySelectorAll("#grid .cell").length > 0, null, { timeout: 20000 });
  check("a bundled level still plays", (await page.locator("#grid .cell.letter").count()) > 0);
  await context.close();
  await startCdn();
  contentBase = `http://127.0.0.1:${cdnPort}/`;
}

// --- 4. the on-device override ----------------------------------------
// So a staging content set can be tested on a real phone without a build.
{
  const { context, page } = await freshPage(`localStorage.setItem("scanword.contentBase", "data/levels")`);
  await page.goto(appBase, { waitUntil: "load" });
  await waitForLadder(page, bundledIndex.levels.length);
  const base = await page.evaluate(() => contentBase());
  check("a localStorage override wins over the deployed config", base === "data/levels/", base);
  check("and a missing trailing slash is tolerated", base.endsWith("/"), base);
  await context.close();
}

// --- 5. the version is a content digest, not a timestamp --------------
{
  const levelFiles = [];
  for (const tier of ["easy", "medium", "hard"]) {
    for (const f of await readdir(join(LEVELS, tier))) levelFiles.push(`${tier}/${f}`);
  }
  check("the index lists every level file on disk", bundledIndex.levels.length === levelFiles.length, `${bundledIndex.levels.length} vs ${levelFiles.length}`);
  check("the version looks like a digest", /^[0-9a-f]{12}$/.test(bundledIndex.contentVersion), bundledIndex.contentVersion);
  check("tier lists cover every level", Object.values(bundledIndex.tiers).flat().length === bundledIndex.levels.length);
}

await browser.close();
await stopCdn();
app.closeAllConnections();
await new Promise((r) => app.close(r));

console.log(`${passed} passed, ${failures.length} failed  (${cdnHits} requests served by the stand-in CDN)`);
if (failures.length) {
  failures.forEach((f) => console.log("  FAIL: " + f));
  process.exit(1);
}
