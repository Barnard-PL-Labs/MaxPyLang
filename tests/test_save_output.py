"""What a script prints by default: nothing while building a patch, then one line from save().

Problems are reported as warnings when they happen (stderr, at the caller's line). save()
ends with a single summary line that counts them, so a clean patch prints one line in total.
The full per-check report is still available from patch.check().
"""

import warnings

import pytest

import maxpylang as mp
from maxpylang import ConnectionWarning, GraphWarning


@pytest.fixture(autouse=True)
def in_tmp(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)


def hello_world():
    patch = mp.MaxPatch()
    osc = patch.place("cycle~ 440")[0]
    dac = patch.place("ezdac~")[0]
    patch.connect([osc.outs[0], dac.ins[0]])
    return patch


def feedback():
    patch = mp.MaxPatch()
    noise, add, mul, dac = patch.place("noise~", "+~", "*~ 0.9", "ezdac~")
    patch.connect(
        [noise.outs[0], add.ins[0]],
        [add.outs[0], mul.ins[0]],
        [mul.outs[0], add.ins[1]],
        [add.outs[0], dac.ins[0]],
    )
    return patch


# ── building a patch ──────────────────────────────────────────────────────────

def test_building_a_patch_prints_nothing(capsys):
    hello_world()
    assert capsys.readouterr().out == ""


def test_connect_still_prints_each_cord_when_verbose(capsys):
    patch = mp.MaxPatch()
    osc, dac = patch.place("cycle~ 440", "ezdac~")
    patch.connect([osc.outs[0], dac.ins[0]], verbose=True)
    assert "connected" in capsys.readouterr().out


def test_a_new_patch_still_says_where_it_came_from_when_verbose(capsys):
    mp.MaxPatch(verbose=True)
    assert "new patch created" in capsys.readouterr().out


# ── save() ────────────────────────────────────────────────────────────────────

def test_a_clean_patch_saves_with_one_line(capsys):
    patch = hello_world()
    capsys.readouterr()
    patch.save("hello_world")
    assert capsys.readouterr().out == "saved hello_world.maxpat (2 objects, 1 cord, no problems found)\n"


def test_a_problem_is_a_warning_then_one_line(capsys):
    patch = feedback()
    with pytest.warns(GraphWarning, match="audio feedback"):
        patch.save("feedback")
    assert capsys.readouterr().out == "saved feedback.maxpat (4 objects, 4 cords, 1 problem, see warning above)\n"


def test_problems_from_every_check_are_counted(capsys):
    patch = mp.MaxPatch()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        patch.place("notarealobject")  # UnknownObjectWarning
        osc, num = patch.place("cycle~ 440", "flonum")
        patch.connect([osc.outs[0], num.ins[0]])  # audio into a number box: ConnectionWarning
        a, b, out = patch.place("+ 1", "+ 1", "print")
        patch.connect([a.outs[0], b.ins[0]], [b.outs[0], a.ins[0]], [b.outs[0], out.ins[0]])
        patch.save("p")  # hot loop: GraphWarning
    assert capsys.readouterr().out == "saved p.maxpat (6 objects, 4 cords, 3 problems, see warnings above)\n"


def test_a_bad_cord_warns_once_at_connect_and_save_only_counts_it(capsys):
    patch = mp.MaxPatch()
    osc, num = patch.place("cycle~ 440", "flonum")
    with pytest.warns(ConnectionWarning):
        patch.connect([osc.outs[0], num.ins[0]])
    with warnings.catch_warnings():
        warnings.simplefilter("error")  # a second warning for the same cord would raise here
        patch.save("p")
    assert capsys.readouterr().out == "saved p.maxpat (2 objects, 1 cord, 1 problem, see warning above)\n"


def test_the_line_says_how_much_could_not_be_checked(capsys):
    # an abstraction can do anything, so "no problems found" alone would claim too much
    patch = mp.MaxPatch()
    osc = patch.place("cycle~ 440")[0]
    synth = patch.place(mp.MaxObject("my_synth", abstraction=True, inlets=1, outlets=1))[0]
    patch.connect([osc.outs[0], synth.ins[0]])
    patch.save("p")
    assert capsys.readouterr().out == "saved p.maxpat (2 objects, 1 cord, no problems found, 1 object not checked)\n"


def test_save_prints_nothing_when_not_verbose(capsys):
    patch = feedback()
    with pytest.warns(GraphWarning):
        patch.save("feedback", verbose=False)
    assert capsys.readouterr().out == ""


def test_save_without_checks_does_not_claim_the_patch_is_clean(capsys):
    patch = hello_world()
    patch.save("hello_world", check=False)
    assert capsys.readouterr().out == "saved hello_world.maxpat (2 objects, 1 cord)\n"


def test_a_device_save_names_the_device_type(capsys):
    patch = mp.MaxPatch()
    note, mtof, osc, clip, out = patch.place("notein", "mtof", "cycle~", "clip~ -1. 1.", "plugout~")
    patch.connect([note.outs[0], mtof.ins[0]], [mtof.outs[0], osc.ins[0]],
                  [osc.outs[0], clip.ins[0]], [clip.outs[0], out.ins[0]], [clip.outs[0], out.ins[1]])
    patch.save("synth.amxd", device_type="instrument")
    assert capsys.readouterr().out == (
        "saved synth.amxd (M4L instrument, 5 objects, 5 cords, no problems found)\n")


# ── the full report ───────────────────────────────────────────────────────────

def test_check_still_prints_the_full_report(capsys):
    patch = hello_world()
    patch.check()
    out = capsys.readouterr().out
    assert "PatchCheck: cords : 1 cord" in out
    assert "PatchCheck: graph : 0 hot loops" in out
