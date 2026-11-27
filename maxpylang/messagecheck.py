"""
messagecheck

Checks on the messages a cord carries, run when the patch is saved. The cord check types a
cord by rate (audio or not). These look at the message itself and at when it arrives.

    message          an object is sent a message it has no method for. Max prints
                     "doesn't understand" in its console and the object does nothing.
                     A message box `reset` into a counter, a bang into an object that
                     only takes numbers.

    message order    an object answers before its right inlet has the new value, so it
                     computes with the old one: one outlet has a cord to an object's left
                     inlet and a cord to a chain that ends in its right inlet, and the
                     boxes sit so that the left inlet is reached first. Max sends one
                     outlet's cords right to left by where the receiving boxes sit, so in
                     a generated patch the layout decides the arithmetic.
    never fires      an object with cords into its right inlets and none into its left.
                     Only the left inlet makes it answer, so it never sends anything.

    whole numbers    a float is sent into an operator that works in whole numbers, which
                     drops the fraction: a dial's 0 to 1 outlet into `* 100` gives 0 or
                     100. An operator is whole or float by its argument: `* 2` and `*`
                     are whole, `* 2.` is float, whatever arrives. Dropping the fraction
                     is often meant (a pixel, a MIDI note), so this is only reported when
                     the values are known to span 2 or less: a number in a message box,
                     or a Live parameter's range followed through arithmetic. Unrestricted
                     it reports 333 cords in Max's shipped patches. Also a `scale` whose
                     four arguments are all whole numbers, which then sends whole numbers
                     only: `scale 0 127 0 1` sends 0 or 1 and nothing between.

What a cord carries is known when it leaves a message box, whose text is the message; an
outlet Max saves a type for (bang, int, float); a UI box (a number box sends an int, a
button a bang); or an object whose output follows from its own text: `prepend open`,
`loadmess 1`, `pack 0 0`, an operator. A message box keeps its text unless it is sent set,
append or prepend, so it is only read when everything feeding it is known to send
something else. Following messages through these took the cords judged in Max's shipped
patches from 29,124 to 47,728, with the same seven reports. What an object
understands is in data/messages.json, built from Max's reference pages: its methods and its
attributes, which are set by a message of the same name. Only the left inlet is judged: a
gate, a switch or a router passes anything that arrives at its other inlets.

As everywhere in these checks, what cannot be seen causes no report: a message with $1 in
it, a message box whose text another object can set, an object that takes `anything`, a
subpatcher, an abstraction, a script. Message order is only reported when the two paths
are plain arithmetic that answers at once, and for boxes that do not overlap side to side.
A trigger wired so that the left inlet is reached first is not reported: the order was
written out, and it is how a patch takes the difference from the last value.

Against the 3,122 patches that ship with Max: see tests/test_max_corpus.py.

    message_problems() --> these problems for a whole .maxpat or .amxd patcher
    messages_of()      --> the messages a message box sends out its outlet
"""

import functools
import json
import math
import re
from pathlib import Path

from .graphcheck import Problem, _is, _known, _words

_DATA = Path(__file__).resolve().parent / "data"
_NUMBER = re.compile(r"-?(\d+\.?\d*|\.\d+)(e-?\d+)?$")
_INT = re.compile(r"-?\d+$")
# messages that change what a message box holds
_SETTERS = ("set", "append", "prepend")
_TYPED_OUTLETS = ("bang", "int", "float")


@functools.lru_cache(maxsize=None)
def vocabulary():
    """{object name: (methods, attributes)}, as frozensets."""
    with open(_DATA / "messages.json", encoding="utf-8") as f:
        table = json.load(f)
    with open(_DATA / "messages_extra.json", encoding="utf-8") as f:
        extra = json.load(f)
    return {name: (frozenset(entry["methods"]) | frozenset(extra.get(name, ())), frozenset(entry["attributes"]))
            for name, entry in table.items() if not name.startswith("_")}


def messages_of(text):
    """
    The selectors of the messages a message box sends out its outlet: "int", "float",
    "list", "bang", or the first word of any other message. None in place of one that
    cannot be read off the text ($1, a quoted or escaped word). What follows a semicolon goes
    to a receive, not out the outlet, so it is left out.
    """
    found = []
    for part in text.split(";")[0].split(","):
        atoms = part.split()
        if not atoms:
            continue
        first = atoms[0]
        if any(mark in part for mark in ("\\", '"')) or "$" in first or "#" in first:
            found.append(None)
        elif _NUMBER.match(first):
            found.append("list" if len(atoms) > 1 else "int" if _INT.match(first) else "float")
        else:
            found.append(first)
    return found


@functools.lru_cache(maxsize=None)
def _box_attributes():
    """Attributes every box has (hidden, presentation, fontsize...), set by a message too."""
    from .tools.constants import common_box_attribs
    return frozenset(spec["name"] for spec in common_box_attribs)


def understands(name, selector):
    """True, False, or None if not known, for whether the object has a use for a message."""
    # what these do with a message is somewhere else: inside them, in the parent patch, or
    # in methods their whole family shares (Jitter's ob3d and matrix operators, the mc.
    # wrapper), which each reference page does not repeat. A gen object takes a message for
    # each param its patcher declares
    if (_is({name}, "opaque") or _is({name}, "part_of_a_bigger_patch") or _is({name}, "may_hold_the_other_end")
            or name.startswith(("jit.", "mc.", "mcs.", "gen"))):
        return None
    entry = vocabulary().get(name)
    if entry is None:
        return None
    methods, attributes = entry
    if not methods:
        return None
    if "anything" in methods:
        return True
    if selector in ("int", "float", "list"):
        return bool(methods & {"int", "float", "list"})
    if selector in methods or selector in attributes or selector in _box_attributes():
        return True
    if selector.startswith("_parameter_"):   # a Live parameter's settings, documented on one shared page
        return True
    if selector.startswith("get") and selector[3:] in attributes:
        return True
    return False


def _name(box):
    return _words(box)[0] or box.get("maxclass", "")


def _typed(box):
    words = (box.get("text") or "").split()
    return words[0] if box.get("maxclass") == "newobj" and words else box.get("maxclass", "")


def _label(box):
    return f"{_typed(box)} ({box.get('id')})"


def _patchers(patcher):
    todo = [patcher]
    while todo:
        current = todo.pop()
        yield current
        for entry in current.get("boxes", []):
            inner = entry.get("box", {}).get("patcher")
            if isinstance(inner, dict) and inner.get("classnamespace", "box") == "box":
                todo.append(inner)


# what a box sends out its left outlet whatever it is sent, by its class
_UI_SENDS = {"number": "int", "flonum": "float", "toggle": "int", "button": "bang", "slider": "int", "dial": "int",
             "live.dial": "float", "live.slider": "float", "live.numbox": "float", "live.toggle": "int",
             "live.tab": "int", "live.menu": "int", "umenu": "int"}
_NUMBERS_OUT = {"scale", "expr", "mtof", "ftom", "clip", "abs", "dbtoa", "atodb", "pow", "sqrt", "random", "drunk"}
_A = {"bang": "a bang", "int": "an int", "float": "a float", "list": "a list"}


def _sent(boxes, into, source, outlet, seen=frozenset()):
    """[(selector, how the message reads)] for what an outlet sends, or [] if not known."""
    if source in seen or len(seen) > 8:
        return []
    box = boxes[source]
    maxclass = box.get("maxclass")
    if maxclass == "message":
        if outlet != 0 or into.get((source, 1)):
            return []
        # a set, append or prepend sent to the box changes its text, so everything that
        # feeds it must be known to send something else
        for feeder, feeder_outlet in into.get((source, 0), ()):
            arriving = _sent(boxes, into, feeder, feeder_outlet, seen | {source})
            if not arriving or any(selector in _SETTERS for selector, _ in arriving):
                return []
        return [(selector, f"`{box.get('text', '').strip()}`") for selector in messages_of(box.get("text") or "")
                if selector is not None]
    if maxclass in _UI_SENDS:
        if outlet != 0:
            return []
        kind = _UI_SENDS[maxclass]
        return [(kind, _A[kind])]
    if maxclass != "newobj" or "patcher" in box:
        return []
    name, args = _words(box)
    if name not in _known() or _is({name}, "opaque"):
        return []
    types = box.get("outlettype") or []
    if outlet < len(types) and types[outlet] in _TYPED_OUTLETS:
        kind = types[outlet]
        return [(kind, _A[kind])]
    if outlet != 0:
        return []
    if name == "loadmess":
        text = " ".join(args)
        return [(selector, f"`{text}`") for selector in messages_of(text) if selector is not None]
    if name == "prepend" and args and messages_of(args[0]) not in ([None], []):
        first = messages_of(args[0])[0]
        # a number in front makes a list of whatever follows
        return [("list", _A["list"])] if first in ("int", "float") else [(first, f"a message starting `{args[0]}`")]
    # a pack whose first item is a number sends a list; with a word first (`pak slide 0 0`)
    # the word is the message
    if name in ("pack", "pak") and len(args) != 1 and (not args or args[0] in ("i", "f") or _NUMBER.match(args[0])):
        return [("list", _A["list"])]
    if _operator_sends(box) is not None:
        return [(_operator_sends(box), _A[_operator_sends(box)])]
    if name in _NUMBERS_OUT:
        return [("float", "a number")]
    return []


def _names(box):
    return {_name(box), _typed(box)}


def _fires_before(first, second):
    """True if Max sends to box `first` before box `second` when one outlet feeds both:
    right to left, then bottom to top. None if the boxes overlap side to side, where the
    answer hangs on which point of the box Max measures."""
    a, b = first.get("patching_rect"), second.get("patching_rect")
    if not a or not b or len(a) < 4 or len(b) < 4:
        return None
    if a[0] >= b[0] + b[2]:
        return True
    if b[0] >= a[0] + a[2]:
        return False
    return None


def _order_problems(boxes, cords):
    out = {}      # (box, outlet) -> [(destination, inlet)]
    fed = {}      # box -> inlets with a cord
    sends = set()
    for source, outlet, dest, inlet in cords:
        out.setdefault((source, outlet), []).append((dest, inlet))
        fed.setdefault(dest, set()).add(inlet)
        sends.add(source)

    def cold(box_id, inlet):
        return inlet > 0 and _is(_names(boxes[box_id]), "right_inlets_cold")

    def reaches_cold_inlet_of(start, start_inlet, target):
        """True if a message into `start` gets to a right inlet of `target` at once,
        through arithmetic alone."""
        todo, seen = [(start, start_inlet)], set()
        while todo and len(seen) < 64:
            box_id, inlet = todo.pop()
            if box_id == target:
                if cold(box_id, inlet):
                    return True
                continue
            if box_id in seen or inlet != 0 or not _is(_names(boxes[box_id]), "answers_at_once"):
                continue
            seen.add(box_id)
            for outlet in range(boxes[box_id].get("numoutlets", 0)):
                todo += out.get((box_id, outlet), ())
        return False

    problems = []

    def report(source, target, how):
        problems.append(Problem(
            "message order",
            f"{_label(boxes[target])} answers before its right inlet has the new value from "
            f"{_label(boxes[source])}, so it computes with the old one: {how}",
            [source, target]))

    for (source, outlet), dests in out.items():
        box = boxes[source]
        types = box.get("outlettype") or []
        if outlet < len(types) and types[outlet] in ("signal", "multichannelsignal"):
            continue
        hot = [dest for dest, inlet in dests if inlet == 0 and _is(_names(boxes[dest]), "right_inlets_cold")]
        for target in hot:
            # one outlet, two cords: the boxes' places decide which is sent first
            for dest, inlet in dests:
                if dest == target or not reaches_cold_inlet_of(dest, inlet, target):
                    continue
                if _fires_before(boxes[target], boxes[dest]):
                    report(source, target,
                           f"both cords leave one outlet, and Max sends to the box further right first, which "
                           f"is {_label(boxes[target])}. Use a `trigger` to fix the order: its right outlet to "
                           f"{_label(boxes[dest])}, its left to {_label(boxes[target])}.")
                    break

    for box_id, inlets in fed.items():
        box = boxes[box_id]
        if (0 not in inlets and box_id in sends and box.get("maxclass") == "newobj"
                and _is(_names(box), "right_inlets_cold") and "patcher" not in box):
            problems.append(Problem(
                "never fires",
                f"{_label(box)} has cords into its right inlet{'s' if len(inlets) > 1 else ''} and none into "
                "its left. Only the left inlet makes it answer, so it never sends anything. Send the "
                "value that should trigger it to the left inlet.", [box_id]))
    return problems


# whole or float by their argument: `* 2` is whole, `* 2.` is float
_ARITHMETIC = {"plus", "minus", "times", "div", "rminus", "rdiv", "modulo"}
# these compare in whole numbers or floats by their argument, and send 0 or 1
_COMPARISONS = {"equals", "notequals", "lessthan", "greaterthan", "lessthaneq", "greaterthaneq"}
# these work in whole numbers whatever their argument, so no argument keeps a fraction
_BITWISE = {"logand", "logor", "bitand", "bitor", "shiftleft", "shiftright"}
_FLOAT_OUT = {"mtof", "dbtoa", "atodb", "sqrt", "snapshot~", "peakamp~", "sin", "cos", "tan", "atan", "atan2",
              "pow", "exp", "log"}
_LIVE_NUMBERS = ("live.dial", "live.slider", "live.numbox")
_NARROW = 2   # a range this wide or less has almost nothing left once the fraction is gone


def _works_in(box):
    """ "int" or "float" for what an arithmetic or comparison operator computes in, by its
    argument. None for any other box, and for an argument filled in later (#1)."""
    name, args = _words(box)
    if name not in _ARITHMETIC and name not in _COMPARISONS:
        return None
    if not args:
        return "int"
    if not _NUMBER.match(args[0]):
        return None
    return "int" if _INT.match(args[0]) else "float"


def _operator_sends(box):
    """ "int" or "float" for the numbers an operator sends, or None if it is not one."""
    name, _ = _words(box)
    if name in _COMPARISONS or name in _BITWISE:
        return "int"
    return _works_in(box)


def _whole_scale(box):
    """A scale's four arguments if they are all whole numbers, which makes its output whole."""
    name, args = _words(box)
    if name != "scale" or len(args) != 4 or not all(_INT.match(arg) for arg in args):
        return None
    return [int(arg) for arg in args]


def number_kind(boxes, into, source, outlet):
    """ "float" or "int" for the numbers an outlet sends, or None if not known. An operator
    sends what it works in, whatever it is sent, so this needs no walk back up the patch."""
    box = boxes[source]
    maxclass = box.get("maxclass")
    if maxclass == "message":
        sent = _sent(boxes, into, source, outlet)
        return sent[0][0] if len(sent) == 1 and sent[0][0] in ("int", "float") else None
    if outlet == 0 and maxclass in ("flonum", "number"):
        return "float" if maxclass == "flonum" else "int"
    if maxclass in _LIVE_NUMBERS:
        if outlet == 1:
            return "float"   # the value as 0 to 1
        block = (box.get("saved_attribute_attributes") or {}).get("valueof") or {}
        # Max leaves the type out of the block when it is the default, a float
        return {0: "float", 1: "int"}.get(block.get("parameter_type", 0)) if outlet == 0 else None
    if maxclass != "newobj" or "patcher" in box:
        return None
    name, _ = _words(box)
    if name in _ARITHMETIC | _COMPARISONS | _BITWISE:
        return _operator_sends(box) if outlet == 0 else None
    if name == "scale":
        return "int" if _whole_scale(box) else None
    if name in _FLOAT_OUT and outlet == 0:
        return "float"
    types = box.get("outlettype") or []
    if (name in _known() and not _is({name}, "opaque") 
            and outlet < len(types) and types[outlet] in ("int", "float")):
        return types[outlet]
    return None


def _number_problems(current, boxes, into, cords):
    from .devicecheck import _Patcher
    graph = _Patcher(current)
    problems = []
    for box_id, box in boxes.items():
        args = _whole_scale(box)
        # whole numbers out are often meant (`scale 0 500 0 127`), so only a narrow output range
        if args and 0 < abs(args[3] - args[2]) <= _NARROW < abs(args[1] - args[0]):
            text = (box.get("text") or "").split(" @")[0].strip()
            fixed = " ".join(text.split()[:3] + [f"{args[2]}.", f"{args[3]}."])
            problems.append(Problem(
                "whole numbers",
                f"{_label(box)}: `{text}` has four whole-number arguments, so all it sends is "
                f"{_whole_numbers(min(args[2:]), max(args[2:]))}. Write `{fixed}` to get the values between.",
                [box_id]))
    for source, outlet, dest, inlet in cords:
        target = boxes[dest]
        if inlet > 1 or target.get("maxclass") != "newobj" or _works_in(target) != "int":
            continue
        if number_kind(boxes, into, source, outlet) != "float":
            continue
        # dropping the fraction is often meant (a pixel, a MIDI note). It is only a sure
        # mistake when the values are known to lie so close together that little is left
        span = _span(boxes, into, graph, source, outlet)
        if span is None or span[1] - span[0] > _NARROW:
            continue
        lo, hi = span
        if lo == hi and lo == int(lo):   # 440. has no fraction to lose
            continue
        words = (target.get("text") or "").split()
        argument = f"`{words[0]} {words[1]}.`" if len(words) > 1 else f"a float argument, `{words[0]} 0.`,"
        values = f"{lo:g}" if lo == hi else f"{lo:g} to {hi:g}"
        problems.append(Problem(
            "whole numbers",
            f"{_label(boxes[source])} sends {values} into {_label(target)} inlet {inlet}, and "
            f"`{' '.join(words[:2])}` works in whole numbers: it drops the fraction, so all it sees is "
            f"{_whole_numbers(int(lo), int(hi))}. Write {argument} to keep the fraction.",
            [source, dest]))
    return problems


def _whole_numbers(lo, hi):
    """ "0 or 1", "-1, 0 or 1": every whole number from lo to hi."""
    numbers = [str(n) for n in range(lo, hi + 1)]
    return numbers[0] if len(numbers) == 1 else ", ".join(numbers[:-1]) + " or " + numbers[-1]


def _span(boxes, into, graph, source, outlet):
    """(lowest, highest) value an outlet sends, if known: a number in a message box, or a
    Live parameter's range followed through arithmetic (devicecheck)."""
    box = boxes[source]
    if box.get("maxclass") == "message":
        try:
            value = float((box.get("text") or "").strip())
        except ValueError:
            return None
        if not math.isfinite(value):
            return None
        return (value, value) if _sent(boxes, into, source, outlet) else None
    try:
        values = graph.values_out(source, outlet)
    except (RecursionError, OverflowError):
        return None
    return None if values is None else (values.lo, values.hi)


def message_problems(patcher):
    """Messages sent to an object that has no method for them, in a whole patcher (the
    "patcher" dict of a .maxpat or .amxd), nested patchers included."""
    problems = []
    for current in _patchers(patcher):
        boxes = {entry["box"]["id"]: entry["box"] for entry in current.get("boxes", []) if "box" in entry}
        into, cords = {}, []
        for line in current.get("lines", []):
            cord = line.get("patchline", {})
            (source, outlet), (dest, inlet) = cord.get("source", [None, 0]), cord.get("destination", [None, 0])
            if source in boxes and dest in boxes:
                into.setdefault((dest, inlet), []).append((source, outlet))
                cords.append((source, outlet, dest, inlet))
        problems += _order_problems(boxes, cords)
        problems += _number_problems(current, boxes, into, cords)
        for source, outlet, dest, inlet in cords:
            target = boxes[dest]
            if inlet != 0 or "patcher" in target or target.get("maxclass") == "message":
                continue
            name = _name(target)
            for selector, reads in _sent(boxes, into, source, outlet):
                if understands(name, selector) is not False:
                    continue
                problems.append(Problem(
                    "message",
                    f"{_label(boxes[source])} sends {reads} to {_label(target)}, which has no use for "
                    f"{'it' if selector in _TYPED_OUTLETS + ('list',) else repr(selector)}: Max prints "
                    f"\"{_typed(target)}: doesn't understand '{selector}'\" and nothing happens.",
                    [source, dest]))
    return problems
