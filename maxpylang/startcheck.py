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
                         toggle into its left inlet. A bang draws one frame, so a world
                         whose left inlet gets only bangs or other messages is not enabled.
                       - jit.matrix sends nothing when `importmovie` or `read` loads a
                         file into it: a bang has to follow.
                       - groove~ plays at the speed of the audio signal in its left inlet.
                         With no signal there the speed is 0. A number there sets where
                         it plays from, not how fast.
                       - waveform~ shows nothing until a `set` message names its buffer.

    message          `set 0` sent to a groove~, play~ or another object that reads a
                     buffer~. There `set` takes the name of a buffer, so this asks for a
                     buffer called 0. To jump to the start of the sound, send a number.

    voice patch      a problem between a poly~ or pfft~ and the patch file it loads, when
                     that file is in the folder the patch is saved to:
                       - the file uses inlet or outlet objects and no `in` or `out`.
                         Inside a poly~ only `in`, `in~`, `out` and `out~` make inlets and
                         outlets; inside a pfft~ only fftin~, fftout~, `in` and `out`.
                       - a poly~ with several voices gets its notes (from a notein, a
                         kslider, a makenote) as a plain list and never `note`, `midinote`
                         or `target`, so every voice gets every note and they all play the
                         same thing. A list not made from notes is left alone: a list to
                         every voice is also how a shared setting is sent.
                       - a list is sent to the poly~, the file reads its `in 2`, nothing
                         is connected to the second inlet, and `in 1` goes straight into
                         an object that takes one number (mtof, sig~). A list sent to the
                         first inlet is not split across the inlets: it arrives whole at
                         `in 1`.

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
_COUNT = re.compile(r"[0-9]+$")
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
_ON_BY_ATTRIBUTE = ("metro", "qmetro", "clocker")   # tempo has no active attribute
_SPEED_BY_SIGNAL = ("groove~", "mc.groove~")
_VOICE_HOSTS = ("poly~", "mc.poly~", "pfft~")
_VOICE_INS = ("in", "in~", "mc.in~")
_PLAIN_IO = ("inlet", "outlet")
_TO_ONE_VOICE = {"note", "midinote", "target", "notemessage", "midievent", "mpeevent"}
_ONE_NUMBER = ("mtof", "ftom", "sig~", "number", "flonum", "abs", "dbtoa", "atodb")
_DRAWN_BY_A_WORLD = ("jit.grab", "jit.movie")
_NOTE_SOURCES = ("kslider", "makenote", "stripnote", "midiparse", "borax", "poly")
_NAMES_A_BUFFER = ("set", "name", "buffername")


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
        # what follows a `;` goes to a receiver by name, not out the outlet
        for part in _text(box).split(";")[0].split(","):
            words = part.split()
            if len(words) == 2 and words[0] == "set":
                if _NUMBER.match(words[1]) or (words[1] == "$1" and numbers_arrive()):
                    found.append(f"`{' '.join(words)}`")
        return found
    name, args = _words(box)
    if name == "prepend" and args == ["set"] and outlet == 0 and numbers_arrive():
        return ["`set` and a number"]
    return []


def _list_arrives(boxes, into, source, outlet):
    """True if this outlet is known to send a list, bare or behind `prepend note`."""
    if any(selector == "list" for selector, _ in _sent(boxes, into, source, outlet)):
        return True
    name, args = _words(boxes[source])
    return (name == "prepend" and args[:1] in (["note"], ["midinote"]) and outlet == 0
            and any(_list_arrives(boxes, into, feeder, feeder_outlet)
                    for feeder, feeder_outlet in into.get((source, 0), ())))


def _from_notes(boxes, into, source, seen=None):
    """True if a MIDI note source (notein, kslider, makenote) is upstream of this box."""
    seen = set() if seen is None else seen
    if source in seen or len(seen) > 40:
        return False
    seen.add(source)
    if _name(boxes[source]) in _NOTE_SOURCES or _is({_name(boxes[source])}, "midi_in"):
        return True
    return any(_from_notes(boxes, into, feeder, seen)
               for (dest, _), feeders in into.items() if dest == source for feeder, _ in feeders)


def _takes_one_number(name):
    return name in _ONE_NUMBER or (_is({name}, "right_inlets_cold") and name not in ("pack", "expr"))


def _voice_file(box, folders):
    """The patcher a poly~ or pfft~ box loads, if its file is in one of the folders."""
    words = _text(box).split()
    if len(words) < 2 or "$" in words[1] or "#" in words[1]:
        return None, None
    file_name = words[1] if words[1].endswith(".maxpat") else words[1] + ".maxpat"
    for folder in folders:
        try:
            path = Path(folder) / file_name
            if not path.is_file():
                continue
            with open(path, encoding="utf-8") as f:
                voice = json.load(f)["patcher"]
        except (OSError, ValueError, KeyError, TypeError):
            return None, None
        return (file_name, voice) if isinstance(voice, dict) else (None, None)
    return None, None


def _voice_problems(box, fed, folders, list_arrives):
    """Problems between one poly~ or pfft~ box and its file. fed: the box's inlets with a
    cord. list_arrives: a list is known to reach the left inlet. The file is somebody
    else's and may hold anything, so one that is not shaped like a patcher is left alone."""
    try:
        return _read_voice(box, fed, folders, list_arrives)
    except (AttributeError, TypeError, ValueError, IndexError, KeyError):
        return []


def _read_voice(box, fed, folders, list_arrives):
    file_name, voice = _voice_file(box, folders)
    if voice is None:
        return []
    host = _text(box).split()[0]
    problems = []
    inner = {entry["box"].get("id"): entry["box"] for entry in voice.get("boxes", []) if "box" in entry}
    names = {_name(b) for b in inner.values()}
    plain = sorted(names & set(_PLAIN_IO))
    # a file with both `inlet` and `in 1` is written to work as an abstraction too
    if plain and not names & {"in", "out"}:
        made, audio = (("fftin~, fftout~, in and out", "fftin~ 1") if host == "pfft~"
                       else ("in, in~, out and out~", "in~ 1"))
        problems.append(Problem(
            "voice patch",
            f"{file_name} has {' and '.join(plain)} objects, and {_label(box)} loads it. Inside a {host} only "
            f"{made} make inlets and outlets, so the {host} gets none from these. Use `in 1` for the first "
            f"message inlet and `{audio}` for the first audio inlet.",
            [box.get("id")]))
    # which of its inlets the file reads, and what `in 1` feeds
    read, first_feeds = set(), set()
    for line in voice.get("lines", []):
        cord = line.get("patchline", {})
        source = inner.get(cord.get("source", [None])[0])
        if source is not None and _name(source) in _VOICE_INS:
            words = _text(source).split()
            number = int(words[1]) if len(words) > 1 and _COUNT.match(words[1]) else 1
            read.add(number)
            if number == 1 and _name(source) == "in":
                first_feeds.add(_name(inner.get(cord.get("destination", [None])[0], {})))
    unfed = sorted(number for number in read if number - 1 not in fed)
    # Max's own help patches leave inlets of a voice unconnected: a control nobody has to
    # use. So this is only reported for the mistake itself: a list is sent to the left
    # inlet, and `in 1` goes straight into objects that take one number, which shows the
    # voice expects one value per inlet.
    if list_arrives and unfed and first_feeds and all(_takes_one_number(name) for name in first_feeds):
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
    # in the patch is drawing. The world can also be out of sight: in an abstraction, or in
    # the patch this one is loaded into.
    everything = [entry.get("box", {}) for current in _patchers(patcher) for entry in current.get("boxes", [])]
    has_world = any(_name(box) in ("jit.world", "jit.pworld") or _is({_name(box)}, "part_of_a_bigger_patch")
                    or box.get("maxclass") == "newobj" and (
                        _name(box) not in _known() or "patcher" in box or _is({_name(box)}, "opaque"))
                    for box in everything)
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
                problems += _voice_problems(box, fed, folders,
                                            any(_list_arrives(boxes, into, source, outlet) for source, outlet in left))

            if name in ("poly~", "mc.poly~") and left and "@target" not in text:
                words = text.split()
                voices = int(words[2]) if len(words) > 2 and _COUNT.match(words[2]) else 1
                arriving = [_sent(boxes, into, source, outlet) for source, outlet in left]
                selectors = {selector for sent in arriving for selector, _ in sent}
                # a list to every voice is also how a setting shared by all of them is sent
                # (a cutoff and a Q), so this is only reported for a list made from notes
                notes = [source for source, outlet in left
                         if any(selector == "list" for selector, _ in _sent(boxes, into, source, outlet))
                         and _from_notes(boxes, into, source)]
                if voices > 1 and all(arriving) and notes and not selectors & _TO_ONE_VOICE:
                    problems.append(Problem(
                        "voice patch",
                        f"{label} has {voices} voices and gets its notes as a plain list in its left "
                        f"inlet, never as `note`, `midinote` or after a `target`, so every voice gets "
                        f"every note and all {voices} play the same thing. Put `prepend note` before it "
                        f"to give each note to a free voice (the voice marks itself busy with "
                        f"thispoly~), or `prepend midinote` so a note-off reaches the voice that plays it.",
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
                arriving = [_sent(boxes, into, source, outlet)
                            for (dest, _), feeders in into.items() if dest == box_id for source, outlet in feeders]
                if all(arriving) and not any(selector in _NAMES_A_BUFFER for sent in arriving for selector, _ in sent):
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
                # a transport also answers a get message, so only numbers count as "switched"
                allowed = ("signal",) if name == "jit.catch~" else ("int", "float")
                if all(arriving) and all(selector in allowed for sent in arriving for selector, _ in sent):
                    got = ("only audio" if name == "jit.catch~" else "numbers, which switch it on and off")
                    problems.append(Problem(
                        "never starts",
                        f"{label} sends {_ON_A_BANG[name]} only when it gets a bang, and its left inlet gets "
                        f"{got}, never a bang, so it never sends. Connect a `qmetro 33 @active 1` or a "
                        f"metro with a toggle to its left inlet as well.",
                        [box_id]))

            # cords into the left inlet, and none of them carries what starts it
            if name in ("jit.world", "jit.matrix") and left:
                arriving = [_sent(boxes, into, source, outlet) for source, outlet in left]
                selectors = {selector for sent in arriving for selector, _ in sent} if all(arriving) else None
                if (name == "jit.world" and selectors is not None and not _ON.search(text)
                        and not selectors & {"int", "float", "enable", "list"}):
                    got = "only a bang, which draws one frame" if selectors == {"bang"} else "no `enable`"
                    problems.append(Problem(
                        "never starts",
                        f"{label} is never enabled: its left inlet gets {got}, so it does not keep "
                        f"drawing. Add `@enable 1` to the box, or connect a toggle to its left inlet.",
                        [box_id]))
                if (name == "jit.matrix" and selectors is not None and box_id in out_of
                        and selectors & {"importmovie", "read"}
                        and not selectors & {"bang", "jit_matrix", "outputmatrix", "int", "float", "list"}):
                    loads = "importmovie" if "importmovie" in selectors else "read"
                    problems.append(Problem(
                        "never starts",
                        f"{label} is sent `{loads}`, which loads the file into the matrix and sends nothing. "
                        f"No bang follows, so what it loaded never leaves. Send a `bang` after it: a message "
                        f"box `{loads} picture.png, bang` does both in order.",
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
            elif name in _CLOCKS and not (name in _ON_BY_ATTRIBUTE and _ON.search(text)):
                by_attribute = ", or add `@active 1` to the box" if name in _ON_BY_ATTRIBUTE else ""
                problems.append(Problem(
                    "never starts",
                    f"{label} is never switched on: nothing is connected to its left inlet, so it never "
                    f"ticks. Connect a toggle or `loadmess 1` to its left inlet{by_attribute}.",
                    [box_id]))
            elif name == "jit.world" and not _ON.search(text):
                problems.append(Problem(
                    "never starts",
                    f"{label} is never enabled, so it draws nothing. Add `@enable 1` to the box, or "
                    f"connect a toggle to its left inlet.",
                    [box_id]))
    return problems
