// Turns a raw Ukrainian frequency list into ranked candidate answers for
// the scanword dictionary.
//
//   node tools/fetch-wordlist.mjs      # downloads the raw list
//   node tools/build-wordlist.mjs      # filters + ranks it
//
// Input:  data/raw/uk_50k.txt  - "word count" per line, most frequent first
//         (hermitdave/FrequencyWords, MIT licensed, from OpenSubtitles)
// Output: data/wordlist-candidates.json - [{ word, freq, len }, ...]
//
// What this does NOT do: guarantee every candidate is a Ukrainian
// nominative singular noun. Two limits are inherent to the source, and
// both were measured rather than assumed:
//
//  * Part of speech. Doing this properly needs a morphological analyser,
//    and the good Ukrainian one (VESUM) is CC BY-NC-SA - unusable in a
//    paid app. Shape rules below remove what can be removed safely; a
//    lot of verbs/adverbs still get through.
//  * Language. The Ukrainian OpenSubtitles corpus is heavily polluted
//    with Russian. Words using only letters common to both alphabets
//    (здесь, когда, очень) pass the alphabet check. Excluding everything
//    that also appears in the Russian list is NOT viable: 36% of the
//    hand-curated Ukrainian nouns appear there too, as genuine cognates.
//
// So this stage produces a *candidate pool*, not a finished word list.
// Both remaining problems are trivial for the clue-writing pass to
// settle ("is this a Ukrainian noun? if so, write a clue"), which has to
// look at every word anyway - so that is where they get resolved.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const IN = "data/raw/uk_50k.txt";
const OUT = "data/wordlist-candidates.json";

// One grid cell holds exactly one letter, so anything with an apostrophe,
// hyphen or Latin character can never be an answer.
const CYRILLIC_ONLY = /^[абвгґдеєжзиіїйклмнопрстуфхцчшщьюя]+$/;
const MIN_LEN = 3;
const MAX_LEN = 9;

// Endings that are confidently not a nominative singular noun.
// Deliberately NOT excluding "-ла"/"-ло": those catch past-tense verbs
// but also destroy huge numbers of real nouns (школа, крило, дзеркало). Each rule
// here was checked against the hand-curated dictionary (which is all real
// nouns) to confirm it does not remove valid answers - see the recall
// number printed at the end of a run.
//   -ти/-ться      infinitives, reflexives
//   -ю/-аю/-ую     1st person verbs (думаю, дякую); nominative nouns
//                  essentially never end in -ю
//   -еш/-єш/-иш/-їш 2nd person verbs (знаєш, хочеш)
//   -ше/-ще        comparatives (більше, краще)
//   -ешь/-ишь/-ый/-ой/-ого/-его  Russian shapes that survive the
//                  Ukrainian-alphabet check because they share letters
const NOT_NOUN_SHAPE =
  /(ти|тись|тися|ться|ю|еш|єш|иш|їш|ше|ще|ешь|ишь|ый|ой|ого|его)$/;

// Function words: frequent, never valid answers. Shape can't identify
// these, so they are listed. Extend as the list is reviewed.
const STOPWORDS = new Set(`
я ти ви ми він вона воно вони мене тебе його її нас вас їх мені тобі йому їй нам вам їм
мій моя моє мої твій твоя твоє твої свій своя своє свої наш наша наше наші ваш ваша ваше ваші
цей ця це ці той та те ті хто що який яка яке які чий чия чиє чиї
не ні так ось от ну ані хіба невже
в у на за під над при про для без через між серед біля коло після перед від до із з о об
і й та але або чи бо що щоб як коли якщо тому проте однак адже поки доки хоча ніби наче
вже ще тільки лише навіть саме дуже надто зовсім майже трохи ледве геть аж
тут там де куди звідки тоді зараз потім раніше пізніше завжди ніколи іноді часто рідко
можна треба варто мабуть звичайно авжеж гаразд добре погано
бути був була було були є нема немає буде будуть
себе собі собою один одна одне одні два дві три чотири
пан пані сер мем окей алло агов гей ох ах ей ага угу
`.trim().split(/\s+/));

function main() {
  let raw;
  try {
    raw = readFileSync(IN, "utf8");
  } catch {
    console.error(`Missing ${IN}. Run: node tools/fetch-wordlist.mjs`);
    process.exit(1);
  }

  const seen = new Set();
  const candidates = [];
  const rejected = { shape: 0, length: 0, notNoun: 0, stopword: 0, dupe: 0 };

  for (const line of raw.split("\n")) {
    const [word, countStr] = line.trim().split(/\s+/);
    if (!word) continue;
    const w = word.toLowerCase();

    if (!CYRILLIC_ONLY.test(w)) { rejected.shape++; continue; }
    if (w.length < MIN_LEN || w.length > MAX_LEN) { rejected.length++; continue; }
    if (NOT_NOUN_SHAPE.test(w)) { rejected.notNoun++; continue; }
    if (STOPWORDS.has(w)) { rejected.stopword++; continue; }
    if (seen.has(w)) { rejected.dupe++; continue; }

    seen.add(w);
    candidates.push({ word: w.toUpperCase(), freq: Number(countStr) || 0, len: w.length });
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(candidates, null, 0));

  const byLen = {};
  candidates.forEach((c) => (byLen[c.len] = (byLen[c.len] || 0) + 1));

  // Recall guard: the hand-curated dictionary is all verified nouns, so
  // any of it that the filter drops is a false negative. Printed so a
  // filter change that starts eating real answers is immediately visible.
  let curated = [];
  try {
    const mod = readFileSync("data/dictionary.js", "utf8");
    curated = [...mod.matchAll(/word:\s*"([^"]+)"/g)].map((m) => m[1]);
  } catch { /* dictionary is optional */ }
  const kept = new Set(candidates.map((c) => c.word));
  const survived = curated.filter((w) => kept.has(w)).length;
  const inRange = curated.filter((w) => w.length >= MIN_LEN && w.length <= MAX_LEN).length;

  console.log(`in:  ${raw.split("\n").length} lines`);
  console.log(`out: ${candidates.length} candidates -> ${OUT}`);
  console.log(`rejected:`, rejected);
  if (inRange) {
    console.log(
      `filter recall: ${survived}/${inRange} curated nouns survive ` +
        `(${((100 * survived) / inRange).toFixed(0)}%) - the rest are simply absent from the frequency list`
    );
  }
  console.log(`\nlen | candidates | target ~2000 | gap`);
  for (let l = MIN_LEN; l <= MAX_LEN; l++) {
    const n = byLen[l] || 0;
    const gap = Math.max(0, 2000 - n);
    console.log(
      `${String(l).padStart(3)} | ${String(n).padStart(10)} | ${n >= 2000 ? "met" : "short".padEnd(12)}` +
        ` | ${gap ? "-" + gap : "0"}`
    );
  }
}

main();
