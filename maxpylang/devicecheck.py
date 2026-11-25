"""
devicecheck

Checks on a Max for Live device and on Live parameters, run when the patch is saved. The
cord check types a cord by what it carries (audio or not). These look at two things it
cannot see: what a whole device must contain, and the values on a control cord.

    device contract   the device type says what the device is for, which fixes what it
                      must hold: an audio effect reads plugin~ and writes plugout~, an
                      instrument takes MIDI in and writes plugout~, a MIDI effect takes
                      MIDI in and sends MIDI out
    output level      the level reaching plugout~ can pass full scale and nothing limits it
    parameter name    two Live parameters with one long name. Live finds a parameter by
                      that name, so automation and mappings land on the wrong one
    idle parameter    a Live parameter with no cords: it shows up in Live and does nothing
    value range       a parameter's range does not fit the inlet it reaches: a dial that
                      runs 40 to 18000 wired to a resonance inlet that takes 0 to 1

The first, second and fourth are only judged for a device (save(device_type=...)). The
other two hold for any patch that uses live.* objects.

A parameter's range is read from its parameter block, which obj.parameter() writes. A
range is followed from the parameter through the objects that have a plain rule for it
(* / + - !- !/ scale zmap clip abs mtof dbtoa, number boxes, trigger) and compared with the
inlet's documented range in data/value_ranges.json. Anything else on the way, or a cord
into an operator's right inlet, and the range is not known: no report.

The level reaching plugout~ is followed the same way, as a multiple of full scale: an
oscillator or plugin~ is 1, `*~ 0.5` halves it, two cords into one inlet add, clip~ and
tanh~ bring it back to 1. A filter, a feedback loop or any object with no rule here may
raise the level, so it counts as unlimited. A subpatcher or an abstraction may hold a
limiter, so a path through one is not judged.

As everywhere in these checks, what cannot be seen causes no report. The device contract
is only judged when the file can be seen whole, as for missing names in graphcheck.

Against the 83 devices that ship with Max: see tests/test_max_corpus.py.

    device_problems() --> these problems for a whole .maxpat or .amxd patcher
    parameter_of()    --> a box's Live parameter: its name and range
"""

import collections
import functools
import json
import math
from pathlib import Path

from .graphcheck import SIGNAL_TYPES, Problem, _boxes, _is, _known, _words, roles

_DATA = Path(__file__).resolve().parent / "data"
SAMPLE_RATE = 44100

# controls whose first outlet sends the parameter's value and whose second sends it as 0 to 1
_RANGED = ("live.dial", "live.slider", "live.numbox")

Parameter = collections.namedtuple("Parameter", "name lo hi")
Values = collections.namedtuple("Values", "lo hi origin")


@functools.lru_cache(maxsize=None)
def value_ranges():
    with open(_DATA / "value_ranges.json", encoding="utf-8") as f:
        table = json.load(f)
    return {name: {int(inlet): spec for inlet, spec in inlets.items()}
            for name, inlets in table.items() if not name.startswith("_")}


def parameter_of(box):
    """
    The Live parameter a saved box is, or None. `name` is its long name if it was given
    one. `lo` and `hi` are its range, for a live.dial, live.slider or live.numbox that
    holds a number; None for the rest (a toggle, a tab, a menu).
    """
    if box.get("parameter_enable") != 1:
        return None
    block = (box.get("saved_attribute_attributes") or {}).get("valueof") or {}
    lo = hi = None
    if box.get("maxclass") in _RANGED and block.get("parameter_type", 0) in (0, 1):
        lo, hi = block.get("parameter_mmin", 0.0), block.get("parameter_mmax", 127.0)
    return Parameter(block.get("parameter_longname"), lo, hi)


def _name(box):
    """The Max name of any box: the object in an object box, the class of a UI box."""
    return _words(box)[0] or box.get("maxclass", "")


def _names(box):
    name = _name(box)
    return {name, name[3:] if name.startswith("mc.") else name}


def _typed(box):
    """The name as it is typed in the box: `*~`, where _name() gives `times~`."""
    words = (box.get("text") or "").split()
    return words[0] if box.get("maxclass") == "newobj" and words else box.get("maxclass", "")


def _label(box):
    parameter = parameter_of(box)
    if parameter and parameter.name:
        return f"{_typed(box)} '{parameter.name}' ({box.get('id')})"
    return f"{_typed(box)} ({box.get('id')})"


def _number(args, index):
    try:
        return float(args[index])
    except (IndexError, ValueError):
        return None


class _Patcher:
    """One patcher's boxes and cords, with the value and level that reach each inlet."""

    def __init__(self, patcher):
        self.boxes = {entry["box"]["id"]: entry["box"] for entry in patcher.get("boxes", []) if "box" in entry}
        self.into = collections.defaultdict(list)   # (box, inlet) -> [(source box, outlet)]
        self.cords = collections.Counter()          # box -> cords touching it
        for line in patcher.get("lines", []):
            cord = line.get("patchline", {})
            (source, outlet), (dest, inlet) = cord.get("source", [None, 0]), cord.get("destination", [None, 0])
            if source in self.boxes and dest in self.boxes:
                self.into[(dest, inlet)].append((source, outlet))
                self.cords[source] += 1
                self.cords[dest] += 1
        self._levels = {}
        self._values = {}

    def _is_signal(self, source, outlet):
        types = self.boxes[source].get("outlettype") or []
        return outlet < len(types) and types[outlet] in SIGNAL_TYPES

    # ── values on control cords ────────────────────────────────────────────────

    def values_into(self, box_id, inlet, seen=frozenset()):
        """The values arriving at an inlet, over every cord into it. None if not known."""
        sources = self.into.get((box_id, inlet))
        if not sources:
            return None
        found = [self.values_out(source, outlet, seen) for source, outlet in sources]
        if any(values is None for values in found):
            return None
        origins = sorted({values.origin for values in found})
        return Values(min(v.lo for v in found), max(v.hi for v in found), " and ".join(origins))

    def values_out(self, box_id, outlet, seen=frozenset()):
        """The values an outlet sends. None if not known."""
        if box_id in seen:
            return None
        if (box_id, outlet) not in self._values:
            self._values[(box_id, outlet)] = self._values_out(box_id, outlet, seen | {box_id})
        return self._values[(box_id, outlet)]

    def _values_out(self, box_id, outlet, seen):
        box = self.boxes[box_id]
        parameter = parameter_of(box)
        if parameter is not None and parameter.lo is not None:
            if outlet == 0:
                return Values(parameter.lo, parameter.hi, _label(box))
            return Values(0.0, 1.0, _label(box)) if outlet == 1 else None
        name, args = _words(box)
        if name is None:
            name = box.get("maxclass", "")

        def left():
            return self.values_into(box_id, 0, seen)

        # a cord into any other inlet changes what the object does with its left one
        if any(self.into.get((box_id, inlet)) for inlet in range(1, box.get("numinlets", 1))):
            return None
        if name in ("flonum", "number", "float", "int", "sig~"):
            return left()
        if name == "trigger":
            return left() if _word(args, outlet) in ("f", "i", "l") else None
        values = left()
        if values is None:
            return None
        lo, hi, origin = values

        def spread(*points):
            return Values(min(points), max(points), origin)

        k = _number(args, 0)
        if name == "abs":
            return spread(abs(lo), abs(hi)) if lo * hi >= 0 else Values(0.0, max(-lo, hi), origin)
        if name == "mtof":
            return spread(*(440.0 * 2 ** ((x - 69) / 12) for x in (lo, hi)))
        if name == "dbtoa":
            return spread(*(10 ** (x / 20) for x in (lo, hi)))
        if name in ("scale", "zmap"):
            a, b, c, d = (_number(args, i) for i in range(4))
            if None in (a, b, c, d) or a == b:
                return None
            inside = min(a, b) <= lo and hi <= max(a, b)
            if name == "zmap" or (len(args) > 4 and inside):   # clipped, or curved but inside
                return spread(c, d)
            if len(args) > 4:
                return None
            return spread(*(c + (x - a) * (d - c) / (b - a) for x in (lo, hi)))
        if name == "clip":
            a, b = _number(args, 0), _number(args, 1)
            if a is None or b is None:
                return None
            return spread(min(max(lo, a), b), min(max(hi, a), b))
        if k is None:
            return None
        if name == "times":
            return spread(lo * k, hi * k)
        if name == "plus":
            return spread(lo + k, hi + k)
        if name == "minus":
            return spread(lo - k, hi - k)
        if name == "rminus":
            return spread(k - lo, k - hi)
        if name == "div" and k != 0:
            return spread(lo / k, hi / k)
        if name == "rdiv" and lo * hi > 0:
            return spread(k / lo, k / hi)
        return None

    # ── level on signal cords, as a multiple of full scale ──────────────────────

    def level_into(self, box_id, inlet, seen=frozenset()):
        """
        (level, object that left it unlimited) for the audio arriving at an inlet: cords
        into one inlet add. Level 0 if no audio arrives, None if it cannot be judged.
        """
        total, cause = 0.0, None
        for source, outlet in self.into.get((box_id, inlet), ()):
            if not self._is_signal(source, outlet):
                continue
            level, why = self.level_out(source, seen)
            if level is None:
                return None, None
            total, cause = total + level, cause or why
        return total, cause

    def level_out(self, box_id, seen=frozenset()):
        if box_id in seen:   # a feedback loop: each pass may add
            return math.inf, _label(self.boxes[box_id]) + ", in a feedback loop"
        if box_id not in self._levels:
            self._levels[box_id] = self._level_out(box_id, seen | {box_id})
        return self._levels[box_id]

    def _level_out(self, box_id, seen):
        box = self.boxes[box_id]
        name, args = _words(box)
        names = _names(box)
        if ("patcher" in box or names.isdisjoint(_known()) or _is(names, "opaque")
                or _is(names, "part_of_a_bigger_patch") or _is(names, "level_set_by_messages")
                or "receive~" in names):
            return None, None
        if _is(names, "level_limiters"):
            if "clip~" in names:
                if self.into.get((box_id, 1)) or self.into.get((box_id, 2)):   # limits set by cords
                    return None, None
                a, b = _number(args, 0), _number(args, 1)
                return (None, None) if a is None or b is None else (max(abs(a), abs(b)), None)
            return 1.0, None
        if _is(names, "level_one_sources"):
            return 1.0, None
        if _is(names, "level_passes"):
            levels = [self.level_into(box_id, inlet, seen) for inlet in range(box.get("numinlets", 1))]
            if any(level is None for level, _ in levels):
                return None, None
            return max(levels, key=lambda pair: pair[0])
        if _is(names, "tap_readers"):
            # the delay line is the tapin~'s, which holds what arrived at the tapin~
            for source, outlet in self.into.get((box_id, 0), ()):
                types = self.boxes[source].get("outlettype") or []
                if outlet < len(types) and types[outlet] == "tapconnect":
                    return self.level_into(source, 0, seen)
            return 0.0, None
        if names & {"times~", "plus~", "minus~"}:
            left, cause = self.level_into(box_id, 0, seen)
            right, right_cause = self._right_operand(box_id, args, seen)
            if left is None or right is None:
                return None, None
            if "times~" in names:
                level = 0.0 if 0 in (left, right) else left * right
            else:
                level = left + right
            return level, (cause or right_cause) if level == math.inf else None
        if name == "sig~":
            values = self.values_out(box_id, 0)
            return (None, None) if values is None else (max(abs(values.lo), abs(values.hi)), None)
        return math.inf, _label(box)

    def _right_operand(self, box_id, args, seen):
        """The size of what an arithmetic object's right inlet holds: audio, a control
        value whose range is known, or the argument."""
        sources = self.into.get((box_id, 1), ())
        if not sources:
            return abs(_number(args, 0) or 0.0), None
        if all(self._is_signal(source, outlet) for source, outlet in sources):
            return self.level_into(box_id, 1, seen)
        values = self.values_into(box_id, 1)
        return (None, None) if values is None else (max(abs(values.lo), abs(values.hi)), None)


def _judged(walk, *args):
    """The result of a walk, or None for a chain too long to follow: not judged."""
    try:
        return walk(*args)
    except RecursionError:
        return None


def _word(args, index):
    return args[index] if index < len(args) else None


def _patchers(patcher):
    """A patcher and the patchers nested in it. gen~ and RNBO patchers are left out."""
    todo = [patcher]
    while todo:
        current = todo.pop()
        yield current
        for entry in current.get("boxes", []):
            inner = entry.get("box", {}).get("patcher")
            if isinstance(inner, dict) and inner.get("classnamespace", "box") == "box":
                todo.append(inner)


def _seen_whole(patcher):
    """False if part of the device may be somewhere that cannot be looked into."""
    for box, _ in _boxes(patcher):
        if box.get("maxclass") == "bpatcher" and "patcher" not in box:
            return False
        name = _words(box)[0]
        if name is None:
            continue
        if name in ("patcher", "p"):
            if "patcher" not in box:
                return False
        elif _is({name}, "may_hold_the_other_end") or name not in _known():
            return False
    return True


def _g(x):
    return f"{x:g}"


def _contract(patcher, device_type):
    if not _seen_whole(patcher):
        return []
    present = set()
    for box, _ in _boxes(patcher):
        present |= _names(box)
    has = lambda role: _is(present, role)   # noqa: E731
    kind = "MIDI effect" if device_type == "midi_effect" else device_type.replace("_", " ")
    found = []
    if device_type == "audio_effect" and not has("audio_in_max_for_live"):
        found.append("this audio effect never reads plugin~, so it ignores the audio on its track. "
                     "Add a `plugin~` and process what comes out of it.")
    if device_type in ("instrument", "midi_effect") and not has("midi_in"):
        found.append(f"this {kind} has no MIDI input, so nothing on its track can play it. "
                     "Add a `notein` or a `midiin`.")
    if device_type in ("audio_effect", "instrument") and not has("audio_out"):
        dac = " Inside Live, dac~ and ezdac~ are silent." if has("audio_out_outside_max_for_live") else ""
        found.append(f"this {kind} never writes to plugout~, so no sound leaves it.{dac} "
                     "Send the output to a `plugout~`.")
    if device_type == "midi_effect" and not has("midi_out"):
        found.append("this MIDI effect has no MIDI output, so nothing reaches the instrument after it. "
                     "Add a `midiout` or a `noteout`.")
    return [Problem("device contract", message[0].upper() + message[1:], []) for message in found]


def device_problems(patcher, device_type=None):
    """
    Problems with a device and its Live parameters, in a whole patcher (the "patcher" dict
    of a .maxpat or .amxd), nested patchers included. device_type is what it is saved as:
    None for a plain patch, which skips the checks that only hold inside Live.
    """
    problems = []

    # two parameters with one long name, anywhere in the file
    named = collections.defaultdict(list)
    reads_by_name = False
    for box, _ in _boxes(patcher):
        parameter = parameter_of(box)
        if parameter and parameter.name:
            named[parameter.name].append(box)
        reads_by_name = reads_by_name or _is(_names(box), "reads_parameters_by_name")
    for name, boxes in named.items():
        if len(boxes) > 1:
            labels = ", ".join(f"{_typed(box)} ({box.get('id')})" for box in boxes)
            problems.append(Problem("parameter name", f"{len(boxes)} parameters are named '{name}': {labels}. "
                                    "Live finds a parameter by its name, so automation and mappings would "
                                    "land on the wrong one. Give each its own name.",
                                    [box.get("id") for box in boxes]))

    if device_type is not None:
        problems += _contract(patcher, device_type)

    ranges = value_ranges()
    for current in _patchers(patcher):
        graph = _Patcher(current)
        for box_id, box in graph.boxes.items():
            names = _names(box)

            # a parameter's range against the inlet it reaches
            for inlet, spec in ranges.get(_name(box), {}).items():
                for source, outlet in graph.into.get((box_id, inlet), ()):
                    values = _judged(graph.values_out, source, outlet)
                    if values is None:
                        continue
                    quarter = spec["hi"] == "sr/4"
                    lo, hi = spec["lo"], SAMPLE_RATE / 4 if quarter else spec["hi"]
                    slack = 1e-6 * max(1.0, abs(hi - lo))
                    if values.lo >= lo - slack and values.hi <= hi + slack:
                        continue
                    note = f" (a quarter of the sample rate, at {SAMPLE_RATE / 1000:g} kHz)" if quarter else ""
                    problems.append(Problem(
                        "value range",
                        f"{values.origin} sends {_g(values.lo)} to {_g(values.hi)} into {_label(box)} inlet {inlet}, "
                        f"its {spec['what']}, which takes {_g(lo)} to {_g(hi)}{note}. Past that the control "
                        "does nothing, or the object misbehaves. Change the parameter's range, or put a "
                        "`scale` between them.", [source, box_id]))

            if device_type is None:
                continue

            # a parameter with no cords at all
            if (parameter_of(box) and box.get("numoutlets", 0) and not graph.cords[box_id]
                    and not reads_by_name and "param_connect" not in box):
                problems.append(Problem("idle parameter", f"{_label(box)} is a parameter with no cords, so it "
                                        "shows up in Live and controls nothing. Connect it, or delete it.",
                                        [box_id]))

            # the level reaching plugout~
            if _is(names, "audio_out"):
                worst, cause = 0.0, None
                for inlet in range(box.get("numinlets", 2)):
                    level, why = _judged(graph.level_into, box_id, inlet) or (None, None)
                    if level is not None and level > worst:
                        worst, cause = level, why
                if worst > 1.0 + 1e-6:
                    if worst == math.inf:
                        reason = f"{cause} can raise the level and nothing after it limits it"
                    else:
                        reason = f"the audio reaching it can add up to {_g(round(worst, 2))} times full scale"
                    problems.append(Problem("output level", f"{_label(box)}: {reason}. Put a `clip~ -1. 1.` "
                                            "on each cord into plugout~.", [box_id]))
    return problems
