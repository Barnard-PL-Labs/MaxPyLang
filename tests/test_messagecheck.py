"""
The checks on the messages a cord carries (maxpylang/messagecheck.py): a message its object
has no method for, an object that answers before its right inlet is set, and an object fed
only on its right inlets.

tests/test_max_corpus.py runs the same checks over every patch that ships with Max. This
file covers the rules: what is reported, and what is left alone because it cannot be seen.
"""

import warnings

import pytest

import maxpylang as mp
from maxpylang.messagecheck import message_problems, messages_of, understands


def patch_of(*texts, cords=(), places=None):
    """A patch of these objects, numbered from 1, with cords (source, outlet, destination, inlet)."""
    patch = mp.MaxPatch(verbose=False)
    objs = []
    for index, text in enumerate(texts):
        if places:
            patch.set_position(*places[index])
        objs.append(patch.place(text, verbose=False)[0])
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        for source, outlet, dest, inlet in cords:
            patch.connect([objs[source - 1].outs[outlet], objs[dest - 1].ins[inlet]], verbose=False)
    return patch


def kinds(patch):
    return sorted(problem.kind for problem in message_problems(patch.get_json()["patcher"]))


# ── reading a message box ───────────────────────────────────────────────────────

@pytest.mark.parametrize("text, selectors", [
    ("start", ["start"]),
    ("440", ["int"]),
    ("0.5", ["float"]),
    ("-.5", ["float"]),
    ("60 100", ["list"]),
    ("bang", ["bang"]),
    ("interval 250", ["interval"]),
    ("stop, 0", ["stop", "int"]),
    ("1; pd dsp 1", ["int"]),            # after the semicolon it goes to a receive
    ("set $1", [None]),
    ("$1 100", [None]),
    ("", []),
])
def test_the_messages_a_message_box_sends(text, selectors):
    assert messages_of(text) == selectors


def test_what_an_object_understands():
    assert understands("metro", "stop") is True
    assert understands("metro", "interval") is True          # an attribute, set by a message
    assert understands("flonum", "razzledazzle") is False
    assert understands("gate", "float") is True
    assert understands("print", "whatever") is True          # it takes anything
    assert understands("toggle", "hidden") is True           # every box has this attribute
    assert understands("no.such.object", "bang") is None
    assert understands("jit.gl.gridshape", "drawto") is None  # its family's methods are elsewhere
    assert understands("outlet", "clear") is None
    assert understands("live.path", "bang") is True          # the page names it `bang, getid`
    assert understands("live.object", "id") is True          # and this one `id nn`
    assert understands("live.dial", "_parameter_range") is True   # on the shared parameters page
    assert understands("counter", "label") is False          # a note on an attribute, not a message
    assert understands("counter", "carryflag") is True


# ── a message with no method ────────────────────────────────────────────────────

def test_a_message_the_object_has_no_method_for():
    patch = patch_of("message razzledazzle", "flonum", cords=[(1, 0, 2, 0)])
    (problem,) = message_problems(patch.get_json()["patcher"])
    assert problem.kind == "message"
    assert "flonum: doesn't understand 'razzledazzle'" in problem.message


@pytest.mark.parametrize("texts, cords", [
    (("message stop", "metro 500"), [(1, 0, 2, 0)]),                  # a method
    (("message interval 250", "metro 500"), [(1, 0, 2, 0)]),          # an attribute
    (("message 440", "cycle~"), [(1, 0, 2, 0)]),                      # an int where a float is taken
    (("message whatever", "print"), [(1, 0, 2, 0)]),                  # takes anything
    (("message whatever", "gate"), [(1, 0, 2, 1)]),                   # a right inlet passes it on
    (("message whatever $1", "flonum"), [(1, 0, 2, 0)]),              # filled in when it is sent
    (("message whatever", "my.abstraction"), []),                     # nothing to judge
    (("button", "message razzledazzle", "message set stop", "flonum"),
     [(3, 0, 2, 0), (2, 0, 4, 0)]),                                   # the text can be set
])
def test_messages_that_are_understood_or_cannot_be_judged(texts, cords):
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        assert "message" not in kinds(patch_of(*texts, cords=cords))


def test_a_bang_into_an_object_that_takes_no_bang():
    """An outlet Max saves as bang is a known message too."""
    assert understands("mtof", "bang") is False
    patch = patch_of("loadbang", "mtof", cords=[(1, 0, 2, 0)])
    assert kinds(patch) == ["message"]


def test_the_warning_is_a_message_warning_at_save(tmp_path):
    patch = patch_of("message razzledazzle", "flonum", "print", cords=[(1, 0, 2, 0), (2, 0, 3, 0)])
    with pytest.warns(mp.MessageWarning, match="doesn't understand"):
        patch.save(str(tmp_path / "bad"), verbose=False)
    assert issubclass(mp.MessageWarning, mp.GraphWarning)


# ── order ───────────────────────────────────────────────────────────────────────

FAN = [(1, 0, 2, 0), (1, 0, 3, 0), (3, 0, 2, 1), (2, 0, 4, 0)]   # number -> + left, and -> * 2 -> + right


def test_the_left_inlet_is_reached_first_because_of_where_the_boxes_sit():
    """One outlet, two cords: Max sends to the box further right first."""
    wrong = patch_of("number", "+", "* 2", "print", cords=FAN, places=[(100, 50), (300, 200), (100, 120), (300, 260)])
    (problem,) = message_problems(wrong.get_json()["patcher"])
    assert problem.kind == "message order" and "trigger" in problem.message

    right = patch_of("number", "+", "* 2", "print", cords=FAN, places=[(100, 50), (100, 200), (300, 120), (100, 260)])
    assert kinds(right) == []


def test_boxes_that_overlap_side_to_side_are_not_judged():
    patch = patch_of("number", "+", "* 2", "print", cords=FAN, places=[(100, 50), (110, 200), (100, 120), (110, 260)])
    assert kinds(patch) == []


def test_a_trigger_says_the_order_so_nothing_is_reported():
    """`t f f` with the left inlet reached first is how a patch takes a difference."""
    cords = [(1, 0, 2, 0), (2, 1, 3, 0), (2, 0, 3, 1), (3, 0, 4, 0)]
    patch = patch_of("number", "t f f", "-", "print", cords=cords)
    assert kinds(patch) == []


def test_a_path_through_something_that_waits_is_not_judged():
    cords = [(1, 0, 2, 0), (1, 0, 3, 0), (3, 0, 2, 1), (2, 0, 4, 0)]
    patch = patch_of("number", "+", "pipe 100", "print", cords=cords,
                     places=[(100, 50), (300, 200), (100, 120), (300, 260)])
    assert kinds(patch) == []


def test_an_object_fed_only_on_its_right_inlet_never_fires():
    patch = patch_of("number", "+ 1", "print", cords=[(1, 0, 2, 1), (2, 0, 3, 0)])
    (problem,) = message_problems(patch.get_json()["patcher"])
    assert problem.kind == "never fires" and "left" in problem.message

    fed = patch_of("number", "+ 1", "print", "button", cords=[(1, 0, 2, 1), (2, 0, 3, 0), (4, 0, 2, 0)])
    assert kinds(fed) == []


def test_every_inlet_of_pak_is_hot():
    patch = patch_of("number", "pak 0 0", "print", cords=[(1, 0, 2, 1), (2, 0, 3, 0)])
    assert kinds(patch) == []


def test_check_prints_a_messages_line(capsys):
    patch = patch_of("message razzledazzle", "flonum", "print", cords=[(1, 0, 2, 0), (2, 0, 3, 0)])
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        patch.check("graph")
    assert "PatchCheck: messages : 1 message its object does not understand" in capsys.readouterr().out
