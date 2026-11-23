"""
The checks on a Max for Live device and on Live parameters (maxpylang/devicecheck.py), and
the parameter() method that gives them something to read.

tests/test_m4l_gaps.py has one test per gap these closed. This file covers the rules
behind them: what is followed, what is left alone, and what parameter() refuses.
"""

import io
import struct
import warnings
from contextlib import redirect_stdout

import pytest

import maxpylang as mp
from maxpylang.devicecheck import device_problems, parameter_of


def device(*texts, cords=()):
    """A patch of these objects, numbered from 1, with cords (source, outlet, destination, inlet)."""
    patch = mp.MaxPatch(verbose=False)
    objs = [patch.place(text, verbose=False)[0] for text in texts]
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        for source, outlet, dest, inlet in cords:
            patch.connect([objs[source - 1].outs[outlet], objs[dest - 1].ins[inlet]], verbose=False)
    return patch, objs


def problems(patch, device_type="audio_effect"):
    return device_problems(patch.get_json()["patcher"], device_type)


def kinds(patch, device_type="audio_effect"):
    return sorted(problem.kind for problem in problems(patch, device_type))


THROUGH = [(1, 0, 2, 0), (1, 1, 2, 1)]


# ── parameter() ─────────────────────────────────────────────────────────────────

def test_parameter_returns_the_object_and_can_be_read_back():
    patch, (dial,) = device("live.dial")
    assert dial.parameter("Cutoff", 40, 18000) is dial
    saved = patch.get_json()["patcher"]["boxes"][0]["box"]
    assert parameter_of(saved) == ("Cutoff", 40.0, 18000.0)


def test_a_bare_dial_has_maxs_default_range():
    patch, _ = device("live.dial")
    assert parameter_of(patch.get_json()["patcher"]["boxes"][0]["box"]) == (None, 0.0, 127.0)


def test_parameter_with_options_makes_a_list_of_choices():
    patch, (tab,) = device("live.tab")
    tab.parameter("Mode", options=["Low", "Band", "High"])
    block = tab._dict["box"]["saved_attribute_attributes"]["valueof"]
    assert block["parameter_type"] == 2 and block["parameter_enum"] == ["Low", "Band", "High"]
    assert "parameter_mmin" not in block


def test_a_second_call_changes_only_what_it_names():
    _, (dial,) = device("live.dial")
    dial.parameter("Cutoff", 40, 18000, unit="hertz")
    dial.parameter("Freq")
    block = dial._dict["box"]["saved_attribute_attributes"]["valueof"]
    assert block["parameter_longname"] == "Freq" and block["parameter_mmax"] == 18000.0
    assert block["parameter_unitstyle"] == 3


@pytest.mark.parametrize("arguments, error, says", [
    (dict(name="Cutoff", lo=100, hi=100), ValueError, "empty"),
    (dict(name="Cutoff", lo=0, hi=1, initial=2), ValueError, "outside its range"),
    (dict(name="Cutoff", lo=0, hi=1, unit="hz"), ValueError, "unknown unit"),
    (dict(name="", lo=0, hi=1), ValueError, "needs a name"),
    (dict(name="Mode", lo=0, hi=1, options=["a", "b"]), ValueError, "not both"),
])
def test_parameter_refuses_what_makes_no_sense(arguments, error, says):
    _, (dial,) = device("live.dial")
    with pytest.raises(error, match=says):
        dial.parameter(**arguments)
    assert "saved_attribute_attributes" not in dial._dict["box"]


def test_parameter_refuses_an_object_that_cannot_be_one():
    _, (osc,) = device("cycle~ 440")
    with pytest.raises(TypeError, match="cannot be a Live parameter"):
        osc.parameter("Pitch", 20, 2000)


# ── attributes ──────────────────────────────────────────────────────────────────

def test_an_unknown_attribute_in_the_box_text_warns():
    patch = mp.MaxPatch(verbose=False)
    with pytest.warns(mp.AttributeWarning, match="no attribute 'nonsense'"):
        patch.place("metro 500 @nonsense 1", verbose=False)


def test_a_known_attribute_does_not_warn():
    patch = mp.MaxPatch(verbose=False)
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        (metro,) = patch.place("metro 500 @active 1", verbose=False)
        metro.edit(hidden=1, varname="clock")


# ── the device contract ─────────────────────────────────────────────────────────

@pytest.mark.parametrize("texts, cords, device_type, says", [
    (["cycle~ 440", "plugout~"], [(1, 0, 2, 0)], "audio_effect", "never reads plugin~"),
    (["cycle~ 440", "plugout~"], [(1, 0, 2, 0)], "instrument", "no MIDI input"),
    (["plugin~", "ezdac~"], [(1, 0, 2, 0)], "audio_effect", "dac~ and ezdac~ are silent"),
    (["notein", "mtof", "cycle~"], [(1, 0, 2, 0), (2, 0, 3, 0)], "instrument", "never writes to plugout~"),
    (["midiin", "midiparse"], [(1, 0, 2, 0)], "midi_effect", "no MIDI output"),
    (["metro 200", "makenote 100 100", "noteout"], [(1, 0, 2, 0), (2, 0, 3, 0)], "midi_effect", "no MIDI input"),
])
def test_a_device_lacking_what_its_type_needs(texts, cords, device_type, says):
    patch, _ = device(*texts, cords=cords)
    assert [p.message for p in problems(patch, device_type) if p.kind == "device contract" and says in p.message]


@pytest.mark.parametrize("texts, cords, device_type", [
    (["plugin~", "plugout~"], THROUGH, "audio_effect"),
    (["notein", "mtof", "cycle~", "plugout~"], [(1, 0, 2, 0), (2, 0, 3, 0), (3, 0, 4, 0)], "instrument"),
    (["midiin", "midiout"], [(1, 0, 2, 0)], "midi_effect"),
])
def test_a_device_with_what_its_type_needs(texts, cords, device_type):
    patch, _ = device(*texts, cords=cords)
    assert kinds(patch, device_type) == []


def test_the_contract_is_not_judged_when_part_of_the_device_cannot_be_seen():
    """The plugin~ may be inside the abstraction."""
    patch = mp.MaxPatch(verbose=False)
    inner = mp.MaxObject("my_input", abstraction=True, inlets=0, outlets=2)
    with redirect_stdout(io.StringIO()):
        source = patch.place(inner, verbose=False)[0]
    out = patch.place("plugout~", verbose=False)[0]
    patch.connect([source.outs[0], out.ins[0]], verbose=False)
    assert kinds(patch) == []


def test_a_plain_patch_has_no_contract():
    patch, _ = device("cycle~ 440", "ezdac~", cords=[(1, 0, 2, 0)])
    assert kinds(patch, device_type=None) == []


# ── the level reaching plugout~ ─────────────────────────────────────────────────

@pytest.mark.parametrize("middle, cords", [
    (["*~ 0.5"], [(1, 0, 3, 0), (3, 0, 2, 0)]),                               # only attenuates
    (["*~ 4.", "clip~ -1. 1."], [(1, 0, 3, 0), (3, 0, 4, 0), (4, 0, 2, 0)]),  # limited after the gain
    (["lores~ 800 0.5", "tanh~"], [(1, 0, 3, 0), (3, 0, 4, 0), (4, 0, 2, 0)]),
    (["delay~ 4410 4410"], [(1, 0, 3, 0), (3, 0, 2, 0)]),
    (["tapin~ 500", "tapout~ 250"], [(1, 0, 3, 0), (3, 0, 4, 0), (4, 0, 2, 1)]),
])
def test_a_level_that_stays_inside_full_scale(middle, cords):
    patch, _ = device("plugin~", "plugout~", *middle, cords=cords)
    assert kinds(patch) == []


@pytest.mark.parametrize("middle, cords, says", [
    (["*~ 4."], [(1, 0, 3, 0), (3, 0, 2, 0)], "4 times full scale"),
    (["cycle~ 440"], [(1, 0, 2, 0), (3, 0, 2, 0)], "2 times full scale"),   # two cords into one inlet add
    (["lores~ 800 0.9"], [(1, 0, 3, 0), (3, 0, 2, 0)], "lores~ (obj-3) can raise the level"),
    (["clip~ -1. 1.", "*~ 3."], [(1, 0, 3, 0), (3, 0, 4, 0), (4, 0, 2, 0)], "3 times full scale"),  # gain after the limiter
])
def test_a_level_that_can_pass_full_scale(middle, cords, says):
    patch, _ = device("plugin~", "plugout~", *middle, cords=cords)
    (problem,) = problems(patch)
    assert problem.kind == "output level" and says in problem.message


def test_a_feedback_loop_with_no_limiter_is_unlimited():
    patch, _ = device("plugin~", "plugout~", "tapin~ 500", "tapout~ 250", "*~ 0.7",
                      cords=[(1, 0, 3, 0), (3, 0, 4, 0), (4, 0, 5, 0), (5, 0, 3, 0), (4, 0, 2, 0)])
    (problem,) = problems(patch)
    assert problem.kind == "output level" and "feedback loop" in problem.message


def test_a_gain_dial_counts_by_its_range():
    """A dial into *~ multiplies by whatever the dial can reach."""
    cords = [(1, 0, 3, 0), (4, 0, 3, 1), (3, 0, 2, 0)]
    patch, objs = device("plugin~", "plugout~", "*~", "live.dial", cords=cords)
    assert "127 times full scale" in problems(patch)[0].message
    objs[3].parameter("Level", 0, 1)
    assert kinds(patch) == []


def test_a_level_through_a_subpatcher_or_a_ramp_is_not_judged():
    """line~ holds whatever it is sent, so the gain it sets cannot be read off the patch."""
    cords = [(1, 0, 3, 0), (4, 0, 3, 1), (3, 0, 2, 0)]
    patch, _ = device("plugin~", "plugout~", "*~", "line~", cords=cords)
    assert kinds(patch) == []


# ── parameters ──────────────────────────────────────────────────────────────────

def test_a_parameter_with_a_cord_is_not_idle():
    patch, _ = device("plugin~", "plugout~", "live.dial", "flonum", cords=THROUGH + [(3, 0, 4, 0)])
    assert kinds(patch) == []


def test_an_idle_parameter_is_left_alone_when_something_may_read_it_by_name():
    patch, _ = device("plugin~", "plugout~", "live.dial", "pattrstorage presets", cords=THROUGH)
    assert kinds(patch) == []


def test_an_idle_parameter_matters_only_in_a_device():
    patch, _ = device("live.dial")
    assert kinds(patch, device_type=None) == []


def test_two_unnamed_parameters_do_not_share_a_name():
    patch, _ = device("plugin~", "plugout~", "live.dial", "live.dial", "flonum",
                      cords=THROUGH + [(3, 0, 5, 0), (4, 0, 5, 0)])
    assert kinds(patch) == []


def test_a_name_used_twice_is_found_in_a_plain_patch_too():
    patch, (a, b) = device("live.dial", "live.dial")
    a.parameter("Gain")
    b.parameter("Gain")
    assert kinds(patch, device_type=None) == ["parameter name"]


# ── a parameter's range against its inlet ───────────────────────────────────────

def filter_with(dial_range, *between, inlet=2):
    """plugin~ -> svf~ -> clip~ -> plugout~, with a dial reaching the svf~ through `between`."""
    texts = ["plugin~", "plugout~", "svf~ 1000. 0.5", "clip~ -1. 1.", "live.dial", *between]
    chain = [5, *range(6, 6 + len(between))]
    cords = [(1, 0, 3, 0), (3, 0, 4, 0), (4, 0, 2, 0)]
    cords += [(a, 0, b, 0) for a, b in zip(chain, chain[1:])] + [(chain[-1], 0, 3, inlet)]
    patch, objs = device(*texts, cords=cords)
    objs[4].parameter("Reso", *dial_range)
    return patch


@pytest.mark.parametrize("dial_range, between", [
    ((0, 1), []),
    ((0, 100), ["/ 100."]),
    ((0, 100), ["* 0.01", "flonum"]),
    ((0, 127), ["scale 0 127 0.1 0.9"]),
    ((0, 127), ["scale 0 127 0. 1. 2."]),      # curved, but the dial stays inside the input range
    ((-40, 40), ["zmap -40 40 0 1"]),
    ((0, 10), ["clip 0. 1."]),
    ((1, 2), ["!- 2."]),
    ((0, 1), ["t f b"]),
])
def test_a_range_that_fits_after_what_is_on_the_way(dial_range, between):
    assert kinds(filter_with(dial_range, *between)) == []


@pytest.mark.parametrize("dial_range, between, says", [
    ((40, 18000), [], "40 to 18000"),
    ((0, 100), ["/ 10."], "0 to 10"),
    ((0, 127), ["scale 0 127 0. 2."], "0 to 2"),
    ((0, 1), ["+ 0.5"], "0.5 to 1.5"),
    ((60, 72), ["mtof"], "261.626 to 523.251"),
])
def test_a_range_that_does_not_fit(dial_range, between, says):
    (problem,) = problems(filter_with(dial_range, *between))
    assert problem.kind == "value range" and says in problem.message and "'Reso'" in problem.message


@pytest.mark.parametrize("between", [["expr $f1 * 100"], ["pack f 20", "line"], ["t b f"]])
def test_a_range_is_not_judged_past_an_object_with_no_rule(between):
    assert kinds(filter_with((0, 100), *between)) == []


def test_a_cord_into_the_right_inlet_makes_the_result_unknown():
    patch, objs = device("plugin~", "plugout~", "svf~ 1000. 0.5", "clip~ -1. 1.", "live.dial", "* 100.", "flonum",
                         cords=[(1, 0, 3, 0), (3, 0, 4, 0), (4, 0, 2, 0), (5, 0, 6, 0), (7, 0, 6, 1), (6, 0, 3, 2)])
    objs[4].parameter("Reso", 0, 1)
    assert kinds(patch) == []


def test_a_cutoff_past_a_quarter_of_the_sample_rate():
    (problem,) = problems(filter_with((40, 18000), inlet=1))
    assert "cutoff frequency" in problem.message and "0 to 11025" in problem.message
    assert kinds(filter_with((40, 11000), inlet=1)) == []


def test_the_raw_outlet_of_a_dial_runs_from_0_to_1():
    patch, objs = device("plugin~", "plugout~", "svf~ 1000. 0.5", "clip~ -1. 1.", "live.dial",
                         cords=[(1, 0, 3, 0), (3, 0, 4, 0), (4, 0, 2, 0), (5, 1, 3, 2)])
    objs[4].parameter("Reso", 40, 18000)
    assert kinds(patch) == []


# ── warnings and loading ────────────────────────────────────────────────────────

def test_a_device_problem_warns_as_a_device_warning_which_is_a_graph_warning(tmp_path):
    patch, _ = device("cycle~ 440", "plugout~", cords=[(1, 0, 2, 0)])
    with pytest.warns(mp.DeviceWarning, match="never reads plugin~") as caught, redirect_stdout(io.StringIO()):
        patch.save(str(tmp_path / "d.amxd"), device_type="audio_effect", verbose=False)
    assert issubclass(mp.DeviceWarning, mp.GraphWarning)
    assert caught[0].filename == __file__


def test_check_counts_device_problems(capsys):
    patch, _ = device("plugin~", "plugout~", "*~ 4.", "live.dial", cords=[(1, 0, 3, 0), (3, 0, 2, 0)])
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        patch.check("graph", device_type="audio_effect")
    assert ("PatchCheck: device : 1 plugout~ with nothing limiting its level, 1 parameter with no cords"
            in capsys.readouterr().out)


def test_a_frozen_device_loads(tmp_path):
    """Max freezes a device by putting the files it depends on after the patcher, behind a
    header. Most devices that ship with Max are frozen, and load_amxd() could not read one."""
    patcher = b'{"patcher": {"boxes": [], "lines": []}}'
    frozen = b"mx@c" + struct.pack(">III", 16, 0, 16 + len(patcher) + 1) + patcher + b"\x00" + b"dlst\xff\xfe junk"
    path = tmp_path / "frozen.amxd"
    path.write_bytes(b"ampf" + struct.pack("<I", 4) + b"aaaa" + b"meta" + struct.pack("<I", 4) + b"\x00" * 4
                     + b"ptch" + struct.pack("<I", len(frozen)) + frozen)
    assert mp.load_amxd(str(path)) == {"patcher": {"boxes": [], "lines": []}}
