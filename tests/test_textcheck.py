"""
The checks on what is typed in a box (maxpylang/textcheck.py), and the two start rules
that go with them in startcheck.py: a jit.world that only gets bangs, and an importmovie
with no bang after it.
"""

import warnings

import pytest

import maxpylang as mp
from maxpylang.startcheck import start_problems
from maxpylang.textcheck import TEXT_KINDS, text_problems


def build(texts, cords):
    patch = mp.MaxPatch(verbose=False)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        objs = [patch.place(text, verbose=False)[0] for text in texts]
        for source, outlet, dest, inlet in cords:
            patch.connect([objs[source - 1].outs[outlet], objs[dest - 1].ins[inlet]], verbose=False)
    return patch.get_json()["patcher"]


def kinds(texts, cords, find=text_problems):
    return sorted(problem.kind for problem in find(build(texts, cords)))


# ── envelope message ────────────────────────────────────────────────────────────

@pytest.mark.parametrize("message", ["1 40, 0 160", "0.25 10, 0.0 180", "0, 1 50, 0 50 50", "1 5 0, 0 5 120"])
def test_a_ramp_cut_short_by_the_next_message(message):
    assert kinds([f"message {message}", "line~", "*~"], [(1, 0, 2, 0), (2, 0, 3, 1)]) == ["envelope message"]


@pytest.mark.parametrize("message", [
    "0, 1 40 0 160",      # a jump, then one message with every step
    "1 40 0 160",
    "0, 1 40",            # a jump and a ramp
    "1, 0 200",           # jump to 1, fall to 0: a pluck
    "0 0, 1 40",          # a ramp of no time is a jump
    "1 40",
    "$1 40, 0 160",       # filled in later: not judged
    "set 1, 0 100",
])
def test_envelope_left_alone(message):
    assert kinds([f"message {message}", "line~", "*~"], [(1, 0, 2, 0), (2, 0, 3, 1)]) == []


def test_only_line_and_curve_are_judged():
    assert kinds(["message 1 40, 0 160", "pack 0 0"], [(1, 0, 2, 0)]) == []
    assert kinds(["message 1 40, 0 160", "curve~"], [(1, 0, 2, 0)]) == ["envelope message"]


def test_a_message_repeated_in_every_voice_is_reported_once():
    texts = ["message 1 40, 0 160", "line~", "message 1 40, 0 160", "line~"]
    found = text_problems(build(texts, [(1, 0, 2, 0), (3, 0, 4, 0)]))
    assert len(found) == 1 and len(found[0].nodes) == 3
    assert "`0, 1 40 0 160`" in found[0].message


# ── expression ──────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("text", [
    "jit.expr 255.0 * (in1.r > 120.)",
    "jit.expr (in[0]>0.5)*255",
    "jit.expr 4 char 255*(in[0].p[1]>150)",
    "jit.expr @expr in1*0.5",
    "jit.expr @inputs 2 @expr 255. * (in1 > 150.) * (in2 < 120.)",
])
def test_an_expression_jit_expr_cannot_read(text):
    assert kinds([text], []) == ["expression"]


@pytest.mark.parametrize("text", [
    "jit.expr",
    "jit.expr @expr in[0]*2-1",
    "jit.expr @expr snorm[0]*4 snorm[1]*4 snorm[2]*4",
    "jit.expr 3 float32 64 64 @expr norm[0]",
    "jit.expr @inputs 2 @expr in[0]*in[1]",
])
def test_expression_left_alone(text):
    assert kinds([text], []) == []


# ── jit.world and jit.matrix, in startcheck ─────────────────────────────────────

def starts(texts, cords):
    return [p.message for p in start_problems(build(texts, cords)) if p.kind == "never starts"]


def test_a_world_that_only_gets_a_bang():
    found = starts(["loadbang", "jit.world"], [(1, 0, 2, 0)])
    assert len(found) == 1 and "one frame" in found[0]


def test_a_world_that_gets_other_messages_and_no_enable():
    found = starts(["message erase_color 0 0 0 1", "jit.world"], [(1, 0, 2, 0)])
    assert len(found) == 1 and "never enabled" in found[0]


@pytest.mark.parametrize("texts", [
    ["toggle", "jit.world"],
    ["message enable 1", "jit.world"],
    ["loadmess 1", "jit.world"],
    ["loadbang", "jit.world @enable 1"],
    ["r start", "jit.world"],
])
def test_world_left_alone(texts):
    assert starts(texts, [(1, 0, 2, 0)]) == []


def test_importmovie_with_no_bang():
    found = starts(["message importmovie picture.png", "jit.matrix 4 char 64 64", "jit.pwindow"],
                   [(1, 0, 2, 0), (2, 0, 3, 0)])
    assert len(found) == 1 and "importmovie" in found[0]


@pytest.mark.parametrize("texts, cords", [
    (["message importmovie picture.png, bang", "jit.matrix", "jit.pwindow"], [(1, 0, 2, 0), (2, 0, 3, 0)]),
    (["message importmovie picture.png", "jit.matrix", "jit.pwindow", "button"],
     [(1, 0, 2, 0), (2, 0, 3, 0), (4, 0, 2, 0)]),
    (["message importmovie picture.png", "jit.matrix", "jit.pwindow", "jit.rgb2luma"],
     [(1, 0, 2, 0), (2, 0, 3, 0), (4, 0, 2, 0)]),
    (["message importmovie picture.png", "jit.matrix"], [(1, 0, 2, 0)]),   # read elsewhere by name
])
def test_importmovie_left_alone(texts, cords):
    assert starts(texts, cords) == []


def test_kinds_are_message_kinds():
    from maxpylang.graphcheck import MESSAGE_KINDS
    assert set(TEXT_KINDS) <= set(MESSAGE_KINDS)
