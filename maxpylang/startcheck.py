"""
startcheck

Checks for a patch that is wired correctly and still does nothing, run when the patch is
saved. Every cord is legal, so the cord check and the message check pass it. What is
missing is the thing that sets it going.

    never starts     an object that only works once something reaches its left inlet, with
                     nothing connected there:
                       - jit.grab, jit.movie, jit.catch~, jit.noise and transport send only
                         when they get a bang, so with no cord in they never send. The
                         same for a jit.catch~ whose left inlet gets only audio, and a
                         transport that is only switched on and off. A
                         jit.grab or jit.movie in a patch with a jit.world is left alone:
                         there it sends on its own.
                       - metro, qmetro, tempo and clocker tick only once they are switched
                         on. `@active 1` or `@autostart 1` in the box counts as on.
                       - jit.world draws nothing until it is enabled: `@enable 1`, or a
                         toggle into its left inlet.
                       - groove~ plays at the speed of the audio signal in its left inlet.
                         With no signal there the speed is 0. A number there sets where
                         it plays from, not how fast.
                       - waveform~ shows nothing until a `set` message names its buffer.

    message          `set 0` sent to a groove~, play~ or another object that reads a
                     buffer~. There `set` takes the name of a buffer, so this asks for a
                     buffer called 0. To jump to the start of the sound, send a number.

    voice patch      a problem between a poly~ or pfft~ and the patch file it loads, when
                     that file is in the folder the patch is saved to:
                       - the file uses inlet or outlet objects. Inside a poly~ or a pfft~
                         only `in`, `in~`, `out` and `out~` (and fftin~, fftout~) make
                         inlets and outlets.
                       - a poly~ with several voices gets a list and never `note`,
                         `midinote` or `target`, so every voice gets every list and they
                         all play the same thing.
                       - the file reads its `in 2`, nothing is connected to the second
                         inlet of the poly~, and `in 1` goes straight into an object that
                         takes one number (mtof, sig~). A list sent to the first inlet is
                         not split across the inlets: it arrives whole at `in 1`.

These come from a benchmark of agents writing patches with maxpylang: in 68 patches a
judge scored 6 of 10 or lower, "nothing starts it" was the most common cause, and groove~
and poly~ had the lowest scores of any group.

As everywhere in these checks, what cannot be seen causes no report. An object with any
cord into its left inlet is taken to be started, except groove~, where every cord must be
known to carry a message and not audio. An object nothing reads from is not reported: the
dead output check has it.

    start_problems() --> these problems for a whole .maxpat or .amxd patcher
"""

import json
import re
from pathlib import Path

from .graphcheck import Problem, _is, _known, _words
from .messagecheck import _TYPED_OUTLETS, _UI_SENDS, _label, _name, _patchers, _sent

START_KINDS = ("never starts", "voice patch")

_NUMBER = re.compile(r"-?(\d+\.?\d*|\.\d+)$")
_ON = re.compile(r"@(active|autostart|enable)\s+(?!0\b)\S")
_OWN_OUTPUT = re.compile(r"@(output_texture|automatic)\s+(?!0\b)\S")

# sends only when it gets a bang: what to say is missing
_ON_A_BANG = {
    "jit.grab": "a frame from the camera",
    "jit.movie": "a frame of the movie",
    "jit.catch~": "the audio it has caught",
    "jit.noise": "a matrix",
    "transport": "the tempo and the position",
}
_CLOCKS = ("metro", "qmetro", "tempo", "clocker")
_SPEED_BY_SIGNAL = ("groove~", "mc.groove~")
_VOICE_HOSTS = ("poly~", "mc.poly~", "pfft~")
_VOICE_INS = ("in", "in~", "mc.in~")
_PLAIN_IO = ("inlet", "outlet", "inlet~", "outlet~")
_TO_ONE_VOICE = {"note", "midinote", "target", "notemessage", "midievent", "mpeevent"}
_ONE_NUMBER = ("mtof", "ftom", "sig~", "number", "flonum", "abs", "dbtoa", "atodb")
_DRAWN_BY_A_WORLD = ("jit.grab", "jit.movie")


def _text(box):
    return box.get("text") or ""


def _is_audio(box, outlet):
    """True, False, or None when the outlet's rate is not known (a subpatcher, an inlet)."""
    if box.get("maxclass") in _UI_SENDS or box.get("maxclass") == "message":
        return False
    name = _name(box)
    if "patcher" in box or name not in _known() or _is({name}, "opaque") or _is({name}, "part_of_a_bigger_patch"):
        return None
    types = box.get("outlettype") or []
    if outlet >= len(types):
        return None
    return types[outlet] in ("signal", "multichannelsignal")


def _set_numbers(boxes, into, source, outlet):
    """The `set 0` messages an outlet is known to send: [how the message reads]."""
    box = boxes[source]
    feeders = into.get((source, 0), ())

    def numbers_arrive():
        arriving = [_sent(boxes, into, feeder, feeder_outlet) for feeder, feeder_outlet in feeders]
        return bool(arriving) and all(sent and all(selector in ("int", "float") for selector, _ in sent)
                                      for sent in arriving)

    if box.get("maxclass") == "message" and outlet == 0 and not into.get((source, 1)):
        found = []
        for part in _text(box).replace(";", ",").split(","):
            words = part.split()
            if len(words) == 2 and words[0] == "set":
                if _NUMBER.match(words[1]) or (words[1] == "$1" and numbers_arrive()):
                    found.append(f"`{' '.join(words)}`")
        return found
    name, args = _words(box)
    if name == "prepend" and args == ["set"] and outlet == 0 and numbers_arrive():
        return ["`set` and a number"]
    return []


def _takes_one_number(name):
    return name in _ONE_NUMBER or (_is({name}, "right_inlets_cold") and name not in ("pack", "expr"))


def _voice_file(box, folders):
    """The patcher a poly~ or pfft~ box loads, if its file is in one of the folders."""
    words = _text(box).split()
    if len(words) < 2 or "$" in words[1] or "#" in words[1]:
        return None, None
    file_name = words[1] if words[1].endswith(".maxpat") else words[1] + ".maxpat"
    for folder in folders:
        path = Path(folder) / file_name
        if path.is_file():
            try:
                with open(path, encoding="utf-8") as f:
                    return file_name, json.load(f)["patcher"]
            except (OSError, ValueError, KeyError, TypeError):
                return None, None
    return None, None


def _voice_problems(box, fed, folders):
    """Problems between one poly~ or pfft~ box and its file. fed: the box's inlets with a cord."""
    file_name, voice = _voice_file(box, folders)
    if voice is None:
        return []
    host = _text(box).split()[0]
    problems = []
    inner = {entry["box"].get("id"): entry["box"] for entry in voice.get("boxes", []) if "box" in entry}
    plain = sorted({_name(b) for b in inner.values() if _name(b) in _PLAIN_IO})
    if plain:
        made = "in, in~, out and out~" + (", fftin~ and fftout~" if host == "pfft~" else "")
        problems.append(Problem(
            "voice patch",
            f"{file_name} has {' and '.join(plain)} objects, and {_label(box)} loads it. Inside a {host} only "
            f"{made} make inlets and outlets, so the {host} gets none from these. Use `in 1` for the first "
            f"message inlet and `in~ 1` for the first audio inlet.",
            [box.get("id")]))
    # which of its inlets the file reads, and what `in 1` feeds
    read, first_feeds = set(), set()
    for line in voice.get("lines", []):
        cord = line.get("patchline", {})
        source = inner.get(cord.get("source", [None])[0])
        if source is not None and _name(source) in _VOICE_INS:
            words = _text(source).split()
            number = int(words[1]) if len(words) > 1 and words[1].isdigit() else 1
            read.add(number)
            if number == 1 and _name(source) == "in":
                first_feeds.add(_name(inner.get(cord.get("destination", [None])[0], {})))
    unfed = sorted(number for number in read if number - 1 not in fed)
    # Max's own help patches leave inlets of a voice unconnected: a control nobody has to
    # use. So this is only reported for the mistake itself: `in 1` goes straight into
    # objects that take one number, which shows the voice expects one value per inlet.
    if 0 in fed and unfed and first_feeds and all(_takes_one_number(name) for name in first_feeds):
        which = ", ".join(f"`in {number}`" for number in unfed)
        problems.append(Problem(
            "voice patch",
            f"{file_name} reads {which}, but nothing is connected to inlet "
            f"{' or '.join(str(number - 1) for number in unfed)} of {_label(box)}, so that part of each "
            f"voice never gets a message. A list sent to the left inlet is not split across the inlets: "
            f"it arrives whole at `in 1`. Connect a cord to each inlet, or unpack the list inside the voice.",
            [box.get("id")]))
    return problems


def start_problems(patcher, folders=()):
    """Objects that never start, in a whole patcher (the "patcher" dict of a .maxpat or
    .amxd), nested patchers included. folders: where to look for the file a poly~ or pfft~
    loads, the folder the patch is saved to first."""
    problems = []
    # a jit.grab or jit.movie sends on its own once a jit.world in the patch is drawing
    has_world = any(_name(entry.get("box", {})) in ("jit.world", "jit.pworld")
                    for current in _patchers(patcher) for entry in current.get("boxes", []))
    for current in _patchers(patcher):
        boxes = {entry["box"]["id"]: entry["box"] for entry in current.get("boxes", []) if "box" in entry}
        into, out_of = {}, set()
        for line in current.get("lines", []):
            cord = line.get("patchline", {})
            (source, outlet), (dest, inlet) = cord.get("source", [None, 0]), cord.get("destination", [None, 0])
            if source in boxes and dest in boxes:
                into.setdefault((dest, inlet), []).append((source, outlet))
                out_of.add(source)

        for box_id, box in boxes.items():
            name, text, label = _name(box), _text(box), _label(box)
            left = into.get((box_id, 0), [])
            fed = {inlet for (dest, inlet) in into if dest == box_id}

            if name in _VOICE_HOSTS:
                problems += _voice_problems(box, fed, folders)

            if name in ("poly~", "mc.poly~") and left and "@target" not in text:
                words = text.split()
                voices = int(words[2]) if len(words) > 2 and words[2].isdigit() else 1
                arriving = [_sent(boxes, into, source, outlet) for source, outlet in left]
                selectors = {selector for sent in arriving for selector, _ in sent}
                if voices > 1 and all(arriving) and "list" in selectors and not selectors & _TO_ONE_VOICE:
                    problems.append(Problem(
                        "voice patch",
                        f"{label} has {voices} voices and gets a list in its left inlet, but never `note`, "
                        f"`midinote` or `target`, so every voice gets every list and all {voices} do the "
                        f"same thing. Put `prepend note` before it to give each list to a free voice "
                        f"(the voice marks itself busy with thispoly~), or send `target` and a voice "
                        f"number first.",
                        [box_id]))

            if _is({name}, "buffer_readers") or name == "waveform~":
                for source, outlet in left:
                    for reads in _set_numbers(boxes, into, source, outlet):
                        problems.append(Problem(
                            "message",
                            f"{_label(boxes[source])} sends {reads} to {label}. There `set` takes the name of "
                            f"a buffer~, so this asks for a buffer called by that number and the sound is "
                            f"lost. To jump to a place in the sound, send the number alone.",
                            [source, box_id]))

            if name == "waveform~" and not box.get("buffername"):
                arriving = [_sent(boxes, into, source, outlet) for source, outlet in left]
                if all(arriving) and not any(selector == "set" for sent in arriving for selector, _ in sent):
                    problems.append(Problem(
                        "never starts",
                        f"{label} is never told which buffer~ to show, so it stays empty. Send it "
                        f"`set` and the buffer's name, for example a message box `set mybuffer`"
                        f"{' with a loadbang into it' if not left else ''}.",
                        [box_id]))

            if name in _SPEED_BY_SIGNAL and box_id in out_of:
                rates = [_is_audio(boxes[source], outlet) for source, outlet in left]
                if all(rate is False for rate in rates):
                    numbers = (" The numbers sent there set where it plays from, not how fast."
                               if left else "")
                    problems.append(Problem(
                        "never starts",
                        f"{label} plays at the speed of the audio signal in its left inlet, and no audio "
                        f"cord goes there, so its speed is 0 and it is silent.{numbers} Connect `sig~ 1.` "
                        f"to the left inlet for normal speed.",
                        [box_id]))

            # these two have cords into the left inlet and still never get the bang: a
            # jit.catch~ takes its audio there, a transport is switched on and off there
            if name in ("jit.catch~", "transport") and left and box_id in out_of:
                arriving = [_sent(boxes, into, source, outlet) or
                            ([("signal", "")] if _is_audio(boxes[source], outlet) else [])
                            for source, outlet in left]
                if all(arriving) and not any(selector == "bang" for sent in arriving for selector, _ in sent):
                    got = ("only audio" if name == "jit.catch~" else "messages that switch it on and off")
                    problems.append(Problem(
                        "never starts",
                        f"{label} sends {_ON_A_BANG[name]} only when it gets a bang, and its left inlet gets "
                        f"{got}, never a bang, so it never sends. Connect a `qmetro 33 @active 1` or a "
                        f"metro with a toggle to its left inlet as well.",
                        [box_id]))

            if left or box_id not in out_of and name != "jit.world":
                continue
            if (name in _ON_A_BANG and not _OWN_OUTPUT.search(text)
                    and not (has_world and name in _DRAWN_BY_A_WORLD)):
                problems.append(Problem(
                    "never starts",
                    f"{label} sends {_ON_A_BANG[name]} only when it gets a bang, and nothing is connected "
                    f"to its left inlet, so it never sends. Connect a `qmetro 33 @active 1` or a metro "
                    f"with a toggle to its left inlet.",
                    [box_id]))
            elif name in _CLOCKS and not _ON.search(text):
                problems.append(Problem(
                    "never starts",
                    f"{label} is never switched on: nothing is connected to its left inlet, so it never "
                    f"ticks. Connect a toggle or `loadmess 1` to its left inlet, or add `@active 1` to "
                    f"the box.",
                    [box_id]))
            elif name == "jit.world" and not _ON.search(text):
                problems.append(Problem(
                    "never starts",
                    f"{label} is never enabled, so it draws nothing. Add `@enable 1` to the box, or "
                    f"connect a toggle to its left inlet.",
                    [box_id]))
    return problems
