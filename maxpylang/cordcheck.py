"""
cordcheck

The runtime form of the check in the .pyi stubs: audio into an inlet that takes no
audio. It reads the same table, maxpylang/data/xlet_types.json, so a script gets the
same answer whether or not a type checker runs on it, and whatever style it is
written in (objects placed by string or by stub, connections as lists or tuples).

    judge()           --> "ok", "problem" or "unknown" from two rates
    verdict()         --> judge() for one cord between an Outlet and an Inlet
    warn_if_problem() --> ConnectionWarning, reported at the user's line
    coverage()        --> verdict counts over every cord in a patch

A verdict is "unknown" when the type data cannot decide it: the outlet's rate is not
known, or audio goes into an inlet that is not known to take or refuse it.
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


def rate(xlet, side):
    """Rate of an Inlet (side "ins") or Outlet ("outs"), or None when not known."""
    name = _max_name(xlet.parent)
    return rate_of(name, side, xlet.index) if name else None


def judge(out_rate, in_rate):
    """
    "problem" when the outlet sends audio and the inlet takes none, "ok" when the data
    says the cord is fine, "unknown" when it cannot say. Messages and Jitter matrices
    may go into any inlet, so only audio cords can be a problem.
    """
    if out_rate is None:
        return "unknown"
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
