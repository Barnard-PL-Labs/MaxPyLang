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

from maxpylang.cordcheck import AUDIO, judge, outlet_rate, rate_of

_CANDIDATES = [os.environ.get("MAXPYLANG_C74"), "/Applications/Max.app/Contents/Resources/C74"]
C74 = next((Path(p) for p in _CANDIDATES if p and Path(p).is_dir()), None)

pytestmark = pytest.mark.skipif(C74 is None, reason="Max is not installed")

_ALIASES = json.loads((Path(__file__).resolve().parents[1] / "maxpylang" / "data" / "OBJ_INFO"
                       / "obj_aliases.json").read_text())


# the objects maxpylang knows: only their saved outlet types are read, as at runtime
_KNOWN = {path.stem for path in (Path(__file__).resolve().parents[1] / "maxpylang" / "data" / "OBJ_INFO").glob("*/*.json")}


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
            saved = src.get("outlettype") if box_name(src) in _KNOWN else None
            outcome = judge(outlet_rate(box_name(src), out_i, saved, "patcher" in src),
                            rate_of(box_name(dst), "ins", in_i))
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


# The one mistake of this kind Max ships. LiveUI.Map's first outlet is fed by a `+~`, and
# liveui.multimap packs eight of them with `pak i i i i i i i i`: audio into an inlet that
# takes numbers. It surfaced once a subpatcher's saved outlet types were read.
_SHIPPED_MISTAKE = "bpatcher outlet 0 -> pak i i i i i i i i inlet"


def test_no_shipped_cord_is_flagged(survey):
    counts, problems, _ = survey
    real = [p for p in problems if _SHIPPED_MISTAKE in p]
    assert len(real) == 16 and {p.split(":")[0].rsplit("/", 1)[-1] for p in real} == {
        "Multi-Mapping.maxpat", "liveui.multimap.maxpat"}
    problems = [p for p in problems if p not in real]
    total = counts["ok"] + counts["problem"] + counts["unknown"]
    print(f"\n{counts['files']} files, {total} cords: {counts['ok']} checked ok, "
          f"{len(problems)} flagged falsely, {len(real)} flagged rightly, {counts['unknown']} not checked")
    assert total > 100_000, "the corpus looks incomplete"
    assert problems == [], f"{len(problems)} false alarms, e.g.\n" + "\n".join(problems[:20])


def test_most_shipped_cords_are_checked(survey):
    """A cord that is not checked can hide a mistake. This was 27,000 of 140,082 before an
    open outlet was read from the box's own outlet types, and 24,658 after. It is 17,445 now
    that a subpatcher's outlets and an inlet object are read from the types Max saved on
    them, and that an inlet with no documented type is read from the rest of its reference
    page. What is left is mostly inlet objects Max saved no type for, objects not in the
    database, and bpatchers kept in another file."""
    counts, _, _ = survey
    total = counts["ok"] + counts["problem"] + counts["unknown"]
    assert counts["unknown"] <= 0.13 * total, f"{counts['unknown']} of {total} shipped cords not checked"


def test_no_outlet_the_data_calls_audio_is_saved_as_a_message(survey):
    _, _, mismatches = survey
    assert mismatches == [], f"{len(mismatches)} outlets, e.g.\n" + "\n".join(mismatches[:20])


def survey_graphs():
    """Graph problems over every shipped patcher, counted by kind, with examples."""
    from maxpylang.graphcheck import find_problems, from_json
    counts = {"patchers": 0, "objects": 0, "hot loop": 0, "audio feedback": 0, "dead output": 0, "no delay line": 0,
              "patches": 0, "patches with a dead output": 0}
    examples = []
    for path, patcher in corpus():
        nodes, edges = from_json(patcher)
        counts["patchers"] += 1
        counts["objects"] += len(nodes)
        problems = find_problems(nodes, edges)
        for problem in problems:
            counts[problem.kind] += 1
            if problem.kind != "dead output":
                examples.append(f"{path.relative_to(C74)}: {problem.message}")
        # help files show objects on their own, so only the .maxpat patchers are a fair measure
        if path.suffix == ".maxpat":
            counts["patches"] += 1
            counts["patches with a dead output"] += any(p.kind == "dead output" for p in problems)
    return counts, examples


@pytest.fixture(scope="module")
def graph_survey():
    return survey_graphs()


def test_no_shipped_patch_has_a_hot_loop_or_audio_feedback(graph_survey):
    counts, examples = graph_survey
    print(f"\n{counts['patchers']} patchers, {counts['objects']} objects: {counts['hot loop']} hot loops, "
          f"{counts['audio feedback']} audio feedback, {counts['dead output']} dead outputs (help files show "
          f"objects on their own, so those are expected)")
    assert counts["objects"] > 100_000, "the corpus looks incomplete"
    assert examples == [], f"{len(examples)} false alarms, e.g.\n" + "\n".join(examples[:20])


def test_few_shipped_patches_have_a_dead_output(graph_survey):
    """Dead outputs are a heuristic, so some shipped patches are flagged: loose message boxes
    kept as notes, buttons driven by script. Before the ends were widened (UI boxes, jit.gl,
    the pattr family, thispatcher, ...) this was 1002 of 3185 patchers; it is 105 now. The
    bound catches a change that brings the false alarms back."""
    counts, _ = graph_survey
    flagged, total = counts["patches with a dead output"], counts["patches"]
    print(f"\n{flagged} of {total} shipped .maxpat patchers have a dead output")
    assert total > 1000, "the corpus looks incomplete"
    assert flagged <= 0.05 * total, f"{flagged} of {total} shipped patchers flagged"


def test_few_shipped_files_have_a_name_with_nothing_on_the_other_end():
    """A receive nothing sends to, or a groove~ with no buffer~, judged over each whole file.
    Shipped patches work, so each one found is a false alarm or a name another file supplies.
    It is 7 names in 5 of 3122 files: a loose `r` kept as a note, a name another file sends."""
    from maxpylang.graphcheck import link_problems
    files, flagged, found = 0, 0, []
    for path in sorted(C74.rglob("*")):
        if path.suffix not in (".maxpat", ".maxhelp"):
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8", errors="replace"))
        except (ValueError, OSError):
            continue
        if not isinstance(data.get("patcher"), dict):
            continue
        files += 1
        problems = link_problems(data["patcher"])
        flagged += bool(problems)
        found += [f"{path.relative_to(C74)}: {p.message}" for p in problems]
    print(f"\n{len(found)} names in {flagged} of {files} shipped files have nothing on the other end:\n"
          + "\n".join(found[:20]))
    assert files > 3000, "the corpus looks incomplete"
    assert flagged <= 0.005 * files, f"{flagged} of {files} files flagged, e.g.\n" + "\n".join(found[:20])


# ── the object database ───────────────────────────────────────────────────────

def test_few_shipped_boxes_hold_an_object_maxpylang_does_not_know():
    """Every check is silent on an object the database does not know. This was 13.6% of
    shipped boxes, then 9.0% once the Max for Live objects were imported, and it is 2.5%
    with Max's short names (p, r, s, i, f) as aliases. What is left is mostly abstractions
    that ship beside their patch, rnbo~, and objects new in Max 9."""
    database = Path(__file__).resolve().parents[1] / "maxpylang" / "data" / "OBJ_INFO"
    known = {path.stem for path in database.glob("*/*.json")} | set(_ALIASES)
    total, unknown = 0, {}
    for _, patcher in corpus():
        for box in patcher["boxes"]:
            box = box.get("box", {})
            words = (box.get("text") or "").split()
            name = (words[0] if words else "") if box.get("maxclass", "newobj") == "newobj" else box["maxclass"]
            if not name:
                continue
            total += 1
            if name not in known:
                unknown[name] = unknown.get(name, 0) + 1
    share = sum(unknown.values()) / total
    top = sorted(unknown.items(), key=lambda item: -item[1])[:15]
    print(f"\n{sum(unknown.values())} of {total} shipped boxes ({share:.1%}) hold an unknown object; most common: {top}")
    assert total > 100_000, "the corpus looks incomplete"
    assert share <= 0.04, f"{share:.1%} of shipped boxes hold an unknown object"
    assert not [name for name in unknown if name.startswith("live.") and unknown[name] > 200]


def test_inlets_read_from_an_expression_or_format_match_the_shipped_boxes():
    """expr, vexpr and if take one inlet per $ index, sprintf one per format specifier, and
    `if ... out2` has a second outlet. An expr with no $ is left out: gen~ has an expr of
    its own (in1 + in2), and some gen patchers are saved without their namespace."""
    import warnings

    import maxpylang as mp

    wrong, checked = [], 0
    for path, patcher in corpus():
        for box in patcher["boxes"]:
            box = box.get("box", {})
            text = box.get("text") or ""
            words = text.split()
            if box.get("maxclass") != "newobj" or not words or words[0] not in ("expr", "vexpr", "if", "sprintf"):
                continue
            if "numinlets" not in box or len(words) < 2 or (words[0] == "expr" and "$" not in text):
                continue
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                obj = mp.MaxObject(text.split(" @")[0])
            checked += 1
            if (len(obj.ins), len(obj.outs)) != (box["numinlets"], box["numoutlets"]):
                wrong.append(f"{path.relative_to(C74)}: {text!r} has {box['numinlets']} in, {box['numoutlets']} out;"
                             f" maxpylang gives {len(obj.ins)} in, {len(obj.outs)} out")
    print(f"\n{checked} shipped expr, vexpr, if and sprintf boxes checked")
    assert checked > 500, "the corpus looks incomplete"
    assert wrong == [], f"{len(wrong)} boxes, e.g.\n" + "\n".join(wrong[:20])


def test_switch_and_receive_counts_match_the_shipped_boxes():
    """switch has one inlet more than its first argument, whatever follows it, and a receive
    with a name has no inlet."""
    import contextlib
    import io

    import maxpylang as mp

    wrong, checked = [], 0
    for path, patcher in corpus():
        for box in patcher["boxes"]:
            box = box.get("box", {})
            text = box.get("text") or ""
            words = text.split()
            if box.get("maxclass") != "newobj" or len(words) < 2 or "numinlets" not in box:
                continue
            if _ALIASES.get(words[0], words[0]) not in ("switch", "receive"):
                continue
            with contextlib.redirect_stdout(io.StringIO()):
                obj = mp.MaxObject(text.split(" @")[0])
            checked += 1
            if (len(obj.ins), len(obj.outs)) != (box["numinlets"], box["numoutlets"]):
                wrong.append(f"{path.relative_to(C74)}: {text!r} has {box['numinlets']} in, {box['numoutlets']} out;"
                             f" maxpylang gives {len(obj.ins)} in, {len(obj.outs)} out")
    print(f"\n{checked} shipped switch and receive boxes checked")
    assert checked > 1000, "the corpus looks incomplete"
    assert wrong == [], f"{len(wrong)} boxes, e.g.\n" + "\n".join(wrong[:20])


# Their inlets and outlets come from a file or a subpatch that is not there in a test.
_BUILT_FROM_A_FILE = {"js", "jsui", "v8", "v8ui", "patcher", "bpatcher", "poly~", "pfft~", "gen", "gen~", "jit.gen",
                      "jit.pix", "jit.gl.pix", "rnbo~", "mxj", "mxj~", "node.script", "vst~", "mc.gen~", "mc.poly~",
                      "mc.pfft~", "mcs.gen~", "mcs.poly~"}


def test_few_shipped_boxes_have_arguments_maxpylang_rejects():
    """An object whose arguments are rejected is built with no inlets or outlets, so every
    cord on it is lost. These boxes all work in Max. Before quoted strings, time values,
    patcher arguments and the really-required counts this was close to 500 of the 45,000
    boxes with arguments; it is 64 now, all of them gen operators (cycle, `* samplerate`) in gen
    patchers saved without their namespace, and one box with a stray comma."""
    import contextlib
    import io
    import warnings

    import maxpylang as mp

    database = Path(__file__).resolve().parents[1] / "maxpylang" / "data" / "OBJ_INFO"
    known = {path.stem for path in database.glob("*/*.json")} - _BUILT_FROM_A_FILE
    verdicts, total, rejected = {}, 0, {}
    for _, patcher in corpus():
        for box in patcher["boxes"]:
            box = box.get("box", {})
            text = (box.get("text") or "").split(" @")[0]
            words = text.split()
            if box.get("maxclass") != "newobj" or len(words) < 2 or "numinlets" not in box:
                continue
            name = _ALIASES.get(words[0], words[0])
            if name not in known:
                continue
            if text not in verdicts:
                with contextlib.redirect_stdout(io.StringIO()), warnings.catch_warnings():
                    warnings.simplefilter("ignore")
                    verdicts[text] = mp.MaxObject(text).notknown()
            total += 1
            if verdicts[text]:
                rejected[name] = rejected.get(name, 0) + 1
    count = sum(rejected.values())
    print(f"\n{count} of {total} shipped boxes with arguments are rejected: {rejected}")
    assert total > 40_000, "the corpus looks incomplete"
    assert count <= 0.002 * total, f"{count} of {total} rejected: {rejected}"
    assert set(rejected) <= {"cycle", "times", "rdiv", "wave~"}, rejected


def test_counts_that_follow_the_arguments_match_the_shipped_boxes():
    """Every box with arguments and no attributes in a patch saved by Max 8 or 9, against
    the counts maxpylang gives the same text. Older patches are left out because some
    objects have gained outlets since (dict, info~). Before the rules for selector~,
    dict.pack, the MIDI inputs, adc~ and the rest this was 401 of 19,433 boxes; it is 31."""
    import contextlib
    import io
    import warnings

    import maxpylang as mp

    database = Path(__file__).resolve().parents[1] / "maxpylang" / "data" / "OBJ_INFO"
    known = {path.stem for path in database.glob("*/*.json")} - _BUILT_FROM_A_FILE
    built, total, wrong = {}, 0, {}
    for path in sorted(C74.rglob("*")):
        if path.suffix not in (".maxpat", ".maxhelp"):
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8", errors="replace"))
        except (ValueError, OSError):
            continue
        if (data.get("patcher", {}).get("appversion") or {}).get("major", 0) < 8:
            continue
        for patcher in max_patchers(data):
            for box in patcher["boxes"]:
                box = box.get("box", {})
                text = box.get("text") or ""
                words = text.split()
                if box.get("maxclass") != "newobj" or len(words) < 2 or "numinlets" not in box or " @" in text:
                    continue
                name = _ALIASES.get(words[0], words[0])
                if name not in known:
                    continue
                if text not in built:
                    with contextlib.redirect_stdout(io.StringIO()), warnings.catch_warnings():
                        warnings.simplefilter("ignore")
                        obj = mp.MaxObject(text)
                    built[text] = None if obj.notknown() else (len(obj.ins), len(obj.outs))
                if built[text] is None:
                    continue
                total += 1
                if built[text] != (box["numinlets"], box["numoutlets"]):
                    wrong[name] = wrong.get(name, 0) + 1
    count = sum(wrong.values())
    print(f"\n{count} of {total} shipped boxes with arguments have other counts in Max: {wrong}")
    assert total > 15_000, "the corpus looks incomplete"
    assert count <= 0.005 * total, f"{count} of {total}: {wrong}"
