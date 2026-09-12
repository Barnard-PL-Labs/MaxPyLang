"""
Capture maxpylang's real arity/typing output for web/test/fixtures/io-parity.json.

web/src/ir/io-rules.ts is a hand port of maxpylang's parse_io_num / parse_io_typing
(tools/objfuncs/makexlets.py) plus the trigger/unpack/vst~ cases in specialobjs.py.
A port is only trustworthy if something checks it against the original, so this script
instantiates every pair below through the *real* maxpylang and records exactly what
ended up in the box dict. test/io-rules.test.ts then replays the same texts through the
TypeScript port and demands agreement, except for an explicit KNOWN_DIVERGENCES
allowlist covering the upstream bugs the port deliberately fixes.

The corpus covers all 46 objects that carry an "in/out" rule, every alias of one
(t / sel / b), a handful of fixed-arity objects (to prove the no-rule path passes the
defaults through untouched) and an unknown name (to pin unknown_obj_dict). Per object
it walks the interesting edges: bare name (the args==[] early return), too-few args
(the numeric-index fallback), arity growth, arity *shrink* (where upstream's
remove_xlets is broken), acc_vals snapping including a deliberate tie, and every
comparitor in the corpus.

Rows where maxpylang raises are recorded as {"error": ...} with null counts rather than
dropped — `switch 1` crashing with an IndexError is a real fact about upstream that the
allowlist should have to name out loud.

Usage:  .venv/bin/python web/scripts/gen-io-fixtures.py
"""

import json
import os
import sys
import tempfile
import traceback
import warnings
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
OUT = HERE.parent / "test" / "fixtures" / "io-parity.json"

sys.path.insert(0, str(REPO))

# Objects whose arity depends on their arguments, in the order gen-manifest.mjs walks
# them (max, then msp, then jit). Every one must appear below or COVERAGE fails.
RULE_OBJECTS = [
    "bangbang", "bondo", "bucket", "buddy", "combine", "cycle", "decode", "funnel",
    "gate", "grab", "js", "mpeformat", "pack", "pak", "pvar", "route", "routepass",
    "router", "select", "spray", "switch", "trigger", "unjoin", "unpack",
    "2d.wave~", "gate~", "matrix~", "mc.2d.wave~", "mc.combine~", "mc.gate~",
    "mc.matrix~", "mc.route", "mc.sfplay~", "mc.sig~", "mc.targetlist",
    "mc.transpose~", "mc.unpack~", "mc.vst~", "mc.wave~", "record~", "sfplay~",
    "sfrecord~", "vst~", "wave~", "jit.pack", "jit.unpack",
]

CASES = [
    # --- max: counts driven by the *number* of args (index "all") ---------------
    "combine", "combine a b", "combine a b c d",
    "pack", "pack 0 0", "pack 1 2 3", "pack f f", "pack i i i i",
    "pak", "pak 0 0", "pak 1 2 3 4",
    "route", "route 1", "route a b c", "route 1 2 3 4",
    "routepass", "routepass a b", "routepass 1 2 3",
    "switch", "switch 1", "switch 1 1", "switch 1 2 3", "switch 1 2 3 4",
    "trigger", "trigger b f", "trigger 1 2 3", "t", "t b f", "t b b b b",
    "t i", "t 0", "t b f s l", "t 1.5",
    "unpack", "unpack 1 2", "unpack 1 2 3", "unpack i i", "unpack f f",
    "unpack 0. 0.", "unpack a b c d", "unpack i f s",
    "select", "select 1", "select 1 2", "select 1 2 3", "sel 1 2", "select foo",
    # --- max: counts driven by the *value* of one arg (numeric index) -----------
    "bangbang", "bangbang 1", "bangbang 2", "bangbang 4", "b 3",
    "bondo", "bondo 1", "bondo 3", "bondo 4 250",
    "bucket", "bucket 1", "bucket 4", "bucket 3 1",
    "buddy", "buddy 1", "buddy 2", "buddy 3", "buddy 5",
    "cycle", "cycle 1", "cycle 4", "cycle 3 1",
    "decode", "decode 1", "decode 4",
    "funnel", "funnel 1", "funnel 2", "funnel 5", "funnel 3 1",
    "gate", "gate 1", "gate 2", "gate 4", "gate 2.7", "gate 3 1",
    "grab", "grab 1", "grab 3", "grab 2 name",
    "mpeformat", "mpeformat 1", "mpeformat 15", "mpeformat 16",
    "router", "router 1 1", "router 2 2", "router 3 4",
    "spray", "spray 1", "spray 4", "spray 3 1",
    "unjoin", "unjoin 1", "unjoin 2", "unjoin 4",
    # --- max: argtype "n" (non-numeric args are filtered out first) -------------
    "js", "js foo.js", "js foo.js 2 3", "js foo.js 3 4",
    "pvar", "pvar name", "pvar name 3", "pvar 4",
    # --- msp: acc_vals snapping, including the 3 -> {1,2,4} tie -----------------
    "2d.wave~", "2d.wave~ buf", "2d.wave~ buf 0 1 0", "2d.wave~ buf 0 1 1",
    "2d.wave~ buf 0 1 2", "2d.wave~ buf 0 1 3", "2d.wave~ buf 0 1 4",
    "2d.wave~ buf 0 1 5",
    "mc.2d.wave~", "mc.2d.wave~ buf", "mc.2d.wave~ buf 0 1 2",
    "mc.2d.wave~ buf 0 1 3", "mc.2d.wave~ buf 0 1 4",
    # --- msp: signal / multichannelsignal outlet typing -------------------------
    "gate~", "gate~ 1", "gate~ 4", "gate~ 3 1",
    "mc.gate~", "mc.gate~ 1", "mc.gate~ 4",
    "mc.combine~", "mc.combine~ 1", "mc.combine~ 4",
    "mc.route", "mc.route 1", "mc.route 4",
    "mc.sig~", "mc.sig~ 1", "mc.sig~ 1 2", "mc.sig~ 1 2 3",
    "mc.transpose~", "mc.transpose~ 1 1", "mc.transpose~ 2 4", "mc.transpose~ 3 2",
    "mc.unpack~", "mc.unpack~ 1", "mc.unpack~ 2", "mc.unpack~ 4",
    "sfrecord~", "sfrecord~ 1", "sfrecord~ 4", "sfrecord~ 2 8192",
    "wave~", "wave~ buf", "wave~ buf 0 100 1", "wave~ buf 0 100 2",
    "wave~ buf 0 100 4",
    "mc.wave~", "mc.wave~ buf", "mc.wave~ buf 0 100 2", "mc.wave~ buf 0 100 4",
    "record~", "record~ buf", "record~ buf 0", "record~ buf 1", "record~ buf 2",
    # --- msp: the add_amt pair (mc.matrix~ adds 2 where matrix~ adds 1) ---------
    "matrix~", "matrix~ 2 2", "matrix~ 2 4", "matrix~ 4 2", "matrix~ 4 4",
    "matrix~ 2 2 0.5",
    "mc.matrix~", "mc.matrix~ 2 2", "mc.matrix~ 2 4", "mc.matrix~ 4 4",
    # --- msp: two summed terms (sfplay~) and the {first,last} type map ----------
    "sfplay~", "sfplay~ 1", "sfplay~ 2", "sfplay~ 1 0 1", "sfplay~ 1 0 2",
    "sfplay~ 4 0 2", "sfplay~ sfl 2 4096 0",
    "mc.sfplay~", "mc.sfplay~ 1 2 1", "mc.sfplay~ 1 2 2", "mc.sfplay~ 1 2 3",
    "mc.sfplay~ sfl 2 4096",
    "mc.targetlist", "mc.targetlist 1 2", "mc.targetlist a 1 2 3 4",
    "mc.targetlist a 1 2 3 4 5",
    # --- msp: the comparitor rules (>1) and the 6/7-wide tail type list ---------
    "vst~", "vst~ 1", "vst~ 2", "vst~ 3", "vst~ 8", "vst~ 2 plug.vst",
    "mc.vst~", "mc.vst~ 1", "mc.vst~ 2", "mc.vst~ 4", "mc.vst~ 2 plug.vst",
    # --- jit --------------------------------------------------------------------
    "jit.pack", "jit.pack 1", "jit.pack 2", "jit.pack 4", "jit.pack 5",
    "jit.pack foo",
    "jit.unpack", "jit.unpack 2", "jit.unpack 4", "jit.unpack 5", "jit.unpack 8",
    "jit.unpack foo",
    # --- no "in/out" rule at all: the defaults must survive untouched -----------
    "cycle~ 440", "*~ 0.2", "+ 5", "metro 500", "loadbang", "print hello",
    "ezdac~", "jit.grab", "scale 0 127 0. 1.",
    # --- in-box attributes must not be mistaken for args ------------------------
    "cycle~ @frequency 440", "unpack 1 2 3 @foo bar",
    # --- not an object at all: pins unknown_obj_dict -----------------------------
    "zzz.not.an.object 1 2",
]


def capture(text):
    """Instantiate `text` through maxpylang and read the resulting box dict."""
    from maxpylang.maxobject import MaxObject

    try:
        box = MaxObject(text)._dict["box"]
    except Exception as exc:  # upstream genuinely crashes on some shrink cases
        return {
            "text": text,
            "numinlets": None,
            "numoutlets": None,
            "outlettype": None,
            "error": f"{type(exc).__name__}: {exc}",
        }
    row = {
        "text": text,
        "numinlets": box.get("numinlets"),
        "numoutlets": box.get("numoutlets"),
        # Absent for unknown objects — unknown_obj_dict has no outlettype key.
        "outlettype": box.get("outlettype"),
    }
    # vst~ is the one object whose arguments land somewhere other than the text and the
    # arity: update_vst appends them to `save`, and that list — not the text — is where
    # Max restores the channel count and the plugin from. Recorded only where the object
    # has one, so every other row stays a statement about the arity rules alone.
    if "save" in box:
        row["save"] = box["save"]
    return row


def main():
    warnings.simplefilter("ignore")  # UnknownObjectWarning is expected for the UNK rows
    from maxpylang.maxobject import MaxObject

    MaxObject.arg_warning = False

    missing = [o for o in RULE_OBJECTS if not any(
        c == o or c.startswith(o + " ") for c in CASES
    )]
    if missing:
        sys.exit(f"no case covers rule object(s): {missing}")

    # get_ref() falls back to looking for an abstraction file named after the object in
    # the CWD, so run somewhere empty or a stray ./pack would change what `pack` means.
    with tempfile.TemporaryDirectory() as tmp:
        os.chdir(tmp)
        rows = [capture(text) for text in CASES]

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(rows, indent=1) + "\n")

    errors = sum(1 for r in rows if "error" in r)
    print(f"wrote {OUT}")
    print(f"  {len(rows)} cases over {len(RULE_OBJECTS)} rule objects "
          f"({errors} where maxpylang raised)")


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception:
        traceback.print_exc()
        sys.exit(1)
