// Verifies the PWA install actually works: the worker registers, the
// precache holds what offline play needs, and the game still opens and
// plays with the network cut.
//
//   node tools/test-pwa.mjs
//
// This has to run in a real browser - service workers, the cache API and
// offline behaviour have no meaningful stub. It serves the repo over
// http://127.0.0.1 (service workers require a secure context, and
// localhost counts as one) and drives Chromium against it.

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

// "Offline" here means the server is actually gone, not
// BrowserContext.setOffline(): that flag does not apply to fetches the
// service worker itself makes, so a cache miss would quietly succeed over
// the network and the test would pass without proving anything. Killing
// the origin is unambiguous - anything that still works came from cache.
let server = null;
let port = 0;

function handler(req, res) {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ""));
  (async () => {
    const target = (await stat(file)).isDirectory() ? join(file, "index.html") : file;
    const body = await readFile(target);
    res.writeHead(200, { "content-type": TYPES[extname(target)] || "application/octet-stream" });
    res.end(body);
  })().catch(() => res.writeHead(404).end("not found"));
}

async function startServer() {
  server = createServer(handler);
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  port = server.address().port;
}

async function stopServer() {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  server = null;
}

await startServer();
const base = `http://127.0.0.1:${port}/`;

let passed = 0;
const failures = [];
const check = (name, cond, detail = "") => {
  if (cond) passed++;
  else failures.push(`${name}${detail ? " - " + detail : ""}`);
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const context = await browser.newContext();
const page = await context.newPage();
page.on("pageerror", (err) => failures.push("page error: " + err.message));

await page.goto(base, { waitUntil: "load" });

// --- registration -----------------------------------------------------
// `ready` resolves as soon as there is an active worker, which can still
// be in the "activating" state for a moment - wait for it to settle.
const active = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.ready;
  if (!reg.active) return false;
  if (reg.active.state === "activated") return true;
  return new Promise((resolve) => {
    reg.active.addEventListener("statechange", function onChange() {
      if (reg.active.state === "activated") {
        reg.active.removeEventListener("statechange", onChange);
        resolve(true);
      }
    });
    setTimeout(() => resolve(false), 10000);
  });
});
check("service worker activates", active);

// Wait for install's precache to settle before asking what's in it.
await page.waitForFunction(
  async () => {
    const names = await caches.keys();
    if (!names.length) return false;
    const cache = await caches.open(names[0]);
    return (await cache.keys()).length > 100;
  },
  null,
  { timeout: 60000 }
);

const cached = await page.evaluate(async () => {
  const names = await caches.keys();
  const cache = await caches.open(names[0]);
  return { names, urls: (await cache.keys()).map((r) => new URL(r.url).pathname) };
});
check("exactly one cache", cached.names.length === 1, cached.names.join(", "));
check("shell is precached", cached.urls.some((u) => u.endsWith("/index.html")) && cached.urls.some((u) => u.endsWith("/style.css")));
check("app scripts are precached", cached.urls.filter((u) => u.includes("/js/")).length === 7);
check("ladder is precached", cached.urls.some((u) => u.endsWith("/data/levels/ladder.json")));
check("icons are precached", cached.urls.filter((u) => u.includes("/icons/")).length === 3);

const levelFiles = cached.urls.filter((u) => u.includes("/data/levels/") && !u.endsWith("ladder.json") && !u.endsWith("manifest.json"));
check("all 100 levels are precached", levelFiles.length === 100, `got ${levelFiles.length}`);

// The whole point of splitting the dictionary out: it must NOT be part of
// the install, or the first-launch download doubles for a feature most
// players never touch.
check(
  "dictionary is not precached",
  !cached.urls.some((u) => u.endsWith("/data/dictionary.js")),
  "install payload would nearly double"
);
check("dictionary is not loaded at startup", await page.evaluate(() => typeof DICTIONARY === "undefined"));

// --- manifest ---------------------------------------------------------
const manifest = await page.evaluate(async () => {
  const href = document.querySelector('link[rel="manifest"]').href;
  return (await fetch(href)).json();
});
check("manifest is standalone", manifest.display === "standalone");
check("manifest declares Ukrainian", manifest.lang === "uk");
check("manifest has a maskable icon", manifest.icons.some((i) => i.purpose === "maskable" && i.sizes === "512x512"));
check("manifest start_url is relative", manifest.start_url === "./", "an absolute path breaks subdirectory hosting");

// --- offline ----------------------------------------------------------
await stopServer();
const offlinePage = await context.newPage();
offlinePage.on("pageerror", (err) => failures.push("offline page error: " + err.message));
await offlinePage.goto(base, { waitUntil: "load" });

check("app shell renders offline", (await offlinePage.locator("#playBtn").count()) === 1);
await offlinePage.waitForFunction(() => document.querySelectorAll("#ladder .level-tile").length === 100, null, { timeout: 15000 });
check("ladder renders offline", true);

// Play a level with the network down: this is the real test, since it
// exercises the level JSON coming from cache rather than the shell.
await offlinePage.click("#playBtn");
await offlinePage.click(".level-tile");
await offlinePage.waitForFunction(() => document.querySelectorAll("#grid .cell").length > 0, null, { timeout: 15000 });
check("a level loads and renders offline", (await offlinePage.locator("#grid .cell.letter").count()) > 0);

// Solve it offline, so scoring/progress/results are covered too.
const solved = await offlinePage.evaluate(async () => {
  puzzle.words.forEach((w) =>
    w.cells.forEach(([r, c], i) => {
      const input = inputEls[r + "-" + c];
      input.value = w.answer[i];
    })
  );
  checkWordCompletion();
  return { done: puzzleSolved, results: !document.getElementById("results").hidden };
});
check("puzzle can be completed offline", solved.done && solved.results);

// Back out and open the daily, offline.
await offlinePage.click("#toMenuBtn");
await offlinePage.click("#levelsBackBtn");
await offlinePage.click("#dailyBtn");
await offlinePage.waitForFunction(() => document.querySelectorAll("#grid .cell").length > 0, null, { timeout: 15000 });
check("daily loads offline", await offlinePage.evaluate(() => currentDailyKey !== null));

// The custom generator is the one thing that genuinely needs the network
// on first use - it must say so rather than hanging or throwing.
await offlinePage.click("#backBtn");
await offlinePage.click("#playBtn");
await offlinePage.evaluate(() => document.querySelector(".custom-settings").setAttribute("open", ""));
await offlinePage.click("#generateBtn");
await offlinePage.waitForFunction(() => /словник/.test(document.getElementById("status").textContent), null, { timeout: 20000 });
check("generator explains itself when the dictionary can't be fetched offline", true);

// --- dictionary caches on demand, online -------------------------------
await startServer();
const onlinePage = await context.newPage();
await onlinePage.goto(base, { waitUntil: "load" });
await onlinePage.evaluate(() => loadDictionary());
await onlinePage.waitForFunction(() => typeof DICTIONARY !== "undefined", null, { timeout: 30000 });
const dictCached = await onlinePage.evaluate(async () => {
  const cache = await caches.open((await caches.keys())[0]);
  return !!(await cache.match(new URL("data/dictionary.js", location.href).href));
});
check("dictionary is cached once actually used", dictCached, "so it is offline-available from then on");

await browser.close();
await stopServer();

console.log(`${passed} passed, ${failures.length} failed`);
if (failures.length) {
  failures.forEach((f) => console.log("  FAIL: " + f));
  process.exit(1);
}
