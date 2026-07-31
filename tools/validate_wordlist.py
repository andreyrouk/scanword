# -*- coding: utf-8 -*-
"""
Validator for the scanword word/clue list.
Usage: python3 validate_wordlist.py path/to/batch.csv

Checks every row against the four rules:
1. Word: Ukrainian (Cyrillic) letters only, apostrophes stripped.
   Apostrophes are a normal part of Ukrainian spelling (м'яч, п'ять,
   комп'ютер, сім'я) and should NOT disqualify a word — strip the
   apostrophe character and use the remaining letters as the answer
   (м'яч -> мяч). Spaces and hyphens are still invalid: those usually
   signal a multi-word or compound name, and naively concatenating
   them produces a fake word, not a real single answer.
2. Word length: 3-12 letters (measured AFTER apostrophe stripping).
3. Clue must not contain the answer word itself, or an obvious stem of it
   (checked as: first 5 letters of the word for words >=5 letters,
   first 4 letters for shorter words).
4. Clue length: <= 70 characters.

Also flags:
- Duplicate words *within the same batch* (duplicates across the whole
  master list are fine and expected -- a word can recur with a different
  clue/meaning -- the puzzle generator handles not reusing a word within
  a single puzzle).
- Any non-Ukrainian stray characters in the clue text (e.g. accidental
  Roman numerals, Latin letters, or leftover formatting artifacts).

IMPORTANT: this script expects the `word` column to already have
apostrophes stripped (i.e. do the stripping at generation time, before
writing the CSV) — it validates the cleaned word, it does not clean it
for you. If a raw dictionary source still has apostrophes in it, strip
all of ' ’ ʼ ` from the word before this check runs.

Exit code is 0 if the batch is fully clean, 1 otherwise, so this can be
used as a gate in a generation loop (generate -> validate -> fix failing
rows -> re-validate -> append to master only once clean).
"""
import csv
import sys
from collections import Counter


def stem(word: str, n: int) -> str:
    return word[:n].upper()


def is_ok_clue_char(ch: str) -> bool:
    if ch.isspace():
        return True
    if ch in ",.'\"-()0123456789ʼ’":
        return True
    up = ch.upper()
    if 'А' <= up <= 'Я':
        return True
    if up in 'ІЇЄҐ':
        return True
    return False


def check_word_chars(word: str) -> list:
    problems = []
    if any(ch in word for ch in " -"):
        problems.append("word contains a space or hyphen (multi-word/compound names aren't valid single answers)")
    if any(ch in word for ch in "'’ʼ`"):
        problems.append("word still contains an apostrophe — strip it before writing to the CSV (м'яч -> мяч)")
    for ch in word:
        if ch in "'’ʼ`":
            continue
        up = ch.upper()
        if not (('А' <= up <= 'Я') or up in 'ІЇЄҐ'):
            problems.append(f"word contains non-Ukrainian character: {ch!r}")
            break
    return problems


def validate_rows(rows):
    """rows: list of dicts with 'word' and 'clue' keys. Returns (clean_count, issues)."""
    issues = []
    seen = Counter()
    for i, r in enumerate(rows, start=2):  # start=2 to match CSV line numbers (1 = header)
        w = r['word'].strip()
        cl = r['clue'].strip()
        problems = []

        problems += check_word_chars(w)

        if len(w) < 3 or len(w) > 12:
            problems.append(f"word length out of range ({len(w)})")

        if len(cl) > 70:
            problems.append(f"clue too long ({len(cl)} chars)")

        cl_upper, w_upper = cl.upper(), w.upper()
        if w_upper in cl_upper:
            problems.append("clue contains the full answer word")
        else:
            n = 5 if len(w_upper) >= 5 else 4
            st = stem(w_upper, n)
            if len(st) >= 4 and st in cl_upper:
                problems.append(f"clue contains an obvious stem of the word ({st!r})")

        stray = set(ch for ch in cl if not is_ok_clue_char(ch))
        if stray:
            problems.append(f"clue has stray/non-Ukrainian characters: {stray}")

        seen[w] += 1
        if problems:
            issues.append((i, w, cl, problems))

    dupes_in_batch = [w for w, n in seen.items() if n > 1]
    return issues, dupes_in_batch


def main():
    if len(sys.argv) != 2:
        print("Usage: python3 validate_wordlist.py path/to/batch.csv")
        sys.exit(2)

    path = sys.argv[1]
    with open(path, encoding='utf-8-sig') as f:
        rows = list(csv.DictReader(f))

    print(f"Loaded {len(rows)} rows from {path}")

    issues, dupes = validate_rows(rows)

    if dupes:
        print(f"\nDuplicate words WITHIN this batch ({len(dupes)}):")
        for d in dupes:
            print(" ", d)

    if issues:
        print(f"\nRule violations ({len(issues)} rows):")
        for line_no, w, cl, problems in issues:
            print(f"  line {line_no}: {w!r} -> {cl!r}")
            for p in problems:
                print(f"      - {p}")
    else:
        print("\nNo rule violations found.")

    ok = not issues and not dupes
    print(f"\nRESULT: {'CLEAN' if ok else 'NEEDS FIXES'}")
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
