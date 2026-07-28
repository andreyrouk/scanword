// Downloads the raw Ukrainian frequency list that build-wordlist.mjs
// consumes. Kept out of git (see .gitignore) - it is a third-party
// artefact, easy to re-fetch, and not something to vendor.
//
//   node tools/fetch-wordlist.mjs
//
// Source: hermitdave/FrequencyWords - word frequencies computed from the
// OpenSubtitles corpus. The repository is MIT licensed, and frequency
// counts derived from a corpus are data rather than a creative work, so
// this is usable in a commercial app. That is the reason for choosing it
// over VESUM/dict_uk, which is the better *linguistic* resource but is
// CC BY-NC-SA (NonCommercial) and therefore unusable here.

import { writeFileSync, mkdirSync } from "node:fs";

const URL =
  "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/uk/uk_50k.txt";
const OUT = "data/raw/uk_50k.txt";

const res = await fetch(URL);
if (!res.ok) {
  console.error(`Download failed: ${res.status} ${res.statusText}`);
  process.exit(1);
}
mkdirSync("data/raw", { recursive: true });
writeFileSync(OUT, await res.text());
console.log(`Saved ${OUT}`);
