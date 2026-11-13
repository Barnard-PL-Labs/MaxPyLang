"""Whole-patch checks run at save(): hot loops, audio feedback, and dead outputs."""

import contextlib
import io
import warnings
from pathlib import Path

import pytest

import maxpylang as mp
from maxpylang import GraphWarning
from maxpylang.graphcheck import find_problems, from_patch


def build(*texts, cords=(), **kwargs):
    """A patch of the given boxes (obj-1, obj-2, ...) and cords given as (src, outlet, dst, inlet)
    with 1-based box numbers."""
    patch = mp.MaxPatch(verbose=False)
    with contextlib.redirect_stdout(io.StringIO()), warnings.catch_warnings():
        warnings.simplefilter("ignore")
        objs = [patch.place(t, verbose=False)[0] if isinstance(t, str) else patch.place(t, verbose=False)[0]
                for t in texts]
        for src, outlet, dst, inlet in cords:
            patch.connect([objs[src - 1].outs[outlet], objs[dst - 1].ins[inlet]], verbose=False)
    return patch


def kinds(patch, max_for_live=False):
    return sorted(p.kind for p in find_problems(*from_patch(patch), max_for_live=max_for_live))


def ok_ending(*cords):
    """Cords that end in a print, so nothing is a dead output."""
    return cords


# ── hot loops ─────────────────────────────────────────────────────────────────

def test_two_objects_feeding_each_others_hot_inlets_loop():
    patch = build("+ 1", "+ 1", "print", cords=[(1, 0, 2, 0), (2, 0, 1, 0), (2, 0, 3, 0)])
    assert kinds(patch) == ["hot loop"]


def test_an_object_feeding_its_own_hot_inlet_loops():
    patch = build("+ 1", "print", cords=[(1, 0, 1, 0), (1, 0, 2, 0)])
    assert kinds(patch) == ["hot loop"]


def test_a_cycle_back_into_a_cold_inlet_is_fine():
    patch = build("+ 1", "+ 1", "print", cords=[(1, 0, 2, 0), (2, 0, 1, 1), (2, 0, 3, 0)])
    assert kinds(patch) == []


def test_every_inlet_of_pak_is_hot_but_only_the_left_of_pack():
    loop = build("+ 1", "pak 0 0", "print", cords=[(1, 0, 2, 1), (2, 0, 1, 0), (2, 0, 3, 0)])
    safe = build("+ 1", "pack 0 0", "print", cords=[(1, 0, 2, 1), (2, 0, 1, 0), (2, 0, 3, 0)])
    assert kinds(loop) == ["hot loop"] and kinds(safe) == []


@pytest.mark.parametrize("breaker", ["delay 10", "deferlow", "pipe 10"])
def test_a_delay_breaks_the_loop(breaker):
    patch = build("+ 1", breaker, "print", cords=[(1, 0, 2, 0), (2, 0, 1, 0), (1, 0, 3, 0)])
    assert kinds(patch) == []


@pytest.mark.parametrize("stopper", ["sel 10", "number", "message set $1", "line"])
def test_a_cycle_that_may_stop_is_not_reported(stopper):
    # conditional, UI, a set message, clocked
    patch = build("+ 1", stopper, "print", cords=[(1, 0, 2, 0), (2, 0, 1, 0), (1, 0, 3, 0)])
    assert "hot loop" not in kinds(patch)


# ── audio feedback ────────────────────────────────────────────────────────────

def test_a_signal_cycle_is_audio_feedback():
    patch = build("*~ 0.5", "+~ 0.1", "ezdac~", cords=[(1, 0, 2, 0), (2, 0, 1, 0), (2, 0, 3, 0)])
    assert kinds(patch) == ["audio feedback"]


def test_delay_tilde_does_not_make_feedback_legal():
    # delay~ delays inside the signal chain; Max still sees a loop (as in a recorded LLM patch)
    patch = build("*~ 0.5", "delay~ 100 10", "ezdac~", cords=[(1, 0, 2, 0), (2, 0, 1, 0), (2, 0, 3, 0)])
    assert kinds(patch) == ["audio feedback"]


def test_tapin_tapout_breaks_feedback():
    patch = build("tapin~ 1000", "tapout~ 100", "*~ 0.5", "ezdac~",
                  cords=[(1, 0, 2, 0), (2, 0, 3, 0), (3, 0, 1, 0), (2, 0, 4, 0)])
    assert kinds(patch) == []


# ── dead outputs ──────────────────────────────────────────────────────────────

def test_audio_that_reaches_the_dac_is_fine():
    assert kinds(build("cycle~ 440", "*~ 0.5", "ezdac~", cords=[(1, 0, 2, 0), (2, 0, 3, 0)])) == []


def test_a_chain_that_goes_nowhere_is_one_dead_output():
    problems = find_problems(*from_patch(build("cycle~ 440", "*~ 0.5", cords=[(1, 0, 2, 0)])))
    assert [p.kind for p in problems] == ["dead output"]
    assert "cycle~ (obj-1)" in problems[0].message and "*~ (obj-2)" in problems[0].message


def test_an_unconnected_object_is_reported():
    problems = find_problems(*from_patch(build("metro 500")))
    assert [p.message for p in problems] == ["metro (obj-1) is not connected to anything."]


def test_comments_and_receives_are_never_dead():
    assert kinds(build("comment hello", "loadbang", "r foo")) == []


@pytest.mark.parametrize("texts, cords", [
    (["metro 33", "jit.movie", "jit.window"], [(1, 0, 2, 0), (2, 0, 3, 0)]),
    (["toggle", "jit.world"], [(1, 0, 2, 0)]),
    (["jit.movie", "jit.gl.videoplane"], [(1, 0, 2, 0)]),
    (["counter", "umenu"], [(1, 0, 2, 0)]),
    (["metro 100", "led"], [(1, 0, 2, 0)]),
    (["notein", "kslider"], [(1, 0, 2, 0)]),
    (["cycle~ 1", "plot~"], [(1, 0, 2, 0)]),
    (["adc~", "sfrecord~ 2"], [(1, 0, 2, 0)]),
    (["midiin", "seq"], [(1, 0, 2, 0)]),
    (["flonum", "preset"], [(1, 0, 2, 0)]),
    (["loadbang", "message", "thispatcher"], [(1, 0, 2, 0), (2, 0, 3, 0)]),
    (["metro 500", "counter 0 7", "message"], [(1, 0, 2, 0), (2, 0, 3, 1)]),
])
def test_a_chain_that_ends_in_something_seen_or_stored_is_fine(texts, cords):
    assert kinds(build(*texts, cords=cords)) == []


def test_a_message_that_sends_by_name_is_an_end():
    assert kinds(build("loadbang", "message ; dsp start", cords=[(1, 0, 2, 0)])) == []


def test_a_message_box_fed_on_the_left_with_nothing_after_it_is_dead():
    assert kinds(build("button", "message 440", cords=[(1, 0, 2, 0)])) == ["dead output"]


def test_a_gain_slider_with_nothing_after_it_is_dead():
    # gain~ is a UI box, but it passes audio on, so it does not count as a display
    assert kinds(build("cycle~ 440", "gain~", cords=[(1, 0, 2, 0)])) == ["dead output"]


def test_a_ui_box_with_no_cords_is_reported():
    problems = find_problems(*from_patch(build("umenu")))
    assert [p.message for p in problems] == ["umenu (obj-1) is not connected to anything."]


def test_inside_max_for_live_the_dac_is_not_an_output():
    patch = build("cycle~ 440", "ezdac~", cords=[(1, 0, 2, 0)])
    assert kinds(patch) == [] and kinds(patch, max_for_live=True) == ["dead output"]


def test_an_abstraction_may_do_anything():
    synth = mp.MaxObject("my_synth", abstraction=True, inlets=1, outlets=0)
    assert kinds(build("cycle~ 440", synth, cords=[(1, 0, 2, 0)])) == []


# ── at save ───────────────────────────────────────────────────────────────────

def test_save_warns_at_the_callers_line_and_prints_the_counts(tmp_path, capsys):
    patch = build("+ 1", "+ 1", "print", cords=[(1, 0, 2, 0), (2, 0, 1, 0), (2, 0, 3, 0)])
    with pytest.warns(GraphWarning, match="hot loop") as caught:
        patch.save(str(tmp_path / "p"), verbose=False)
    assert Path(caught[0].filename).name == "test_graphcheck.py"
    assert ("PatchCheck: graph : 1 hot loop, 0 audio feedback loops with no delay, "
            "0 parts of the patch whose output reaches nothing") in capsys.readouterr().out


def test_a_clean_patch_saves_without_graph_warnings(tmp_path):
    patch = build("cycle~ 440", "*~ 0.5", "ezdac~", cords=[(1, 0, 2, 0), (2, 0, 3, 0)])
    with warnings.catch_warnings(), contextlib.redirect_stdout(io.StringIO()):
        warnings.simplefilter("error", GraphWarning)
        patch.save(str(tmp_path / "p"), verbose=False)
