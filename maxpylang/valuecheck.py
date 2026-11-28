"""
valuecheck

Checks on the numbers a control cord carries, run when the patch is saved. devicecheck
follows a range of values along the cords (a Live parameter's range, a MIDI input's 0 to
127, a comparison's 0 or 1) and compares it with the inlets whose reference page states a
range. These use the same ranges for mistakes that are about what a number means, which no
single inlet's range shows:

    envelope level    a MIDI velocity, 0 to 127, triggers an adsr~, which takes the number
                      as the envelope's amplitude: 127 times full scale. Nothing after the
                      adsr~ scales it back.
    always zero       a whole-number divide whose input never reaches its divisor: a
                      controller's 0 to 127 into `/ 1000` gives 0 every time.
    scale input       a `scale` is told to expect far more than can arrive: a bendin,
                      0 to 127, into `scale 0 16383 -2. 2.`.
    swapped inlets    a gate whose control inlet gets a wide range of numbers and whose
                      data inlet gets only the numbers that pick an outlet: the two cords
                      are the wrong way round.
    off by one        a live.tab or live.menu, which counts its items from 0, straight into
                      a selector~, gate or switch, which count from 1 and take 0 as "off".

Every rule needs the range to be known on every cord into the inlet. A subpatcher, an
abstraction, a message box, a receive, or any object with no rule in devicecheck on the
way, and nothing is reported.

Against Max's 3,203 shipped patches and devices these report nothing: see
tests/test_max_corpus.py. The divide rule first read "never passes its divisor", which
reported a velocity into `/ 127` in one of them, where the 0 or 1 it gives is the point.

    value_problems() --> these problems for a whole .maxpat or .amxd patcher
"""

import collections

from .devicecheck import _g, _judged, _label, _name, _number, _Patcher, _patchers, _word, choices_of
from .graphcheck import Problem, _known, _words

VALUE_KINDS = ("envelope level", "always zero", "scale input", "swapped inlets", "off by one")

_LOUD = 2          # an envelope this many times full scale is not a level anyone means
_FAR_WIDER = 8     # a scale input range this many times what arrives is for something else
_CHOOSERS = ("selector~", "gate", "switch", "gate~")


def _whole(word):
    return word is not None and word.lstrip("-").isdigit()


# after these the level is mapped onto another range or leaves what can be followed
_REMAPS = {"scale~", "expr~", "gen~", "poly~", "pfft~", "send~", "out~", "outlet", "snapshot~", "atodb~",
           "normalize~", "omx.peaklim~", "limi~", "mc.pack~", "gain~", "live.gain~"}


def _scaled_down_after(graph, out, box_id, most):
    """True if something the adsr~'s audio reaches may bring `most` back to about full
    scale, or cannot be seen into: then the level is not judged. A clip~ does not count:
    an envelope 127 times too big and then clipped is a square wave."""
    seen, todo = set(), [box_id]
    while todo:
        current = todo.pop()
        for dest, inlet in out.get(current, ()):
            if dest in seen:
                continue
            seen.add(dest)
            box = graph.boxes[dest]
            args = _words(box)[1]
            name = _name(box)
            if "patcher" in box or name not in _known() or name in _REMAPS:
                return True
            if name in ("times~", "div~"):
                other = 1 - inlet if inlet in (0, 1) else None
                if other is None:
                    return True
                sources = graph.into.get((dest, other))
                if not sources:
                    k = _number(args, 0)
                    if k is None:
                        k = 0.0
                    if name == "times~" and abs(k) * most <= _LOUD:
                        return True
                    if name == "div~" and (inlet == 1 or k == 0 or most / abs(k) <= _LOUD):
                        return True
                elif not all(graph._is_signal(source, outlet) for source, outlet in sources):
                    values = _judged(graph.values_into, dest, other)
                    if values is None or name == "div~" or max(abs(values.lo), abs(values.hi)) * most <= _LOUD * 64:
                        return True   # a control sets the gain: it may be turned down
                elif name == "div~":
                    return True
            todo.append(dest)
    return False


def value_problems(patcher):
    """Problems with what the numbers on control cords mean, in a whole patcher (the
    "patcher" dict of a .maxpat or .amxd), nested patchers included."""
    problems = []
    for current in _patchers(patcher):
        graph = _Patcher(current)
        out = collections.defaultdict(list)
        for (dest, inlet), sources in graph.into.items():
            for source, _ in sources:
                out[source].append((dest, inlet))

        def into(box_id, inlet):
            return _judged(graph.values_into, box_id, inlet)

        for box_id, box in graph.boxes.items():
            name, args = _words(box)
            if name is None:
                continue
            label = _label(box)

            if name == "adsr~":
                values = into(box_id, 0)
                if values is not None and values.hi > _LOUD and not _scaled_down_after(graph, out, box_id, values.hi):
                    problems.append(Problem(
                        "envelope level",
                        f"{values.origin} sends {_g(values.lo)} to {_g(values.hi)} into {label}, which takes the "
                        f"number as the envelope's amplitude: up to {_g(values.hi)} times full scale, far past "
                        f"what a speaker takes. Put a `/ {_g(values.hi)}.` before the adsr~ so it gets 0 to 1.",
                        [box_id]))

            if name == "div" and _whole(_word(args, 0)) and not graph.into.get((box_id, 1)):
                k = abs(int(args[0]))
                values = into(box_id, 0)
                # a range that reaches the divisor gives 0 or 1, which is a way to make a switch
                # of a velocity (one of Max's own patches does), so only "never reaches" counts
                if values is not None and k >= 2 and -k < values.lo and values.hi < k and values.hi > values.lo:
                    problems.append(Problem(
                        "always zero",
                        f"{values.origin} sends {_g(values.lo)} to {_g(values.hi)} into {label}, which divides in "
                        f"whole numbers and drops the fraction, so it always sends 0. Write `/ {k}.` with the "
                        "point to divide in floats.", [box_id]))

            if name == "scale" and not any(graph.into.get((box_id, i)) for i in (1, 2)):
                a, b = _number(args, 0), _number(args, 1)
                values = into(box_id, 0)
                if (values is not None and a is not None and b is not None and values.hi > values.lo
                        and min(a, b) <= values.lo and values.hi <= max(a, b)
                        and abs(b - a) >= _FAR_WIDER * (values.hi - values.lo)):
                    problems.append(Problem(
                        "scale input",
                        f"{values.origin} sends {_g(values.lo)} to {_g(values.hi)} into {label}, which is told "
                        f"to expect {_g(a)} to {_g(b)}, so its output barely moves. Write the range that "
                        f"arrives: `scale {_g(values.lo)} {_g(values.hi)} ...`.", [box_id]))

            if name == "gate":
                control, data = into(box_id, 0), into(box_id, 1)
                count = int(args[0]) if _whole(_word(args, 0)) and int(args[0]) >= 1 else 1
                # the right inlet gets only numbers that pick an outlet, the left gets numbers that do not
                if (control is not None and data is not None and control.hi > count
                        and 0 <= data.lo and data.hi <= count):
                    problems.append(Problem(
                        "swapped inlets",
                        f"{label} gets {_g(control.lo)} to {_g(control.hi)} from {control.origin} in its left "
                        f"inlet and only {_g(data.lo)} to {_g(data.hi)} from {data.origin} in its right. The left inlet opens and closes "
                        "it and the right one takes what passes through, so the two cords are the wrong way "
                        "round. Swap them.", [box_id]))

            if name in _CHOOSERS:
                for source, outlet in graph.into.get((box_id, 0), ()):
                    count = choices_of(graph.boxes[source])
                    if count is None or outlet != 0 or len(graph.into[(box_id, 0)]) != 1:
                        continue
                    ways = int(args[0]) if _whole(_word(args, 0)) else 1
                    if count < 2 or ways != count:
                        continue
                    source_label = _label(graph.boxes[source])
                    problems.append(Problem(
                        "off by one",
                        f"{source_label} counts its {count} items from 0 and {label} counts from 1, where 0 "
                        f"shuts it off: the first item gives silence or nothing and number {count} is never "
                        "chosen. Put a `+ 1` between them.", [source, box_id]))
    return problems
