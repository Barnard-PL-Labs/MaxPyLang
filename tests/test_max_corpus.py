"""
Max's own shipped patchers through the runtime cord rule. None of their cords may be
flagged: they are Cycling '74's working patches, so any problem found is a false alarm in
the type data. Skipped where Max is not installed, as in CI. Set MAXPYLANG_C74 to another
install's Contents/Resources/C74 folder to use it.
"""

import json
import os
from pathlib import Path

import pytest

from maxpylang.cordcheck import AUDIO, judge, rate_of

_CANDIDATES = [os.environ.get("MAXPYLANG_C74"), "/Applications/Max.app/Contents/Resources/C74"]
C74 = next((Path(p) for p in _CANDIDATES if p and Path(p).is_dir()), None)

pytestmark = pytest.mark.skipif(C74 is None, reason="Max is not installed")

_ALIASES = json.loads((Path(__file__).resolve().parents[1] / "maxpylang" / "data" / "OBJ_INFO"
                       / "obj_aliases.json").read_text())


def box_name(box):
    """A box's object name as the type data spells it: `*~` is times~, `t` is trigger."""
    if box.get("maxclass") == "newobj":
        words = (box.get("text") or "").split()
        name = words[0] if words else ""
    else:
        name = box.get("maxclass", "")
    return _ALIASES.get(name, name)


def max_patchers(node):
    """Every patcher, nested ones included, whose boxes are Max objects. gen~ and RNBO
    patchers hold their own operators (`+` there is per sample), so they are skipped
    along with everything inside them."""
    if isinstance(node, dict):
        if "boxes" in node and "lines" in node:
            if node.get("classnamespace", "box") != "box":
                return
            yield node
        for value in node.values():
            yield from max_patchers(value)
    elif isinstance(node, list):
        for value in node:
            yield from max_patchers(value)


def corpus():
    """(path, patcher) for every patcher in Max's shipped .maxpat and .maxhelp files."""
    for path in sorted(C74.rglob("*")):
        if path.suffix not in (".maxpat", ".maxhelp"):
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8", errors="replace"))
        except (ValueError, OSError):
            continue
        for patcher in max_patchers(data):
            yield path, patcher


def survey_corpus():
    """Verdict counts over every shipped cord, the cords flagged, and audio outlet mismatches."""
    counts = {"files": set(), "ok": 0, "problem": 0, "unknown": 0}
    problems, audio_mismatches = [], []
    for path, patcher in corpus():
        counts["files"].add(path)
        boxes = {b["box"]["id"]: b["box"] for b in patcher["boxes"] if "box" in b}
        for line in patcher["lines"]:
            cord = line.get("patchline", {})
            (src_id, out_i), (dst_id, in_i) = cord.get("source", [None, 0]), cord.get("destination", [None, 0])
            src, dst = boxes.get(src_id), boxes.get(dst_id)
            if src is None or dst is None:
                continue
            outcome = judge(rate_of(box_name(src), "outs", out_i), rate_of(box_name(dst), "ins", in_i))
            counts[outcome] += 1
            if outcome == "problem":
                problems.append(f"{path.relative_to(C74)}: {src.get('text') or box_name(src)} outlet {out_i}"
                                f" -> {dst.get('text') or box_name(dst)} inlet {in_i}")
        for box in boxes.values():
            name, saved = box_name(box), box.get("outlettype") or []
            for i, kind in enumerate(saved):
                if rate_of(name, "outs", i) in AUDIO and kind not in ("signal", "multichannelsignal"):
                    audio_mismatches.append(f"{path.relative_to(C74)}: {name} outlet {i} saved as {kind!r}")
    counts["files"] = len(counts["files"])
    return counts, problems, audio_mismatches


@pytest.fixture(scope="module")
def survey():
    return survey_corpus()


def test_no_shipped_cord_is_flagged(survey):
    counts, problems, _ = survey
    total = counts["ok"] + counts["problem"] + counts["unknown"]
    print(f"\n{counts['files']} files, {total} cords: {counts['ok']} checked ok, "
          f"{counts['problem']} flagged, {counts['unknown']} not checked")
    assert total > 100_000, "the corpus looks incomplete"
    assert problems == [], f"{len(problems)} false alarms, e.g.\n" + "\n".join(problems[:20])


def test_no_outlet_the_data_calls_audio_is_saved_as_a_message(survey):
    _, _, mismatches = survey
    assert mismatches == [], f"{len(mismatches)} outlets, e.g.\n" + "\n".join(mismatches[:20])
