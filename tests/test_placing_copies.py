"""Placing an object never aliases a stub or an object already in a patch."""

import warnings

import pytest

import maxpylang as mp
from maxpylang.objects import cycle_tilde, metro


@pytest.fixture(autouse=True)
def _quiet():
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        yield


def test_calling_a_stub_builds_a_new_object_with_args():
    osc = cycle_tilde(440)
    assert osc is not cycle_tilde
    assert osc.name == "cycle~"
    assert osc._args == [440]
    assert cycle_tilde._args == []


def test_calling_a_stub_turns_keywords_into_box_attributes():
    met = metro(500, active=1)
    assert met._args == [500]
    assert met._text_attribs == {"active": ["1"]}


def test_placing_a_stub_twice_gives_two_objects():
    patch = mp.MaxPatch(verbose=False)
    a = patch.place(cycle_tilde)[0]
    b = patch.place(cycle_tilde)[0]
    assert a is not b
    assert a is not cycle_tilde and b is not cycle_tilde


def test_placing_a_stub_leaves_the_stub_unplaced():
    patch = mp.MaxPatch(verbose=False)
    osc = patch.place(cycle_tilde)[0]
    patch.connect((osc.outs[0], osc.ins[0]), verbose=False)
    assert cycle_tilde.outs[0].destinations == []


def test_placing_one_object_many_times_gives_distinct_objects():
    patch = mp.MaxPatch(verbose=False)
    obj = mp.MaxObject("cycle~ 440")
    placed = patch.place(obj, num_objs=3)
    assert placed[0] is obj
    assert len({id(o) for o in placed}) == 3
    assert patch.objs == {"obj-1": placed[0], "obj-2": placed[1], "obj-3": placed[2]}


def saved_cords(patch):
    """(source id, destination id) of every patchline, checking both ends are boxes in the patch."""
    patcher = patch.get_json()["patcher"]
    box_ids = {box["box"]["id"] for box in patcher["boxes"]}
    cords = [(line["patchline"]["source"][0], line["patchline"]["destination"][0])
             for line in patcher["lines"]]
    assert all(src in box_ids and dst in box_ids for src, dst in cords), cords
    return sorted(cords)


def test_replace_keeps_cords_on_both_sides():
    patch = mp.MaxPatch(verbose=False)
    osc, gain, dac = patch.place("cycle~ 440", "*~ 0.5", "ezdac~")
    patch.connect((osc.outs[0], gain.ins[0]), (gain.outs[0], dac.ins[0]), verbose=False)
    patch.replace("obj-2", "*~ 0.25", verbose=False)
    assert saved_cords(patch) == [("obj-1", "obj-2"), ("obj-2", "obj-3")]
    assert patch.objs["obj-2"].ins[0].sources == [osc.outs[0]]


def test_replace_in_a_long_connected_chain():
    patch = mp.MaxPatch(verbose=False)
    chain = patch.place(*["*~ 0.5"] * 100)
    for a, b in zip(chain, chain[1:]):
        patch.connect((a.outs[0], b.ins[0]), verbose=False)
    patch.replace("obj-1", "*~ 0.25", verbose=False)
    assert len(saved_cords(patch)) == 99


def test_replacing_with_a_stub_leaves_the_stub_untouched():
    patch = mp.MaxPatch(verbose=False)
    osc, gain = patch.place("cycle~ 440", "*~ 0.5")
    patch.connect((osc.outs[0], gain.ins[0]), verbose=False)
    patch.replace("obj-1", cycle_tilde, verbose=False)
    assert cycle_tilde.outs[0].destinations == []
    assert saved_cords(patch) == [("obj-1", "obj-2")]


def test_placing_a_connected_object_again_copies_it_without_cords():
    patch = mp.MaxPatch(verbose=False)
    a, b = patch.place("cycle~ 440", "ezdac~")
    patch.connect((a.outs[0], b.ins[0]), verbose=False)
    a2 = patch.place(a)[0]
    assert a2 is not a
    assert a2.outs[0].destinations == []
    patch.delete(objs=["obj-2"], verbose=False)
    assert saved_cords(patch) == []


def test_objects_loaded_from_a_file_are_copied_when_placed_again(tmp_path):
    patch = mp.MaxPatch(verbose=False)
    patch.place("cycle~ 440")
    patch.save(str(tmp_path / "one.maxpat"), verbose=False)
    loaded = mp.MaxPatch(load_file=str(tmp_path / "one.maxpat"), verbose=False)
    again = loaded.place(loaded.objs["obj-1"])[0]
    assert again is not loaded.objs["obj-1"]
    assert sorted(loaded.objs) == ["obj-1", "obj-2"]


def test_a_deleted_object_can_be_placed_again_as_itself():
    patch = mp.MaxPatch(verbose=False)
    obj = patch.place("cycle~ 440")[0]
    patch.delete(objs=["obj-1"], verbose=False)
    assert patch.place(obj)[0] is obj


def test_calling_a_declared_abstraction_keeps_its_inlets_and_outlets():
    synth = mp.MaxObject("my_synth", abstraction=True, inlets=2, outlets=3)
    voiced = synth(440)
    assert voiced._args == [440]
    assert (len(voiced.ins), len(voiced.outs)) == (2, 3)
    assert not voiced.notknown()


def test_connecting_a_stub_itself_raises():
    # place() copies a stub, so wiring the stub would save no cord; fail loudly instead
    from maxpylang.objects import cycle_tilde, ezdac_tilde

    patch = mp.MaxPatch(verbose=False)
    patch.place(cycle_tilde, verbose=False)
    dac = patch.place(ezdac_tilde, verbose=False)[0]
    with pytest.raises(ValueError, match="cycle~.*stub"):
        patch.connect([cycle_tilde.outs[0], dac.ins[0]], verbose=False)


def test_reusing_a_placed_non_stub_object_still_works():
    # the common pattern: make an object, place it, keep using the same variable
    patch = mp.MaxPatch(verbose=False)
    osc = mp.MaxObject("cycle~ 440")
    dac = mp.MaxObject("ezdac~")
    patch.place(osc, dac, verbose=False)
    patch.connect([osc.outs[0], dac.ins[0]], verbose=False)
    assert len(patch.get_json()["patcher"]["lines"]) == 1

