"""
The checks on what a number on a control cord means (maxpylang/valuecheck.py), and the
fixed ranges devicecheck now starts from: a MIDI input's, a comparison's, a tab's items.
"""

import warnings

import pytest

import maxpylang as mp
from maxpylang.devicecheck import device_problems
from maxpylang.exceptions import MessageWarning
from maxpylang.valuecheck import VALUE_KINDS, value_problems


def build(texts, cords):
    """A patch of these objects, numbered from 1, with cords (source, outlet, destination, inlet)."""
    patch = mp.MaxPatch(verbose=False)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        objs = [patch.place(text, verbose=False)[0] for text in texts]
        for source, outlet, dest, inlet in cords:
            patch.connect([objs[source - 1].outs[outlet], objs[dest - 1].ins[inlet]], verbose=False)
    return patch, objs


def kinds(texts, cords):
    patch, _ = build(texts, cords)
    return sorted(problem.kind for problem in value_problems(patch.get_json()["patcher"]))


VOICE = ["notein", "adsr~ 10 50 0.5 200", "cycle~ 440", "*~", "ezdac~"]
VOICE_CORDS = [(3, 0, 4, 0), (2, 0, 4, 1), (4, 0, 5, 0)]


# ── envelope level ──────────────────────────────────────────────────────────────

def test_velocity_straight_into_adsr():
    assert kinds(VOICE, [(1, 1, 2, 0)] + VOICE_CORDS) == ["envelope level"]


def test_a_clip_after_it_does_not_excuse_it():
    texts = VOICE[:4] + ["clip~ -1. 1.", "plugout~"]
    assert kinds(texts, [(1, 1, 2, 0), (3, 0, 4, 0), (2, 0, 4, 1), (4, 0, 5, 0), (5, 0, 6, 0)]) == ["envelope level"]


@pytest.mark.parametrize("texts, cords", [
    # scaled to 0 to 1 before the adsr~
    (["notein", "/ 127.", "adsr~", "cycle~", "*~", "ezdac~"],
     [(1, 1, 2, 0), (2, 0, 3, 0), (4, 0, 5, 0), (3, 0, 5, 1), (5, 0, 6, 0)]),
    # scaled back after it
    (["notein", "adsr~", "*~ 0.007874", "ezdac~"], [(1, 1, 2, 0), (2, 0, 3, 0), (3, 0, 4, 0)]),
    (["notein", "adsr~", "/~ 127.", "ezdac~"], [(1, 1, 2, 0), (2, 0, 3, 0), (3, 0, 4, 0)]),
    # a volume control after it may be turned down
    (["notein", "adsr~", "cycle~", "*~", "gain~", "ezdac~"],
     [(1, 1, 2, 0), (3, 0, 4, 0), (2, 0, 4, 1), (4, 0, 5, 0), (5, 0, 6, 0)]),
    # leaves through a voice outlet: the parent may scale it
    (["notein", "adsr~", "out~ 1"], [(1, 1, 2, 0), (2, 0, 3, 0)]),
    # a toggle sends 0 or 1
    (["toggle", "adsr~", "ezdac~"], [(1, 0, 2, 0), (2, 0, 3, 0)]),
    # what arrives is not known
    (["r level", "adsr~", "ezdac~"], [(1, 0, 2, 0), (2, 0, 3, 0)]),
])
def test_envelope_left_alone(texts, cords):
    assert kinds(texts, cords) == []


# ── always zero ─────────────────────────────────────────────────────────────────

def test_whole_divide_that_never_reaches_its_divisor():
    assert kinds(["ctlin", "/ 1000", "flonum"], [(1, 0, 2, 0), (2, 0, 3, 0)]) == ["always zero"]


@pytest.mark.parametrize("texts", [
    ["ctlin", "/ 1000.", "flonum"],     # float divide
    ["ctlin", "/ 127", "flonum"],       # reaches the divisor: 0 or 1, a switch
    ["ctlin", "/ 16", "flonum"],        # a row number
    ["r x", "/ 1000", "flonum"],        # not known
])
def test_divide_left_alone(texts):
    assert kinds(texts, [(1, 0, 2, 0), (2, 0, 3, 0)]) == []


# ── scale input ─────────────────────────────────────────────────────────────────

def test_bendin_into_a_14_bit_scale():
    assert kinds(["bendin", "scale 0 16383 -2. 2."], [(1, 0, 2, 0)]) == ["scale input"]


@pytest.mark.parametrize("texts", [
    ["xbendin", "scale 0 16383 -2. 2."],   # 14 bits arrive
    ["bendin", "scale 0 127 -2. 2."],
    ["ctlin", "scale 0 255 0. 1."],        # twice as wide: not far off
])
def test_scale_left_alone(texts):
    assert kinds(texts, [(1, 0, 2, 0)]) == []


def test_scale_whose_range_is_set_by_a_cord_is_left_alone():
    assert kinds(["bendin", "scale 0 16383 -2. 2.", "flonum"], [(1, 0, 2, 0), (3, 0, 2, 2)]) == []


# ── swapped inlets ──────────────────────────────────────────────────────────────

NOTE_GATE = ["notein", "> 0", "gate 1", "mtof"]


def test_pitch_into_the_control_inlet_and_the_flag_into_the_data_inlet():
    assert kinds(NOTE_GATE, [(1, 0, 3, 0), (1, 1, 2, 0), (2, 0, 3, 1), (3, 0, 4, 0)]) == ["swapped inlets"]


def test_gate_with_two_outlets():
    texts = ["random 16", "toggle", "+ 1", "gate 2"]
    assert kinds(texts, [(1, 0, 4, 0), (2, 0, 3, 0), (3, 0, 4, 1)]) == ["swapped inlets"]


@pytest.mark.parametrize("cords", [
    [(1, 0, 3, 1), (1, 1, 2, 0), (2, 0, 3, 0), (3, 0, 4, 0)],   # the right way round
    [(1, 1, 3, 0), (1, 0, 3, 1), (3, 0, 4, 0)],                 # a velocity opens it: any non-zero does
])
def test_gate_left_alone(cords):
    assert kinds(NOTE_GATE, cords) == []


def test_gate_with_a_wide_control_and_unknown_data_is_left_alone():
    assert kinds(["notein", "r data", "gate 1"], [(1, 0, 3, 0), (2, 0, 3, 1)]) == []


# ── off by one ──────────────────────────────────────────────────────────────────

def tab_into(text, items):
    patch = mp.MaxPatch(verbose=False)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        tab = patch.place("live.tab", verbose=False)[0]
        tab.parameter("Wave", options=items)
        chooser = patch.place(text, verbose=False)[0]
        patch.connect([tab.outs[0], chooser.ins[0]], verbose=False)
    return sorted(problem.kind for problem in value_problems(patch.get_json()["patcher"]))


def test_tab_straight_into_a_selector():
    assert tab_into("selector~ 3", ["Sine", "Saw", "Square"]) == ["off by one"]


def test_tab_with_an_off_item_is_left_alone():
    # four items into three inputs: the first is "off", which is what 0 does
    assert tab_into("selector~ 3", ["Off", "Sine", "Saw", "Square"]) == []


# ── the ranges devicecheck starts from ──────────────────────────────────────────

def test_a_velocity_into_a_resonance_inlet_is_out_of_range():
    patch, _ = build(["notein", "lores~ 400 0.5"], [(1, 1, 2, 2)])
    found = [p for p in device_problems(patch.get_json()["patcher"]) if p.kind == "value range"]
    assert len(found) == 1 and "0 to 127" in found[0].message and "0 to 1" in found[0].message


def test_a_scaled_velocity_fits():
    patch, _ = build(["notein", "/ 127.", "lores~ 400 0.5"], [(1, 1, 2, 0), (2, 0, 3, 2)])
    assert [p for p in device_problems(patch.get_json()["patcher"]) if p.kind == "value range"] == []


def test_a_toggle_that_is_sent_numbers_has_no_known_range():
    # a toggle passes on whatever number it gets
    assert kinds(["notein", "toggle", "adsr~", "ezdac~"], [(1, 1, 2, 0), (2, 0, 3, 0), (3, 0, 4, 0)]) == []


# ── save() ──────────────────────────────────────────────────────────────────────

def test_save_warns(tmp_path):
    patch, _ = build(VOICE, [(1, 1, 2, 0)] + VOICE_CORDS)
    with pytest.warns(MessageWarning, match="envelope's amplitude"):
        patch.save(str(tmp_path / "voice"), verbose=False)


def test_kinds_are_message_kinds():
    from maxpylang.graphcheck import MESSAGE_KINDS
    assert set(VALUE_KINDS) <= set(MESSAGE_KINDS)
