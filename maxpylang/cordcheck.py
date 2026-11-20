"""
cordcheck

The runtime form of the check in the .pyi stubs: audio into an inlet that takes no
audio, and a tap link (tapin~'s outlet) into anything but a tapout~. It reads the same table, maxpylang/data/xlet_types.json, so a script gets the
same answer whether or not a type checker runs on it, and whatever style it is
written in (objects placed by string or by stub, connections as lists or tuples).

    judge()           --> "ok", "problem" or "unknown" from two rates
    verdict()         --> judge() for one cord between an Outlet and an Inlet
    warn_if_problem() --> ConnectionWarning, reported at the user's line
    coverage()        --> verdict counts over every cord in a patch
    unchecked()       --> the objects behind the cords that could not be checked, and why

A verdict is "unknown" when the type data cannot decide it: the outlet's rate is not
known, or audio goes into an inlet that is not known to take or refuse it.

Where the table leaves an outlet open (its count changes with arguments, as line~'s and
groove~'s do), the object's own saved outlet type decides: the one Max wrote for a loaded
patch, or the one maxpylang's count rules gave a new object. Objects whose outlets come
from what is inside them (patcher, gen~, js...) or from what is sent in (inlet) are left
unknown.
"""

import functools
import json
import sys
import warnings
from pathlib import Path

from .exceptions import ConnectionWarning

_PACKAGE_DIR = str(Path(__file__).resolve().parent)
_DATA = Path(_PACKAGE_DIR) / "data" / "xlet_types.json"

AUDIO = ("signal", "mc")

# a box's saved outlet type, as a rate; every other type ("", "int", "bang"...) is a message
_SAVED_KINDS = {"signal": "signal", "multichannelsignal": "mc", "jit_matrix": "matrix", "tapconnect": "tap"}

# objects whose saved outlet types say nothing sure: they pass on what they are sent, or
# their outlets are made by a patcher or a script inside them
_CONTENT_DECIDES = {"inlet", "outlet", "gen", "jit.gen", "jit.pix", "jit.gl.pix", "mxj", "mxj~"}


@functools.lru_cache(maxsize=None)
def _table():
    """{max object name: {"ins": ..., "outs": ...}}; names are unique across packages."""
    with open(_DATA, encoding="utf-8") as f:
        data = json.load(f)
    return {name: entry for objs in data.values() for name, entry in objs.items()}


def _max_name(obj):
    """The object's name in the type data. Aliases resolve through the reference file:
    `t b b` is named "t" but described by trigger.json."""
    ref = obj._ref_file
    if not ref or ref in ("abstraction", "not_found"):
        return None
    return Path(ref).stem


def rate_of(name, side, index):
    """Rate of inlet or outlet `index` of the object called `name` in the type data, on side
    "ins" or "outs", or None when not known."""
    entry = _table().get(name)
    if entry is None:
        return None
    rates = entry[side]
    if isinstance(rates, list):
        if index >= len(rates):
            return None
        rates = rates[index]
    return None if rates == "any" else rates


@functools.lru_cache(maxsize=None)
def _content_decides():
    with open(Path(_PACKAGE_DIR) / "data" / "graph_roles.json", encoding="utf-8") as f:
        return _CONTENT_DECIDES | set(json.load(f)["opaque"])


# Max works out what crosses a subpatcher's edge and saves it: on the box of a patcher or
# bpatcher, the type each outlet sends; on an inlet object, the type its parent sends in.
# Against Max's own shipped patches a patcher box saved with its contents is never wrong
# (1,465 audio outlets and 3,060 message outlets whose source inside is known).
#
# An inlet object is trusted less. Saved as a message type (int, bang, list...) it sends
# messages. Saved as audio it stays unknown, because an inlet that takes audio usually takes
# messages on the same cord: BEAP's modules follow theirs with `routepass` to split the two,
# and flagging that would be a false alarm.
_MAX_RECORDS = {"patcher", "bpatcher", "inlet"}


def outlet_rate(name, index, saved_types, seen_inside=False):
    """
    Rate of outlet `index` of the object called `name`: from the type data, else from
    `saved_types`, the box's own "outlettype" list. None when neither can say.

    `seen_inside`: the box was saved with its contents (a subpatcher), so Max worked out
    every one of its outlet types from them. Without it an empty type is not evidence: it
    is also what a box holds before Max has seen what is connected.
    """
    known = rate_of(name, "outs", index)
    if known is not None or index >= len(saved_types or []):
        return known
    kind = saved_types[index]
    if name in _content_decides():
        if name not in _MAX_RECORDS:
            return None
        if name == "inlet":
            return None if not kind or _SAVED_KINDS.get(kind) in AUDIO else _SAVED_KINDS.get(kind, "control")
        if kind in _SAVED_KINDS:
            return _SAVED_KINDS[kind]
        return "control" if kind or seen_inside else None
    return _SAVED_KINDS.get(kind, "control")


def rate(xlet, side):
    """Rate of an Inlet (side "ins") or Outlet ("outs"), or None when not known."""
    name = _max_name(xlet.parent)
    if not name:
        return None
    if side == "outs":
        box = (xlet.parent._dict or {}).get("box", {})
        return outlet_rate(name, xlet.index, box.get("outlettype"), "patcher" in box)
    return rate_of(name, side, xlet.index)


TAP = "tap"


def judge(out_rate, in_rate):
    """
    "problem" when the outlet sends audio and the inlet takes none, "ok" when the data
    says the cord is fine, "unknown" when it cannot say. Messages and Jitter matrices
    may go into any inlet, so only audio cords can be a problem.

    A tap link is the other kind of cord that can be wrong. tapin~ sends one, and it only
    fits a tapout~, whose inlets take a tap link, audio or a number.
    """
    if out_rate is None:
        return "unknown"
    if in_rate == TAP:
        return "ok"
    if out_rate == TAP:
        return "unknown" if in_rate is None else "problem"
    if out_rate not in AUDIO:
        return "ok"
    if in_rate == "control":
        return "problem"
    if in_rate == "signal":
        return "ok"
    return "unknown"


def verdict(outlet, inlet):
    """judge() for one cord between an Outlet and an Inlet."""
    return judge(rate(outlet, "outs"), rate(inlet, "ins"))


def _describe(xlet):
    obj = xlet.parent
    box_id = (obj._dict or {}).get("box", {}).get("id")
    return f"{obj.name} ({box_id})" if box_id else obj.name


def _hint(inlet):
    if inlet.parent.name.startswith("jit."):
        return "To turn audio into a Jitter matrix, go through jit.catch~."
    return "To use audio as numbers, go through snapshot~."


def _user_stacklevel():
    """stacklevel for warnings.warn called from here, pointing at the first frame outside
    maxpylang: the user's connect() call, or their MaxPatch(load_file=...) line."""
    # by module name, not file path: a path can differ through symlinks (/tmp on macOS)
    level, frame = 1, sys._getframe(1)
    while frame is not None and frame.f_globals.get("__name__", "").split(".")[0] == "maxpylang":
        frame = frame.f_back
        level += 1
    return level


def warn_if_problem(outlet, inlet):
    """Warn when the cord outlet -> inlet carries audio into an inlet that takes none."""
    if verdict(outlet, inlet) != "problem":
        return
    if rate(outlet, "outs") == TAP:
        message = (
            f"{_describe(outlet)} outlet {outlet.index} sends a tap link, not audio, and only a "
            f"tapout~ can read one, but it goes to {_describe(inlet)} inlet {inlet.index}. Connect "
            f"it to a tapout~ and take the delayed audio from the tapout~'s outlet."
        )
        warnings.warn(message, ConnectionWarning, stacklevel=_user_stacklevel())
        return
    message = (
        f"{_describe(outlet)} outlet {outlet.index} sends audio, but {_describe(inlet)} "
        f"inlet {inlet.index} takes no audio. Max keeps the cord and only prints a console "
        f"warning. {_hint(inlet)}"
    )
    warnings.warn(message, ConnectionWarning, stacklevel=_user_stacklevel())


def coverage(patch):
    """Counts of each verdict over every cord in the patch."""
    counts = {"ok": 0, "problem": 0, "unknown": 0}
    for obj in patch.objs.values():
        for outlet in obj.outs:
            for inlet in outlet.destinations:
                counts[verdict(outlet, inlet)] += 1
    return counts


def _why_unknown(outlet, inlet):
    """The inlet or outlet a cord's "unknown" verdict is owed to, and the reason. The outlet comes
    first: when its rate is not known, the inlet is never looked at."""
    xlet = outlet if rate(outlet, "outs") is None else inlet
    ref = xlet.parent._ref_file
    if ref == "abstraction":
        return xlet, "abstraction"
    if not ref or ref == "not_found":
        return xlet, "unknown object"
    return xlet, "no type data"


def unchecked(patch):
    """
    Why cords were not checked: [(object text, reason, number of cords)], most cords first.
    The reason is "unknown object", "abstraction" (its inlets and outlets are whatever the
    file inside makes them) or "no type data" (a known object whose inlet or outlet is not
    recorded as audio or message).
    """
    counts = {}
    for obj in patch.objs.values():
        for outlet in obj.outs:
            for inlet in outlet.destinations:
                if verdict(outlet, inlet) == "unknown":
                    owner, why = _why_unknown(outlet, inlet)
                    key = (_describe(owner), why)
                    counts[key] = counts.get(key, 0) + 1
    return [(label, why, n) for (label, why), n in sorted(counts.items(), key=lambda item: (-item[1], item[0]))]
