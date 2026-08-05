// Renders the app icon to the PNG sizes a PWA install needs.
//
//   node tools/make-icons.mjs
//
// Output: icons/icon-192.png, icons/icon-512.png, icons/icon.svg
//
// Uses the Chromium that's already present for browser testing rather than
// adding an image library: the icon is SVG, and a browser is the most
// faithful SVG renderer available here.
//
// The mark is the scanword itself - a filled clue cell with an arrow
// pointing into the empty letter cells it explains. That's the one visual
// idea that distinguishes a scanword from a crossword, and it stays
// legible at 48px where lettering would not.
//
// Artwork sits inside the middle ~70% so the same file works as a
// `maskable` icon: Android crops icons to a device-chosen shape (circle,
// squircle, rounded square) and anything outside that safe zone can be
// cut off.

import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";

const SIZES = [192, 512];
const OUT_DIR = "icons";

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" fill="#2e7d46"/>
  <g>
    <!-- clue cell: filled, with the arrow that points at where the word starts -->
    <rect x="118" y="118" width="128" height="128" rx="14" fill="#ffffff"/>
    <path d="M168 182 h44 v-20 l34 30 -34 30 v-20 h-44 z" fill="#2e7d46"/>
    <!-- letter cells the clue feeds into -->
    <rect x="266" y="118" width="128" height="128" rx="14" fill="none" stroke="#ffffff" stroke-width="18"/>
    <rect x="118" y="266" width="128" height="128" rx="14" fill="none" stroke="#ffffff" stroke-width="18"/>
    <rect x="266" y="266" width="128" height="128" rx="14" fill="none" stroke="#ffffff" stroke-width="18"/>
  </g>
</svg>`;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(`${OUT_DIR}/icon.svg`, SVG);

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
for (const size of SIZES) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  // omitBackground keeps the PNG's own alpha rather than compositing the
  // browser's default white behind the rounded mask.
  await page.setContent(
    `<html><body style="margin:0">${SVG.replace('width="512" height="512"', `width="${size}" height="${size}"`)}</body></html>`
  );
  await page.screenshot({ path: `${OUT_DIR}/icon-${size}.png`, omitBackground: true });
  await page.close();
  console.log(`wrote ${OUT_DIR}/icon-${size}.png`);
}
await browser.close();
console.log(`wrote ${OUT_DIR}/icon.svg`);
