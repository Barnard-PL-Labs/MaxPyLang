"""The runtime cord check: audio into an inlet that takes no audio."""

import contextlib
import io
import warnings
from pathlib import Path

import pytest

import maxpylang as mp
from maxpylang import ConnectionWarning
from maxpylang.cordcheck import coverage, rate_of, verdict
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


def test_multichannel_audio_into_control_warns():
    patch = mp.MaxPatch(verbose=False)
    mc, num = (patch.place(text, verbose=False)[0] for text in ("mc.cycle~", "flonum"))
    with pytest.warns(ConnectionWarning, match=r"mc\.cycle~ \(obj-1\) outlet 0 sends audio"):
        patch.connect([mc.outs[0], num.ins[0]], verbose=False)


def test_outlet_of_unknown_rate_is_not_checked():
    # play~'s outlets depend on its channel count, so the data cannot type them
    assert rate_of("play~", "outs", 0) is None
    patch = mp.MaxPatch(verbose=False)
    play, num = (patch.place(text, verbose=False)[0] for text in ("play~ mybuffer", "flonum"))
    assert verdict(play.outs[0], num.ins[0]) == "unknown"


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
