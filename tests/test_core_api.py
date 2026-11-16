"""
Core MaxPyLang API: placing, moving, editing, special objects, saving and loading.

Tests marked xfail(strict=True) pin known bugs. They are expected to fail today; when a bug
is fixed its test passes, strict mode turns that into a failure, and the fix must remove
the marker. Each reason names the bug.
"""

import contextlib
import io
import warnings
from pathlib import Path

import pytest

import maxpylang as mp


@pytest.fixture
def patch():
    return mp.MaxPatch(verbose=False)


@pytest.fixture
def in_tmp(tmp_path, monkeypatch):
    # js files and abstractions are looked up in the current directory
    monkeypatch.chdir(tmp_path)
    return tmp_path


def quiet(fn, *args, **kwargs):
    """Call fn with maxpylang's console output and warnings suppressed."""
    with contextlib.redirect_stdout(io.StringIO()), warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return fn(*args, **kwargs)


def position(obj):
    return obj._dict["box"]["patching_rect"][:2]


def bug(reason):
    return pytest.mark.xfail(strict=True, reason=f"known bug: {reason}")


# ── placing ───────────────────────────────────────────────────────────────────

def test_place_returns_a_list_of_objects(patch):
    placed = patch.place("metro 500", "toggle", verbose=False)
    assert [obj.name for obj in placed] == ["metro", "toggle"]
    assert patch.num_objs == 2


def test_place_with_num_objs_makes_separate_objects(patch):
    placed = patch.place("toggle", num_objs=3, verbose=False)
    assert len(placed) == 3 and len({id(obj) for obj in placed}) == 3


def test_grid_placement_starts_one_step_right_of_the_cursor(patch):
    # Grid placement treats the cursor as the last slot and steps before placing, so the
    # next object lands one x-spacing (80) right of set_position's x. Docs that say
    # set_position(x, y) puts the next object at (x, y) disagree; this pins the code.
    patch.set_position(30, 100)
    obj = patch.place("metro", verbose=False)[0]
    assert position(obj) == [110, 100]


def test_custom_spacing_places_each_object_at_its_position(patch):
    placed = patch.place("metro", "toggle", spacing_type="custom", spacing=[[10, 20], [30, 40]], verbose=False)
    assert [position(obj) for obj in placed] == [[10, 20], [30, 40]]


@bug("place_vertical adds the vertical spacing to x, so the column drifts right")
def test_vertical_spacing_keeps_x(patch):
    placed = patch.place("metro", "toggle", "button", spacing_type="vertical", spacing=50,
                         starting_pos=[0, 0], verbose=False)
    assert {position(obj)[0] for obj in placed} == {0}


@bug("numpy is used but never imported in placing.py")
def test_random_spacing_places_every_object(patch):
    assert len(patch.place("metro", "toggle", spacing_type="random", seed=1, verbose=False)) == 2


@bug("numpy is used but never imported in placing.py")
def test_randpick_picks_the_requested_number(patch):
    assert len(patch.place("metro", "toggle", "button", randpick=True, num_objs=2, seed=1, verbose=False)) == 2


# ── objects ───────────────────────────────────────────────────────────────────

def test_place_prints_nothing_when_not_verbose(patch, capsys):
    patch.place("metro 500", "toggle", verbose=False)
    patch.place("toggle", num_objs=3, verbose=False)
    assert capsys.readouterr().out == ""


def test_move_sets_the_position():
    obj = mp.MaxObject("metro 500")
    obj.move(100, 50)
    assert position(obj) == [100, 50]


def test_edit_sets_an_int_attribute():
    obj = mp.MaxObject("metro 500")
    quiet(obj.edit, hidden=1)
    assert obj._dict["box"]["hidden"] == 1


def test_edit_sets_a_float_attribute():
    obj = mp.MaxObject("metro 500")
    quiet(obj.edit, fontsize=12.0)
    assert obj._dict["box"]["fontsize"] == 12.0


def test_text_args_and_attributes_are_kept():
    obj = mp.MaxObject("metro 500 @active 1")
    assert obj._dict["box"]["text"] == "metro 500 @active 1"


def test_unknown_object_warns_and_has_no_xlets():
    with pytest.warns(mp.exceptions.UnknownObjectWarning):
        obj = mp.MaxObject("notarealobject")
    assert obj.notknown() and obj.ins == [] and obj.outs == []


def test_pack_inlets_follow_its_arguments():
    assert len(mp.MaxObject("pack 0 0 0 0").ins) == 4


def test_switch_inlets_follow_its_argument():
    assert len(quiet(mp.MaxObject, "switch 1").ins) == 2
    assert len(mp.MaxObject("switch 3").ins) == 4
    assert len(mp.MaxObject("switch 3 1").ins) == 4     # the second argument is the open inlet


def test_a_named_receive_has_no_inlet():
    assert len(mp.MaxObject("receive").ins) == 1
    assert len(mp.MaxObject("receive foo").ins) == 0
    assert len(mp.MaxObject("r foo").ins) == 0


@pytest.mark.parametrize("before, after, counts", [
    ("pack 0 0 0 0 0", "pack 0 0 0 0", (4, 1)),     # one fewer: the old code kept one and dropped four
    ("pack 0 0 0 0 0", "pack 0 0", (2, 1)),
    ("gate 4", "gate 2", (2, 2)),
    ("gate 5", "gate 1", (2, 1)),
    ("unpack 0 0 0 0", "unpack 0 0 0", (1, 3)),
    ("switch 4", "switch 1", (2, 1)),
])
def test_edit_to_fewer_arguments_removes_xlets_from_the_end(before, after, counts):
    obj = mp.MaxObject(before)
    kept_in, kept_out = obj.ins[0], obj.outs[0]
    quiet(obj.edit, text_add="replace", text=after)
    assert (len(obj.ins), len(obj.outs)) == counts
    assert obj.ins[0] is kept_in and obj.outs[0] is kept_out
    box = obj._dict["box"]
    assert (box["numinlets"], box["numoutlets"], len(box["outlettype"])) == (*counts, counts[1])


def test_removing_an_inlet_removes_its_cords(patch, in_tmp):
    source, packer = patch.place("number", "pack 0 0 0", verbose=False)
    patch.connect([source.outs[0], packer.ins[0]], [source.outs[0], packer.ins[2]], verbose=False)
    quiet(packer.edit, text_add="replace", text="pack 0 0")
    assert source.outs[0].destinations == [packer.ins[0]]
    assert packer.ins[0].sources == [source.outs[0]]
    quiet(patch.save, "shrunk", verbose=False)


def test_removing_an_outlet_removes_its_cords(patch, in_tmp):
    gate, kept, dropped = patch.place("gate 3", "number", "number", verbose=False)
    patch.connect([gate.outs[0], kept.ins[0]], [gate.outs[2], dropped.ins[0]], [gate.outs[2], kept.ins[0]],
                  verbose=False)
    quiet(gate.edit, text_add="replace", text="gate 1")
    assert len(gate.outs) == 1
    assert dropped.ins[0].sources == [] and dropped.ins[0].midpoints == []
    assert kept.ins[0].sources == [gate.outs[0]] and len(kept.ins[0].midpoints) == 1
    quiet(patch.save, "shrunk", verbose=False)
    saved = mp.MaxPatch(load_file="shrunk.maxpat", verbose=False)
    assert len(saved.get_json()["patcher"]["lines"]) == 1


def test_gate_outlets_follow_its_argument():
    assert len(mp.MaxObject("gate 4").outs) == 4


def test_trigger_outlet_types_follow_its_arguments():
    assert mp.MaxObject("trigger b i")._dict["box"]["outlettype"] == ["bang", "int"]


def test_trigger_with_three_arguments_types_its_outlets():
    assert mp.MaxObject("trigger b i f")._dict["box"]["outlettype"] == ["bang", "int", "float"]


def test_unpack_float_arguments_give_float_outlets():
    assert mp.MaxObject("unpack 1. 2. 3.")._dict["box"]["outlettype"] == ["float", "float", "float"]


# ── js and abstractions ───────────────────────────────────────────────────────

def test_js_reads_its_inlet_and_outlet_counts_from_the_file(in_tmp):
    (in_tmp / "myscript.js").write_text("inlets = 2;\noutlets = 3;\n")
    obj = quiet(mp.MaxObject, "js myscript.js")
    assert (len(obj.ins), len(obj.outs)) == (2, 3)


def test_abstraction_reads_its_inlets_and_outlets_from_the_file(in_tmp):
    inner = mp.MaxPatch(verbose=False)
    inner.place("inlet", "inlet", "outlet", verbose=False)
    quiet(inner.save, "my_abs", verbose=False)

    obj = quiet(mp.MaxObject, "my_abs")
    assert not obj.notknown()
    assert (len(obj.ins), len(obj.outs)) == (2, 1)


def test_declared_abstraction_needs_no_file():
    obj = mp.MaxObject("my_synth 440", abstraction=True, inlets=2, outlets=1)
    assert not obj.notknown() and (len(obj.ins), len(obj.outs)) == (2, 1)


# ── connecting, deleting, saving, loading ─────────────────────────────────────

def built_patch():
    patch = mp.MaxPatch(verbose=False)
    met, tog, num = patch.place("metro 500", "toggle", "number", verbose=False)
    patch.connect((tog.outs[0], met.ins[0]), (met.outs[0], num.ins[0]), verbose=False)
    return patch


def contents(patch):
    json = patch.get_json()["patcher"]
    return (sorted((b["box"]["id"], b["box"]["text"] if "text" in b["box"] else b["box"]["maxclass"])
                   for b in json["boxes"]),
            sorted((tuple(l["patchline"]["source"]), tuple(l["patchline"]["destination"])) for l in json["lines"]))


def test_save_then_load_gives_the_same_patch(in_tmp):
    patch = built_patch()
    quiet(patch.save, "round_trip", verbose=False)
    loaded = mp.MaxPatch(load_file="round_trip.maxpat", verbose=False)
    assert contents(loaded) == contents(patch)


def test_delete_removes_the_object_and_its_cords():
    patch = built_patch()
    quiet(patch.delete, objs=["obj-1"], verbose=False)
    boxes, lines = contents(patch)
    assert "obj-1" not in [box_id for box_id, _ in boxes]
    assert lines == []


def test_delete_a_cord_keeps_the_objects():
    patch = built_patch()
    tog, met = patch.objs["obj-2"], patch.objs["obj-1"]
    quiet(patch.delete, cords=[(tog.outs[0], met.ins[0])], verbose=False)
    boxes, lines = contents(patch)
    assert len(boxes) == 3 and lines == [(("obj-1", 0), ("obj-3", 0))]


def test_reorder_renumbers_without_gaps():
    patch = built_patch()
    quiet(patch.delete, objs=["obj-1"], verbose=False)
    quiet(patch.reorder)
    assert sorted(patch.objs) == ["obj-1", "obj-2"]


def test_replace_keeps_cords_on_inlets_and_outlets_that_still_exist():
    patch = built_patch()
    quiet(patch.replace, "obj-1", "metro 250")
    boxes, lines = contents(patch)
    assert ("obj-1", "metro 250") in boxes and len(lines) == 2


def test_check_lists_unknown_objects(capsys):
    patch = mp.MaxPatch(verbose=False)
    quiet(patch.place, "notarealobject", verbose=False)
    patch.check("unknown")
    assert "notarealobject" in capsys.readouterr().out


# ── source ────────────────────────────────────────────────────────────────────

def test_no_source_file_has_an_invalid_escape():
    # Python 3.12 prints a SyntaxWarning for these on first import, and a later version
    # will refuse to import the file.
    package = Path(mp.__file__).parent
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        for path in sorted(package.rglob("*.py")):
            compile(path.read_text(encoding="utf-8"), str(path), "exec")
