"""
textcheck

Checks on what is typed in a box, run when the patch is saved. Each of these is text Max
accepts without a word and then does something other than what it reads like.

    envelope message  a message box that sends an envelope to line~ or curve~ as two
                      messages: `1 40, 0 160`. A comma ends a message, so the ramp to 1 is
                      sent and the ramp to 0 replaces it at once: the envelope never rises.
                      One message holds the whole envelope: `0, 1 40 0 160`.
    expression        a jit.expr whose expression is not one it can read: typed as plain
                      arguments, which jit.expr takes as plane count, type and size, or
                      written with `in1` and `out1`, which are jit.gen's names. jit.expr
                      reads `@expr` and calls its inputs `in[0]`, `in[1]`.

Neither appears in the 3,203 patches and devices that ship with Max: see
tests/test_max_corpus.py.

    text_problems() --> these problems for a whole .maxpat or .amxd patcher
"""

import re

from .devicecheck import _label, _Patcher, _patchers
from .graphcheck import Problem, _words

TEXT_KINDS = ("envelope message", "expression")

_NUMBER = re.compile(r"-?(\d+\.?\d*|\.\d+)$")
_RAMP_READERS = ("line~", "curve~")
_GEN_NAMES = re.compile(r"\b(in|out)\d+\b")
_LOOKS_LIKE_MATHS = re.compile(r"[\[\]()*+/<>=&|]|\b(in|out)\d+\b|\b(s?norm|cell|dim)\b")
_EXPR = re.compile(r"@expr\s+(.*?)(?=\s@\w|$)")


def _cut_ramp(text):
    """The messages of a message box if an earlier one is a ramp that a later one cuts
    short, else None. Only all-number messages are judged."""
    parts = [part.split() for part in text.split(",")]
    if len(parts) < 2 or not all(part and all(_NUMBER.match(word) for word in part) for part in parts):
        return None
    for part in parts[:-1]:
        if len(part) >= 2 and float(part[1]) > 0:
            return parts
    return None


def text_problems(patcher):
    """Problems with what is typed in a box, in a whole patcher (the "patcher" dict of a
    .maxpat or .amxd), nested patchers included."""
    problems = []
    cut = {}   # message text -> its report
    for current in _patchers(patcher):
        graph = _Patcher(current)
        for box_id, box in graph.boxes.items():
            name, args = _words(box)
            if name is None:
                continue
            label = _label(box)

            if name in _RAMP_READERS:
                for source, outlet in graph.into.get((box_id, 0), ()):
                    sender = graph.boxes[source]
                    if sender.get("maxclass") != "message" or graph.into.get((source, 1)):
                        continue
                    text = (sender.get("text") or "").strip()
                    parts = _cut_ramp(text)
                    if parts is None:
                        continue
                    if text in cut:   # one report for a message box repeated in every voice
                        cut[text].nodes.append(source)
                        continue
                    if all(len(part) <= 2 for part in parts):
                        steps = " ".join(word for part in parts for word in (part if len(part) > 1 else part + ["0"]))
                        fix = f"`{steps}`" if parts[0][0] == "0" or len(parts[0]) == 1 else f"`0, {steps}`"
                    else:
                        fix = "`0, 1 40 0 160`: pairs of a value and the time to reach it"
                    cut[text] = Problem(
                        "envelope message",
                        f"message `{text}` ({source}) sends {label} {len(parts)} messages at once, since a "
                        f"comma ends a message. Each ramp replaces the one before it, so only the last is "
                        f"heard and the envelope never rises. Put every step in one message: {fix}.",
                        [source, box_id])
                    problems.append(cut[text])

            if name == "jit.expr":
                text = box.get("text") or ""
                typed = _EXPR.search(text)
                plain = [word for word in args if _LOOKS_LIKE_MATHS.search(word)]
                if typed is None and plain:
                    problems.append(Problem(
                        "expression",
                        f"{label} has its expression typed as plain arguments (`{' '.join(args)[:60]}`). "
                        f"jit.expr reads those as plane count, type and size, so no expression is set. "
                        f"Write it after `@expr`, with inputs called in[0], in[1]: "
                        f"`jit.expr @expr in[0]*0.5`.", [box_id]))
                elif typed is not None and _GEN_NAMES.search(typed.group(1)):
                    used = sorted(set(match.group(0) for match in _GEN_NAMES.finditer(typed.group(1))))
                    problems.append(Problem(
                        "expression",
                        f"{label} uses {', '.join(used)} in its expression. Those are jit.gen's names: "
                        f"jit.expr calls its inputs in[0], in[1], counting from 0, and has one output, "
                        f"with one expression for each plane. Write `in[0]` where it says `in1`.", [box_id]))
    return problems
