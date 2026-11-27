"""
Gaps in what maxpylang can express or check about a Max for Live device.

Every test for an open gap states what SHOULD happen and is marked xfail(strict=True)
because it does not happen yet. The pair is the point: the test is the executable half of an entry
in docs/type-system/m4l-gaps.md, and strict means that the day a gap is closed its test
fails loudly as "unexpectedly passing", which is the cue to delete the mark, update the
log, and remove the matching workaround from the plugin generator's fxgen.py.

The gaps were found by building real devices with the plugin generator, a browser page
that started in this repo's web/ folder and is now a project of its own. Nothing here is
hypothetical: each one is either a workaround the generator needs, or a broken device
the checks let through.
"""

import io
import warnings
from contextlib import redirect_stdout

import pytest

import maxpylang as mp

gap = pytest.mark.xfail(strict=True, reason="open gap, see docs/type-system/m4l-gaps.md")


def place(patch, *texts):
    return [patch.place(text, verbose=False)[0] for text in texts]


def box(patch, obj):
    """The object's box as it would be saved."""
    for entry in patch.get_json()["patcher"]["boxes"]:
        if entry["box"]["id"] == obj._dict["box"]["id"]:
            return entry["box"]
    raise AssertionError("object not in patch")


def save_warnings(patch, tmp_path, device_type="audio_effect"):
    """Everything save() warns about for this device."""
    with warnings.catch_warnings(record=True) as caught, redirect_stdout(io.StringIO()):
        warnings.simplefilter("always")
        patch.save(str(tmp_path / "device.amxd"), device_type=device_type, verbose=False)
    return [str(w.message) for w in caught]


def stereo_through(patch):
    """plugin~ -> plugout~ on both channels: the smallest valid audio effect."""
    plug_in, plug_out = place(patch, "plugin~", "plugout~")
    patch.connect([plug_in.outs[0], plug_out.ins[0]], [plug_in.outs[1], plug_out.ins[1]], verbose=False)
    return plug_in, plug_out


# ── expressing a device ─────────────────────────────────────────────────────────

def test_m4l_01_a_dial_range_can_be_set():
    """M4L-01, closed. A live.dial's name, range, unit and start value are set with parameter()."""
    patch = mp.MaxPatch(verbose=False)
    (dial,) = place(patch, "live.dial")
    dial.parameter("Cutoff", 40, 18000, initial=1000, unit="hertz", exponent=3)
    saved = box(patch, dial)
    assert saved["parameter_enable"] == 1
    assert saved["saved_attribute_attributes"]["valueof"] == {
        "parameter_longname": "Cutoff", "parameter_shortname": "Cutoff", "parameter_type": 0,
        "parameter_mmin": 40.0, "parameter_mmax": 18000.0,
        "parameter_initial": [1000], "parameter_initial_enable": 1,
        "parameter_unitstyle": 3, "parameter_exponent": 3.0,
    }


def test_m4l_01_the_parameter_block_can_also_be_given_whole():
    """M4L-01, closed. edit() used to drop the block; a script that builds its own can pass it."""
    patch = mp.MaxPatch(verbose=False)
    (dial,) = place(patch, "live.dial")
    block = {"valueof": {"parameter_longname": "Cutoff", "parameter_mmin": 40.0, "parameter_mmax": 18000.0}}
    dial.edit(saved_attribute_attributes=block)
    assert box(patch, dial).get("saved_attribute_attributes") == block


def test_m4l_01_a_rejected_attribute_is_not_silent():
    """M4L-01, closed. edit() dropped an attribute it did not know with a print. It warns now."""
    patch = mp.MaxPatch(verbose=False)
    (dial,) = place(patch, "live.dial")
    with pytest.warns(mp.AttributeWarning, match="not_an_attribute"):
        dial.edit(not_an_attribute=1)


def test_m4l_02_any_box_can_be_put_in_presentation():
    """M4L-02, closed. Presentation is a property of every box; edit() took it only on some."""
    patch = mp.MaxPatch(verbose=False)
    (panel,) = place(patch, "panel")
    panel.edit(presentation=1, presentation_rect=[0.0, 0.0, 100.0, 169.0])
    saved = box(patch, panel)
    assert saved.get("presentation") == 1
    assert saved.get("presentation_rect") == [0.0, 0.0, 100.0, 169.0]


@gap
@pytest.mark.parametrize("name", ["comment", "live.comment"])
def test_m4l_03_a_comment_saves_only_its_words(name):
    """M4L-03: Max stores a comment's words in `text`; the object name does not belong there."""
    patch = mp.MaxPatch(verbose=False)
    (comment,) = place(patch, name + " Filter")
    assert box(patch, comment)["text"] == "Filter"


@gap
def test_m4l_04_a_device_with_a_presentation_opens_in_it(tmp_path):
    """
    M4L-04: Live shows a device's presentation view only if the patcher says to open in it.

    There is no public way to say so. One fix is the one tested here, that saving a device
    which has presentation boxes turns `openinpresentation` on; another is a setter for
    patcher-level attributes, which `devicewidth` needs anyway.
    """
    patch = mp.MaxPatch(verbose=False)
    stereo_through(patch)
    (dial,) = place(patch, "live.dial")
    dial.edit(presentation=1, presentation_rect=[10.0, 10.0, 44.0, 48.0])
    with redirect_stdout(io.StringIO()):
        patch.save(str(tmp_path / "device.amxd"), device_type="audio_effect", verbose=False)
    assert mp.load_amxd(str(tmp_path / "device.amxd"))["patcher"]["openinpresentation"] == 1


# ── checking a device ───────────────────────────────────────────────────────────

def test_m4l_05_a_tap_link_only_fits_a_tapout(tmp_path):
    """M4L-05: tapin~'s outlet carries a tap link, which only tapout~ understands."""
    patch = mp.MaxPatch(verbose=False)
    plug_in, plug_out = stereo_through(patch)
    tapin, gain = place(patch, "tapin~ 1000", "*~ 0.5")
    patch.connect([plug_in.outs[0], tapin.ins[0]], [tapin.outs[0], gain.ins[0]], [gain.outs[0], plug_out.ins[0]], verbose=False)
    assert patch.get_coverage()["cords"]["flagged"] == 1


def test_m4l_05_a_tapout_needs_a_tapin(tmp_path):
    """M4L-05: a tapout~ that no tapin~ feeds has no delay line to read."""
    patch = mp.MaxPatch(verbose=False)
    plug_in, plug_out = stereo_through(patch)
    (tap,) = place(patch, "tapout~ 250")
    patch.connect([tap.outs[0], plug_out.ins[0]], verbose=False)
    assert any("tapin~" in message for message in save_warnings(patch, tmp_path))


def test_m4l_06_an_instrument_needs_midi_in(tmp_path):
    """M4L-06, closed. The device type is a contract. An instrument with no MIDI input cannot be played."""
    patch = mp.MaxPatch(verbose=False)
    osc, plug_out = place(patch, "cycle~ 440", "plugout~")
    patch.connect([osc.outs[0], plug_out.ins[0]], verbose=False)
    assert any("no MIDI input" in message for message in save_warnings(patch, tmp_path, device_type="instrument"))


def test_m4l_06_an_audio_effect_needs_audio_in(tmp_path):
    """M4L-06, closed. An audio effect that never reads plugin~ ignores the track it sits on."""
    patch = mp.MaxPatch(verbose=False)
    osc, plug_out = place(patch, "cycle~ 440", "plugout~")
    patch.connect([osc.outs[0], plug_out.ins[0]], verbose=False)
    assert any("never reads plugin~" in message for message in save_warnings(patch, tmp_path))


def test_m4l_07_a_dial_range_is_checked_against_its_inlet(tmp_path):
    """M4L-07, closed for the inlets whose range Max documents. A dial that sweeps 40..18000
    is wired to svf~'s resonance, which takes 0..1."""
    patch = mp.MaxPatch(verbose=False)
    plug_in, plug_out = place(patch, "plugin~", "plugout~")
    filt, dial, limit = place(patch, "svf~ 1000. 0.5", "live.dial", "clip~ -1. 1.")
    dial.parameter("Cutoff", 40, 18000)
    patch.connect([plug_in.outs[0], filt.ins[0]], [filt.outs[0], limit.ins[0]], [limit.outs[0], plug_out.ins[0]],
                  [dial.outs[0], filt.ins[2]], verbose=False)
    (message,) = save_warnings(patch, tmp_path)
    assert "'Cutoff'" in message and "40 to 18000" in message and "resonance" in message and "0 to 1" in message


def test_m4l_08_parameter_names_are_unique(tmp_path):
    """M4L-08, closed. Live identifies a parameter by its long name, so two dials cannot share one."""
    patch = mp.MaxPatch(verbose=False)
    plug_in, plug_out = place(patch, "plugin~", "plugout~")
    for side, dial, gain in zip((0, 1), place(patch, "live.dial", "live.dial"), place(patch, "*~", "*~")):
        dial.parameter("Gain", 0, 1)
        patch.connect([dial.outs[0], gain.ins[1]], [plug_in.outs[side], gain.ins[0]],
                      [gain.outs[0], plug_out.ins[side]], verbose=False)
    (message,) = save_warnings(patch, tmp_path)
    assert "2 parameters are named 'Gain'" in message


def test_m4l_09_output_level_is_bounded(tmp_path):
    """M4L-09, closed. The project's own rule is clip~ -1. 1. before plugout~."""
    patch = mp.MaxPatch(verbose=False)
    plug_in, gain, plug_out = place(patch, "plugin~", "*~ 4.", "plugout~")
    patch.connect([plug_in.outs[0], gain.ins[0]], [gain.outs[0], plug_out.ins[0]], verbose=False)
    (message,) = save_warnings(patch, tmp_path)
    assert "4 times full scale" in message and "clip~ -1. 1." in message


def test_m4l_10_a_parameter_controls_something(tmp_path):
    """M4L-10, closed. A dial wired to nothing shows up in Live as a parameter that does nothing."""
    patch = mp.MaxPatch(verbose=False)
    stereo_through(patch)
    place(patch, "live.dial")
    (message,) = save_warnings(patch, tmp_path)
    assert "parameter with no cords" in message


def test_the_smallest_audio_effect_saves_with_no_warning(tmp_path):
    """The base the tests above build on is itself clean, so each of them sees its own warning."""
    patch = mp.MaxPatch(verbose=False)
    stereo_through(patch)
    assert save_warnings(patch, tmp_path) == []


# ── what already works, so the log does not overstate ──────────────────────────

def test_audio_into_a_dial_is_caught(tmp_path):
    """The cord check has type data for the Max for Live objects: this one is flagged."""
    patch = mp.MaxPatch(verbose=False)
    plug_in, dial = place(patch, "plugin~", "live.dial")
    patch.connect([plug_in.outs[0], dial.ins[0]], verbose=False)
    assert patch.get_coverage()["cords"]["flagged"] == 1


def test_ezdac_in_a_device_is_caught(tmp_path):
    """The graph check knows that inside a device ezdac~ is not an output."""
    patch = mp.MaxPatch(verbose=False)
    osc, dac = place(patch, "cycle~ 440", "ezdac~")
    patch.connect([osc.outs[0], dac.ins[0]], verbose=False)
    assert any("never reaches an output" in message for message in save_warnings(patch, tmp_path))


# ── M4L-11: audio objects whose inlets Max's own reference leaves untyped ─────────

def test_m4l_11_a_cord_into_cosh_is_judged():
    """M4L-11, closed. cosh~'s reference page has a placeholder where the inlet type goes,
    so the type table said "any" and a cord into it was "not checked". The table now reads
    the rest of the page: an MSP object with a signal method takes audio at its first inlet."""
    patch = mp.MaxPatch(verbose=False)
    osc, shaper = place(patch, "cycle~ 440", "cosh~")
    patch.connect([osc.outs[0], shaper.ins[0]], verbose=False)
    assert patch.get_coverage()["cords"]["not_checked"] == 0


def test_m4l_11_tanh_is_judged():
    """The member of that family the generator uses. It was set by hand first."""
    patch = mp.MaxPatch(verbose=False)
    osc, shaper = place(patch, "cycle~ 440", "tanh~")
    patch.connect([osc.outs[0], shaper.ins[0]], verbose=False)
    assert patch.get_coverage()["cords"]["not_checked"] == 0
