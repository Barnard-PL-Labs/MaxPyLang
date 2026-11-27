"""
The checks for a patch that is wired correctly and never starts (maxpylang/startcheck.py),
and the attribute rules they rest on.

The rules come from a benchmark of agents writing patches: see the module's docstring.
tests/test_max_corpus.py runs them over every patch that ships with Max. This file covers
what is reported, and what is left alone because it cannot be seen.
"""

import os
import warnings

import pytest

import maxpylang as mp
from maxpylang.startcheck import start_problems


def patch_of(*texts, cords=()):
    """A patch of these objects, numbered from 1, with cords (source, outlet, destination, inlet)."""
    patch = mp.MaxPatch(verbose=False)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        objs = [patch.place(text, verbose=False)[0] for text in texts]
        for source, outlet, dest, inlet in cords:
            patch.connect([objs[source - 1].outs[outlet], objs[dest - 1].ins[inlet]], verbose=False)
    return patch


def found(patch, folders=()):
    return [(problem.kind, problem.message) for problem in start_problems(patch.get_json()["patcher"], folders)]


def kinds(patch, folders=()):
    return [kind for kind, _ in found(patch, folders)]


# ── never starts ────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("texts, cords, says", [
    (("jit.grab", "jit.pwindow"), [(1, 0, 2, 0)], "only when it gets a bang"),
    (("metro 100", "counter"), [(1, 0, 2, 0)], "never switched on"),
    (("tempo 120", "counter"), [(1, 0, 2, 0)], "never switched on"),
    (("jit.world",), [], "never enabled"),
    (("transport", "flonum"), [(1, 4, 2, 0)], "only when it gets a bang"),
    (("toggle", "transport", "flonum"), [(1, 0, 2, 0), (2, 4, 3, 0)], "never a bang"),
    (("cycle~ 220", "jit.catch~", "jit.pwindow"), [(1, 0, 2, 0), (2, 0, 3, 0)], "only audio"),
    (("buffer~ snd", "groove~ snd", "ezdac~"), [(2, 0, 3, 0)], "speed is 0"),
    (("flonum", "groove~ snd", "ezdac~"), [(1, 0, 2, 0), (2, 0, 3, 0)], "not how fast"),
    (("waveform~",), [], "never told which buffer~"),
    (("message buftime", "waveform~"), [(1, 0, 2, 0)], "never told which buffer~"),
])
def test_an_object_that_nothing_starts_is_reported(texts, cords, says):
    reports = found(patch_of(*texts, cords=cords))
    assert [kind for kind, _ in reports] == ["never starts"], reports
    assert says in reports[0][1]


@pytest.mark.parametrize("texts, cords", [
    # something reaches the left inlet
    (("qmetro 33 @active 1", "jit.grab", "jit.pwindow"), [(1, 0, 2, 0), (2, 0, 3, 0)]),
    (("toggle", "metro 100", "counter"), [(1, 0, 2, 0), (2, 0, 3, 0)]),
    # on by an attribute
    (("metro 100 @active 1", "counter"), [(1, 0, 2, 0)]),
    (("jit.world @enable 1",), []),
    (("jit.world @enable 0", "toggle"), [(2, 0, 1, 0)]),
    # a jit.world in the patch makes a jit.movie send on its own
    (("jit.world @enable 1", "jit.movie", "jit.gl.videoplane"), [(2, 0, 3, 0)]),
    # nothing reads from it: the dead output check has this one
    (("metro 100",), []),
    (("jit.grab",), []),
    # a bang does reach it
    (("cycle~ 220", "qmetro 33 @active 1", "jit.catch~", "jit.pwindow"), [(1, 0, 3, 0), (2, 0, 3, 0), (3, 0, 4, 0)]),
    (("metro 100 @active 1", "transport", "flonum"), [(1, 0, 2, 0), (2, 4, 3, 0)]),
    # a speed signal
    (("sig~ 1.", "groove~ snd", "ezdac~"), [(1, 0, 2, 0), (2, 0, 3, 0)]),
    # what a subpatcher's inlet carries is not known
    (("inlet", "groove~ snd", "ezdac~"), [(1, 0, 2, 0), (2, 0, 3, 0)]),
    # told its buffer
    (("waveform~ @buffername snd",), []),
    (("message set snd", "waveform~"), [(1, 0, 2, 0)]),
    # a message with $1 in it could be a set
    (("message $1 $2", "waveform~"), [(1, 0, 2, 0)]),
])
def test_what_is_started_or_cannot_be_seen_is_left_alone(texts, cords):
    assert kinds(patch_of(*texts, cords=cords)) == []


# ── set and a number into a buffer reader ───────────────────────────────────────

@pytest.mark.parametrize("texts, cords", [
    (("message set 0", "sig~ 1.", "groove~ snd", "ezdac~"), [(1, 0, 3, 0), (2, 0, 3, 0), (3, 0, 4, 0)]),
    (("flonum", "message set $1", "sig~ 1.", "groove~ snd", "ezdac~"),
     [(1, 0, 2, 0), (2, 0, 4, 0), (3, 0, 4, 0), (4, 0, 5, 0)]),
    (("number", "prepend set", "sig~ 1.", "groove~ snd", "ezdac~"),
     [(1, 0, 2, 0), (2, 0, 4, 0), (3, 0, 4, 0), (4, 0, 5, 0)]),
])
def test_set_and_a_number_into_a_buffer_reader_is_reported(texts, cords):
    reports = found(patch_of(*texts, cords=cords))
    assert [kind for kind, _ in reports] == ["message"], reports
    assert "takes the name of a buffer~" in reports[0][1]


@pytest.mark.parametrize("texts, cords", [
    (("message set drums", "sig~ 1.", "groove~ snd", "ezdac~"), [(1, 0, 3, 0), (2, 0, 3, 0), (3, 0, 4, 0)]),
    # what arrives at $1 is not known to be a number
    (("message set $1", "sig~ 1.", "groove~ snd", "ezdac~"), [(1, 0, 3, 0), (2, 0, 3, 0), (3, 0, 4, 0)]),
    # set on a number box is fine
    (("message set 0", "flonum"), [(1, 0, 2, 0)]),
])
def test_set_and_a_name_or_an_unknown_is_left_alone(texts, cords):
    assert kinds(patch_of(*texts, cords=cords)) == []


# ── a poly~ or pfft~ and its file ───────────────────────────────────────────────

def save_voice(folder, name, *texts, cords=()):
    voice = patch_of(*texts, cords=cords)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        voice.save(os.path.join(str(folder), name), verbose=False)


def host(text, inlets, outlets, feeders=(), cords=()):
    """A patch with one poly~ or pfft~ box (object 1) and the objects that feed it."""
    patch = mp.MaxPatch(verbose=False)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        box = patch.place(mp.MaxObject(text, abstraction=True, inlets=inlets, outlets=outlets), verbose=False)[0]
        objs = [box] + [patch.place(feeder, verbose=False)[0] for feeder in feeders]
        for source, outlet, dest, inlet in cords:
            patch.connect([objs[source - 1].outs[outlet], objs[dest - 1].ins[inlet]], verbose=False)
    return patch


def test_a_voice_file_with_inlet_objects_is_reported(tmp_path):
    save_voice(tmp_path, "freeze", "inlet", "fftin~ 1", "fftout~ 1", cords=[(2, 0, 3, 0)])
    reports = found(host("pfft~ freeze 1024 4", 2, 1), [tmp_path])
    assert [kind for kind, _ in reports] == ["voice patch"]
    assert "freeze.maxpat has inlet objects" in reports[0][1] and "fftin~" in reports[0][1]


def test_a_voice_inlet_nothing_feeds_is_reported_when_in_1_takes_one_number(tmp_path):
    save_voice(tmp_path, "voice", "in 1", "in 2", "mtof", "cycle~", "*~", "out~ 1",
               cords=[(1, 0, 3, 0), (3, 0, 4, 0), (4, 0, 5, 0), (2, 0, 5, 1), (5, 0, 6, 0)])
    patch = host("poly~ voice 1", 2, 1, feeders=["number"], cords=[(2, 0, 1, 0)])
    reports = found(patch, [tmp_path])
    assert [kind for kind, _ in reports] == ["voice patch"]
    assert "reads `in 2`" in reports[0][1] and "arrives whole at `in 1`" in reports[0][1]


def test_a_voice_that_unpacks_its_list_may_leave_inlets_unfed(tmp_path):
    """Max's own adsr~ help does this: `in 1` into an unpack, and a spare inlet nobody feeds."""
    save_voice(tmp_path, "voice", "in 1", "in 2", "unpack 0 0", "mtof", "cycle~", "*~", "out~ 1",
               cords=[(1, 0, 3, 0), (3, 0, 4, 0), (4, 0, 5, 0), (5, 0, 6, 0), (2, 0, 6, 1), (6, 0, 7, 0)])
    patch = host("poly~ voice 1", 2, 1, feeders=["number"], cords=[(2, 0, 1, 0)])
    assert kinds(patch, [tmp_path]) == []


def test_a_voice_file_that_is_not_there_is_left_alone(tmp_path):
    patch = host("poly~ voice 1", 2, 1, feeders=["number"], cords=[(2, 0, 1, 0)])
    assert kinds(patch, [tmp_path]) == []


def test_several_voices_that_only_ever_get_a_list_are_reported():
    patch = host("poly~ voice 8", 1, 1, feeders=["pack 0 0"], cords=[(2, 0, 1, 0)])
    reports = found(patch)
    assert [kind for kind, _ in reports] == ["voice patch"]
    assert "all 8 do the same thing" in reports[0][1]


@pytest.mark.parametrize("text, feeders, cords", [
    # given to a free voice
    ("poly~ voice 8", ["pack 0 0", "prepend note"], [(2, 0, 3, 0), (3, 0, 1, 0)]),
    ("poly~ voice 8", ["pack 0 0", "prepend midinote"], [(2, 0, 3, 0), (3, 0, 1, 0)]),
    # a target is set
    ("poly~ voice 8", ["pack 0 0", "message target 1"], [(2, 0, 1, 0), (3, 0, 1, 0)]),
    ("poly~ voice 8 @target 1", ["pack 0 0"], [(2, 0, 1, 0)]),
    # one voice
    ("poly~ voice 1", ["pack 0 0"], [(2, 0, 1, 0)]),
    # a number to every voice is a way to set all of them
    ("poly~ voice 8", ["flonum"], [(2, 0, 1, 0)]),
    # what the subpatcher's inlet carries is not known
    ("poly~ voice 8", ["pack 0 0", "inlet"], [(2, 0, 1, 0), (3, 0, 1, 0)]),
])
def test_a_poly_that_is_routed_or_cannot_be_seen_is_left_alone(text, feeders, cords):
    assert kinds(host(text, 1, 1, feeders=feeders, cords=cords)) == []


# ── at save ─────────────────────────────────────────────────────────────────────

def test_save_warns_and_finds_the_voice_file_next_to_the_patch(tmp_path):
    save_voice(tmp_path, "voice", "inlet", "outlet", cords=[(1, 0, 2, 0)])
    patch = host("poly~ voice 1", 1, 1, feeders=["metro 100", "counter"], cords=[(2, 0, 3, 0), (3, 0, 1, 0)])
    with pytest.warns(mp.GraphWarning) as caught:
        patch.save(str(tmp_path / "main"), verbose=False)
    messages = [str(w.message) for w in caught]
    assert any("never switched on" in m for m in messages)
    assert any("voice.maxpat has inlet and outlet objects" in m for m in messages)


def test_check_prints_a_line_for_these(capsys):
    patch = patch_of("metro 100", "counter", "print", cords=[(1, 0, 2, 0), (2, 0, 3, 0)])
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        patch.check("graph")
    assert "PatchCheck: starts : 1 object that nothing starts" in capsys.readouterr().out


# ── attributes ──────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("text", [
    "jit.grab @dim 320 240",                  # every Jitter matrix object has dim
    "jit.noise 1 char 16 1 @planecount 3",
    "jit.op @op + @in2_dim 4 4",              # numbered inputs
    "jit.gl.videoplane @scale 1 1 1",         # every OpenGL object has scale
    "jit.gl.gridshape @shape sphere @position 0. 0. 0. @color 1 0 0 1",
    "jit.expr @expr in[0]*2",                 # holds up to 32 values, takes fewer
    "jit.findbounds @min 0.5 @max 1.",
    "metro 100 @varname clock",               # a box property works in the text too
])
def test_an_attribute_a_family_gives_is_kept_without_a_warning(text):
    with warnings.catch_warnings():
        warnings.simplefilter("error", mp.AttributeWarning)
        obj = mp.MaxObject(text)
    assert obj._dict["box"]["text"] == text


def test_an_attribute_maxpylang_does_not_know_is_kept_with_a_warning():
    """It used to be taken out of the box. The data is not complete, and Max is the judge."""
    with pytest.warns(mp.AttributeWarning, match="no attribute 'nonsense' that maxpylang knows of"):
        obj = mp.MaxObject("metro 500 @nonsense 1")
    assert obj._dict["box"]["text"] == "metro 500 @nonsense 1"


@pytest.mark.parametrize("text, key, value", [
    ("slider @size 1000", "size", 1000.0),
    ("flonum @minimum 0. @maximum 1.", "maximum", 1.0),
    ("multislider @size 16", "size", 16),
    ("multislider @setminmax 0. 1.", "setminmax", [0.0, 1.0]),
    ("waveform~ @buffername drums", "buffername", "drums"),
    ("live.dial @varname cutoff", "varname", "cutoff"),
])
def test_an_attribute_typed_on_a_ui_object_becomes_a_property_of_its_box(text, key, value):
    """Max reads the text of an object box only. On a slider it reads the box's properties."""
    with warnings.catch_warnings():
        warnings.simplefilter("error", mp.AttributeWarning)
        box = mp.MaxObject(text)._dict["box"]
    assert box[key] == value and type(box[key]) is type(value)


def test_a_property_passed_by_keyword_wins_over_the_text():
    assert mp.MaxObject("slider @size 500", size=20.)._dict["box"]["size"] == 20.


def test_edit_sets_the_property_too():
    obj = mp.MaxObject("slider")
    obj.edit(text="@size 500")
    assert obj._dict["box"]["size"] == 500.
