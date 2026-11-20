"""Export every reference example for checking in real Max.

Writes docs-site/max-check/:
  patches/<stub>-<n>.maxpat   every example's patch, ready to open in Max
  checklist.csv               one row per example: what it should do, the known
                              mismatches from the claim tests, open questions only Max can
                              answer, and empty columns to fill in after trying it

Run after scripts/build_examples.py (it reads src/generated/examples.json):

    python scripts/export_for_max.py

The checklist opens in Excel, Numbers or Google Sheets (File > Import).
"""

import csv
import json
import re
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent
OUT = SITE / "max-check"

# Questions the claim tests could not settle without Max, by example. Each came from the
# audit (see the claim tests and PR #36's description).
OPEN_QUESTIONS = {
    "curve~/0": "Which way does a positive curve (0.8) bend a falling segment: drops fast then lingers, or holds then drops?",
    "mc.curve~/0": "Which way does a positive curve (0.8) bend a falling segment: drops fast then lingers, or holds then drops?",
    "drunk/0": "Can drunk 24 3 output 24? Is each step at most 2 (the reference says less than 3)?",
    "urn/0": "Does urn bang its right outlet straight after the 8th number, or on the next bang?",
    "live.dial/0": "Does live.dial send a value when the patch opens? (The browser sends 0, so it starts at 200 Hz.)",
    "lores~/0": "How sharp is the resonance at 0.7? Is there a clear peak at the cutoff?",
    "lores~/1": "Does the sweep start at the top (1700 Hz), as a cosine LFO would?",
    "noise~/1": "Is there an audible resonant peak (pitch-like colour) at resonance 0.9?",
    "mc.lores~/0": "How strong is the resonance at 0.8?",
    "key/0": "Does pressing a send 97 (ASCII) out the left outlet?",
    "jit.brcosa/0": "Compare the picture with the page: is contrast centred on the image's average brightness?",
    "jit.3m/0": "Are min and max exactly 0 and 255 for a full-range picture? Does the pitch follow brightness?",
    "dict.serialize/0": "What exact text does dict.serialize send (freq : 330 or freq: 330)?",
    "number~/0": "What is number~'s default output interval?",
    "tempo/0": "tempo 60 1 8: one step every 500 ms? Does the count wrap at 8?",
    "qmetro/0": "Does qmetro bang at once when started? Does a new interval apply at once or after the next bang?",
    "pictslider/0": "What are pictslider's default ranges?",
    "matrixctrl/0": "Does the 8x8 grid fit the box as saved?",
    "record~/0": "With Max's own drumLoop.aif, does each take grab a different part of the loop?",
    "playlist~/0": "Do the clips (bd+hh.aiff…) load from Max's media folder?",
    "onebang/0": "With two metros starting together, is there an extra note at 0.1 s?",
    "pv/0": "Open two copies of the patch: do their pv values stay separate?",
    "flush/0": "Do the notes overlap as described, or does the first flush cut them short?",
    "split/0": "Do both oscillators sound all the time (each holding its last note)?",
}

DESCRIBE = re.compile(r"""describe\(\s*(['"`])((?:\\.|(?!\1).)*)\1""")
FAILS = re.compile(r"""it\.fails\(\s*(['"`])((?:\\.|(?!\1).)*)\1""")


def known_mismatches():
    """it.fails titles from the claim tests, by example ("object/index")."""
    found = {}
    for path in sorted((SITE / "test" / "browser").glob("claims-[0-9]*.test.ts")):
        current = None
        for line in path.read_text().splitlines():
            m = DESCRIBE.search(line)
            if m:
                current = m.group(2).split(":")[0].strip()
            m = FAILS.search(line)
            if m and current:
                text = m.group(2).replace("\\'", "'").replace('\\"', '"')
                found.setdefault(current, []).append(f"{text}  [{path.name}]")
    return found


def category_of():
    cats = json.loads((SITE / "content" / "categories.json").read_text())["categories"]
    return {o: c["name"] for c in cats for o in c["objects"]}


def main():
    examples = json.loads((SITE / "src" / "generated" / "examples.json").read_text())
    patches = OUT / "patches"
    patches.mkdir(parents=True, exist_ok=True)
    for old in patches.glob("*.maxpat"):
        old.unlink()
    bugs = known_mismatches()
    where = category_of()

    rows = []
    for e in sorted(examples, key=lambda e: (where.get(e["object"], "Multichannel" if e["object"].startswith("mc.") else "Other"), e["object"], e["index"])):
        key = f"{e['object']}/{e['index']}"
        name = f"{e['stub']}-{e['index']}.maxpat"
        (patches / name).write_text(json.dumps(e["patch"], indent=1))
        rows.append({
            "category": where.get(e["object"], "Multichannel" if e["object"].startswith("mc.") else "Other"),
            "example": key,
            "title": e["title"],
            "what it should do": e["note"],
            "file to open": f"patches/{name}",
            "known mismatches (from the tests)": "\n".join(bugs.get(key, [])),
            "question for Max": OPEN_QUESTIONS.get(key, ""),
            "matches the text in Max? (yes / no / partly)": "",
            "what Max does (notes)": "",
            "checked by": "",
        })

    with open(OUT / "checklist.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)

    with_bugs = sum(1 for r in rows if r["known mismatches (from the tests)"])
    with_q = sum(1 for r in rows if r["question for Max"])
    print(f"{len(rows)} patches -> {patches.relative_to(SITE.parent)}")
    print(f"checklist: {len(rows)} rows, {with_bugs} with known mismatches, {with_q} with a question for Max -> {(OUT / 'checklist.csv').relative_to(SITE.parent)}")


if __name__ == "__main__":
    main()
