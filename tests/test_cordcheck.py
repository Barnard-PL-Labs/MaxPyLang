"""The runtime cord check: audio into an inlet that takes no audio."""

import contextlib
import io
import json
import warnings
from pathlib import Path

import pytest

import maxpylang as mp
from maxpylang import ConnectionWarning
from maxpylang.cordcheck import coverage, outlet_rate, rate_of, unchecked, verdict
from maxpylang.objects import cycle_tilde, flonum

SNIPPET = Path(__file__).parent / "typing_snippets" / "connections.py"


def connection_warnings(caught):
    return [w for w in caught if issubclass(w.category, ConnectionWarning)]


def run_snippet_line_by_line():
    """Run the typing snippet one statement at a time; return {line: outcome}."""
    lines = SNIPPET.read_text().splitlines()
    first = next(n for n, line in enumerate(lines) if line.startswith("# valid"))
    namespace = {}
    with contextlib.redirect_stdout(io.StringIO()), warnings.catch_warnings():
        warnings.simplefilter("ignore")
        exec(compile("\n".join(lines[:first]), str(SNIPPET), "exec"), namespace)

    outcomes = {}
    for n, line in enumerate(lines[first:], start=first + 1):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        code = compile("\n" * (n - 1) + line, str(SNIPPET), "exec")
        with contextlib.redirect_stdout(io.StringIO()), warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            try:
                exec(code, namespace)
            except (IndexError, AssertionError) as error:
                outcomes[n] = type(error).__name__
                continue
        outcomes[n] = "warned" if connection_warnings(caught) else "quiet"
    return outcomes, lines


def test_runtime_flags_what_the_type_checkers_flag_plus_their_blind_spots():
    outcomes, lines = run_snippet_line_by_line()
    def marked(suffix):
        return {n for n, line in enumerate(lines, start=1) if line.rstrip().endswith(suffix)}

    index_section = next(n for n, line in enumerate(lines, start=1) if line.startswith("# index past"))
    audio_errors = {n for n in marked("# error") if n < index_section}
    other_errors = marked("# error") - audio_errors
    blind_spots = marked("warns at runtime")

    raised = {n for n, outcome in outcomes.items() if outcome in ("IndexError", "AssertionError")}
    warned = {n for n, outcome in outcomes.items() if outcome == "warned"}

    # index and argument-order mistakes already fail at runtime, before the cord check
    assert raised == other_errors
    # every audio mistake a type checker flags, plus the ones it cannot see, and nothing else
    assert len(blind_spots) == 2
    assert warned == audio_errors | blind_spots


@pytest.mark.parametrize("style", ["string+list", "string+tuple", "stub+list", "stub+tuple"])
def test_every_code_style_warns(style):
    patch = mp.MaxPatch(verbose=False)
    if style.startswith("string"):
        osc = patch.place("cycle~ 440", verbose=False)[0]
        num = patch.place("flonum", verbose=False)[0]
    else:
        osc = patch.place(cycle_tilde(440), verbose=False)[0]
        num = patch.place(flonum, verbose=False)[0]
    cord = [osc.outs[0], num.ins[0]] if style.endswith("list") else (osc.outs[0], num.ins[0])

    with pytest.warns(ConnectionWarning, match=r"cycle~ \(obj-1\) outlet 0 sends audio.*flonum \(obj-2\) inlet 0.*snapshot~"):
        patch.connect(cord, verbose=False)


def test_valid_cords_do_not_warn():
    patch = mp.MaxPatch(verbose=False)
    osc, dac, snap, num, met, mc, mcdac = (patch.place(text, verbose=False)[0] for text in
        ("cycle~ 440", "ezdac~", "snapshot~", "flonum", "metro 500", "mc.cycle~", "mc.dac~"))
    with warnings.catch_warnings():
        warnings.simplefilter("error", ConnectionWarning)
        patch.connect([osc.outs[0], dac.ins[0]], [osc.outs[0], snap.ins[0]], [snap.outs[0], num.ins[0]],
                      [met.outs[0], osc.ins[0]], [mc.outs[0], mcdac.ins[0]], verbose=False)


def test_jitter_destination_gets_the_jit_catch_hint():
    patch = mp.MaxPatch(verbose=False)
    osc, graph = (patch.place(text, verbose=False)[0] for text in ("cycle~ 440", "jit.graph"))
    with pytest.warns(ConnectionWarning, match="jit.catch~"):
        patch.connect([osc.outs[0], graph.ins[0]], verbose=False)


def test_aliases_resolve_and_unknown_objects_are_not_checked():
    patch = mp.MaxPatch(verbose=False)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        trig, osc = (patch.place(text, verbose=False)[0] for text in ("t b b", "cycle~"))
        mystery = patch.place(mp.MaxObject("my_synth", abstraction=True, inlets=2, outlets=1), verbose=False)[0]
    assert verdict(trig.outs[0], osc.ins[0]) == "ok"        # `t` is described by trigger.json
    assert verdict(osc.outs[0], mystery.ins[0]) == "unknown"  # no type data: never a problem


def test_warning_points_at_the_callers_line():
    patch = mp.MaxPatch(verbose=False)
    osc, num = (patch.place(text, verbose=False)[0] for text in ("cycle~", "flonum"))
    with pytest.warns(ConnectionWarning) as caught:
        patch.connect([osc.outs[0], num.ins[0]], verbose=False)
    assert Path(caught[0].filename).name == "test_cordcheck.py"


def test_loading_a_patch_warns_about_its_cords(tmp_path):
    patch = mp.MaxPatch(verbose=False)
    osc, num = (patch.place(text, verbose=False)[0] for text in ("cycle~", "flonum"))
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", ConnectionWarning)
        patch.connect([osc.outs[0], num.ins[0]], verbose=False)
    with contextlib.redirect_stdout(io.StringIO()):
        patch.save(str(tmp_path / "bad"), verbose=False)

    with pytest.warns(ConnectionWarning, match="flonum"):
        mp.MaxPatch(load_file=str(tmp_path / "bad.maxpat"), verbose=False)


def test_save_reports_coverage(tmp_path, capsys):
    patch = mp.MaxPatch(verbose=False)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        osc, num, dac = (patch.place(text, verbose=False)[0] for text in ("cycle~", "flonum", "ezdac~"))
        mystery = patch.place(mp.MaxObject("my_synth", abstraction=True, inlets=2, outlets=1), verbose=False)[0]
        patch.connect([osc.outs[0], num.ins[0]], [osc.outs[0], dac.ins[0]], [osc.outs[0], mystery.ins[0]],
                      verbose=False)

    assert coverage(patch) == {"ok": 1, "problem": 1, "unknown": 1}
    patch.save(str(tmp_path / "p"), verbose=False)
    assert ("PatchCheck: cords : 3 cords, 1 sending audio into an inlet that takes none, "
            "1 not checked (no type data)") in capsys.readouterr().out


def mixed_patch():
    """Cords that can be checked next to ones that cannot: an abstraction, a subpatcher and
    an object that does not exist."""
    patch = mp.MaxPatch(verbose=False)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        osc, dac, sub, nope = (patch.place(text, verbose=False)[0]
                               for text in ("cycle~ 440", "ezdac~", "p sub", "notarealobject"))
        synth = patch.place(mp.MaxObject("my_synth", abstraction=True, inlets=2, outlets=1), verbose=False)[0]
        patch.connect([osc.outs[0], dac.ins[0]], [osc.outs[0], synth.ins[0]], [osc.outs[0], synth.ins[1]],
                      [synth.outs[0], dac.ins[1]], verbose=False)
    return patch


def test_unchecked_names_the_object_behind_each_cord_and_why():
    assert unchecked(mixed_patch()) == [("my_synth (obj-5)", "abstraction", 3)]


def test_unchecked_is_empty_when_every_cord_is_judged():
    patch = mp.MaxPatch(verbose=False)
    osc, dac = (patch.place(text, verbose=False)[0] for text in ("cycle~ 440", "ezdac~"))
    patch.connect([osc.outs[0], dac.ins[0]], verbose=False)
    assert unchecked(patch) == []


def test_get_coverage_counts_cords_and_objects_the_checks_could_not_judge():
    report = mixed_patch().get_coverage()
    assert report["cords"] == {"total": 4, "checked": 1, "flagged": 0, "not_checked": 3,
                               "not_checked_because": [("my_synth (obj-5)", "abstraction", 3)]}
    assert report["objects"] == {"total": 5, "not_seen_into": ["p (obj-3)", "notarealobject (obj-4)",
                                                               "my_synth (obj-5)"]}


def test_save_lists_what_was_not_checked(tmp_path, capsys):
    patch = mixed_patch()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        patch.save(str(tmp_path / "p"), verbose=False)
    out = capsys.readouterr().out
    assert "not checked: 3 on my_synth (obj-5) (abstraction)" in out
    assert "not seen into: p (obj-3), notarealobject (obj-4), my_synth (obj-5)" in out


def test_save_adds_no_line_when_everything_was_checked(tmp_path, capsys):
    patch = mp.MaxPatch(verbose=False)
    osc, dac = (patch.place(text, verbose=False)[0] for text in ("cycle~ 440", "ezdac~"))
    patch.connect([osc.outs[0], dac.ins[0]], verbose=False)
    patch.save(str(tmp_path / "p"), verbose=False)
    out = capsys.readouterr().out
    assert "not checked:" not in out and "not seen into:" not in out


def test_save_does_not_name_a_known_object_with_no_type_data(tmp_path, capsys):
    """limi~ is a real object whose inlets are not recorded as taking audio or not: the user
    cannot act on that, so save() only counts the cord. get_coverage() still names it."""
    patch = mp.MaxPatch(verbose=False)
    osc, limiter = (patch.place(text, verbose=False)[0] for text in ("cycle~ 440", "limi~"))
    patch.connect([osc.outs[0], limiter.ins[0]], verbose=False)
    assert patch.get_coverage()["cords"]["not_checked_because"] == [("limi~ (obj-2)", "no type data", 1)]
    patch.save(str(tmp_path / "p"), verbose=False)
    out = capsys.readouterr().out
    assert "1 not checked (no type data)" in out and "not checked:" not in out


def cord(source, dest, outlet=0, inlet=0):
    patch = mp.MaxPatch(verbose=False)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        src, dst = (patch.place(text, verbose=False)[0] for text in (source, dest))
        patch.connect([src.outs[outlet], dst.ins[inlet]], verbose=False)
    return verdict(src.outs[outlet], dst.ins[inlet])


def test_an_outlet_the_table_leaves_open_is_read_from_the_object():
    """line~ and groove~ have a count that changes with arguments, so the table gives their
    outlets no rate. The object's own outlet types do."""
    assert rate_of("line~", "outs", 0) is None and rate_of("groove~", "outs", 0) is None
    assert cord("line~", "ezdac~") == "ok"
    assert cord("line~", "metro 500") == "problem"
    assert cord("line~", "metro 500", outlet=1) == "ok"      # the done bang
    assert cord("groove~ buf 2", "metro 500", outlet=2) == "problem"   # the sync outlet is audio too


def test_play_has_an_outlet_per_channel_then_its_done_bang():
    assert cord("play~ buf 2", "metro 500", outlet=1) == "problem"
    assert cord("play~ buf 2", "metro 500", outlet=2) == "ok"
    assert cord("play~ buf", "metro 500", outlet=1) == "ok"


def test_outlets_made_by_what_is_inside_stay_unknown():
    for name in ("gen~", "js", "poly~"):
        assert outlet_rate(name, 0, ["signal"]) is None


def test_a_subpatcher_outlet_is_read_from_the_type_max_saved_on_its_box():
    """Max works out what a patcher's outlets send from what is inside and saves it."""
    for name in ("patcher", "bpatcher"):
        assert outlet_rate(name, 0, ["signal", "int"]) == "signal"
        assert outlet_rate(name, 1, ["signal", "int"]) == "control"


def test_an_empty_saved_type_is_evidence_only_when_the_contents_were_saved_too():
    """A box holds an empty type before Max has seen what is connected, as a new `p` placed
    by maxpylang does. Saved with its contents, an empty type means messages."""
    assert outlet_rate("patcher", 0, [""]) is None
    assert outlet_rate("patcher", 0, [""], seen_inside=True) == "control"


def test_an_inlet_object_is_read_from_its_saved_type_unless_that_is_audio():
    """An inlet that takes audio usually takes messages on the same cord, and what follows
    may be there to split them (BEAP's `routepass`), so it stays unknown."""
    assert outlet_rate("inlet", 0, ["int"]) == "control"
    assert outlet_rate("inlet", 0, ["jit_matrix"]) == "matrix"
    assert outlet_rate("inlet", 0, ["signal"]) is None
    assert outlet_rate("inlet", 0, [""], seen_inside=True) is None


def test_a_loaded_subpatcher_that_sends_audio_is_checked(tmp_path):
    inner = {"fileversion": 1, "boxes": [], "lines": []}
    def box(i, **more):
        return {"box": dict(id=f"obj-{i}", numinlets=1, patching_rect=[20.0, 40.0 * i, 60.0, 22.0], **more)}

    patcher = {"patcher": {"fileversion": 1, "rect": [0, 0, 400, 300], "boxes": [
        box(1, maxclass="newobj", text="p voice", numoutlets=1, outlettype=["signal"], patcher=inner),
        box(2, maxclass="toggle", numoutlets=1, outlettype=["int"], parameter_enable=0),
    ], "lines": [{"patchline": {"source": ["obj-1", 0], "destination": ["obj-2", 0]}}]}}
    path = tmp_path / "sub.maxpat"
    path.write_text(json.dumps(patcher))
    with contextlib.redirect_stdout(io.StringIO()), warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        patch = mp.MaxPatch(load_file=str(path), verbose=False)
    assert patch.get_coverage()["cords"]["flagged"] == 1
    assert len(connection_warnings(caught)) == 1


# ── inlets whose reference page gives no type ────────────────────────────────

@pytest.mark.parametrize("text", ["cosh~", "sinh~", "tanh~", "sinx~", "sig~", "click~", "phasewrap~", "receive~ a"])
def test_an_msp_object_with_a_signal_method_takes_audio_at_its_first_inlet(text):
    assert cord("cycle~ 440", text) == "ok"


def test_an_inlet_described_as_taking_audio_takes_audio():
    assert cord("cycle~ 440", "phasor~", inlet=1) == "ok"      # "Trigger Reset (signal)"
    assert cord("cycle~ 440", "buffir~ b", inlet=2) == "ok"    # "(int/float/sig) Length"
    assert cord("cycle~ 440", "poltocar~", inlet=1) == "ok"    # set by hand


def test_an_inlet_with_no_sign_of_audio_stays_unknown():
    assert cord("cycle~ 440", "number~", inlet=1) == "unknown"  # "Ramp time in Milliseconds"


# ── tap links ───────────────────────────────────────────────────────────────

def test_a_tap_link_fits_a_tapout_and_nothing_else():
    assert cord("tapin~ 1000", "tapout~ 250") == "ok"
    assert cord("tapin~ 1000", "*~ 0.5") == "problem"
    assert cord("tapin~ 1000", "print") == "problem"
    assert cord("mc.tapin~ 1000", "mc.tapout~ 250") == "ok"


def test_a_tapout_takes_a_delay_time_as_audio_or_a_number():
    assert cord("cycle~ 2", "tapout~ 250") == "ok"
    assert cord("flonum", "tapout~ 250") == "ok"


def test_a_tap_link_into_the_wrong_object_says_what_a_tap_link_is():
    patch = mp.MaxPatch(verbose=False)
    tapin, gain = (patch.place(text, verbose=False)[0] for text in ("tapin~ 1000", "*~ 0.5"))
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        patch.connect([tapin.outs[0], gain.ins[0]], verbose=False)
    (warning,) = connection_warnings(caught)
    assert "tap link" in str(warning.message) and "tapout~" in str(warning.message)


def test_gain_takes_audio_in_its_first_inlet_only():
    assert cord("cycle~ 440", "gain~") == "ok"
    assert cord("cycle~ 440", "gain~", inlet=1) == "problem"
    assert cord("gain~", "ezdac~") == "ok"


def test_a_long_list_of_unchecked_objects_is_cut_short(tmp_path, capsys):
    patch = mp.MaxPatch(verbose=False)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        patch.place("p sub", num_objs=8, verbose=False)
        patch.save(str(tmp_path / "p"), verbose=False)
    assert "p (obj-5), and 3 more" in capsys.readouterr().out


def test_multichannel_audio_into_control_warns():
    patch = mp.MaxPatch(verbose=False)
    mc, num = (patch.place(text, verbose=False)[0] for text in ("mc.cycle~", "flonum"))
    with pytest.warns(ConnectionWarning, match=r"mc\.cycle~ \(obj-1\) outlet 0 sends audio"):
        patch.connect([mc.outs[0], num.ins[0]], verbose=False)


def test_outlet_of_unknown_rate_is_not_checked():
    # an inlet passes on whatever the parent patch sends it, so nothing can type its outlet
    assert rate_of("inlet", "outs", 0) is None
    patch = mp.MaxPatch(verbose=False)
    inlet, num = (patch.place(text, verbose=False)[0] for text in ("inlet", "flonum"))
    assert verdict(inlet.outs[0], num.ins[0]) == "unknown"


def placed_bad_chain():
    """cycle~ -> snapshot~ -> flonum, all valid; replacing snapshot~ with `number` is not."""
    patch = mp.MaxPatch(verbose=False)
    osc, snap, num = (patch.place(text, verbose=False)[0] for text in ("cycle~", "snapshot~", "flonum"))
    patch.connect([osc.outs[0], snap.ins[0]], [snap.outs[0], num.ins[0]], verbose=False)
    return patch


def state(patch):
    json = patch.get_json()["patcher"]
    return (sorted((b["box"]["id"], b["box"]["text"]) for b in json["boxes"]),
            sorted((l["patchline"]["source"][0], l["patchline"]["destination"][0]) for l in json["lines"]))


def test_replace_warning_names_the_replaced_box():
    patch = placed_bad_chain()
    with contextlib.redirect_stdout(io.StringIO()), pytest.warns(ConnectionWarning, match=r"number \(obj-2\) inlet 0"):
        patch.replace("obj-2", "number")
    assert state(patch)[0][1] == ("obj-2", "number")


def test_replace_in_strict_mode_raises_before_changing_the_patch():
    patch = placed_bad_chain()
    before = state(patch)
    with contextlib.redirect_stdout(io.StringIO()), warnings.catch_warnings():
        warnings.simplefilter("error", ConnectionWarning)
        with pytest.raises(ConnectionWarning):
            patch.replace("obj-2", "number")
    assert state(patch) == before
