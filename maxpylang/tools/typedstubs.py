"""
tools.typedstubs

Generates the type stubs (maxpylang/objects/*.pyi) that let a static checker such as
ty, mypy or pyright check connect() calls: audio into an inlet that takes no audio,
and an inlet or outlet index past a fixed count.

    build_xlet_types() --> per-object inlet/outlet rates from a Max signature table
    load_xlet_types()  --> read the committed table, maxpylang/data/xlet_types.json
    build_pyi()        --> text of objects/{package}.pyi
    build_init_pyi()   --> text of objects/__init__.pyi

Regenerate the stubs:            python -m maxpylang.tools.typedstubs
Rebuild the table, then stubs:   python -m maxpylang.tools.typedstubs --refresh signatures.json

The signature table comes from maxpy-studio's research (failure-taxonomy/build_signatures.py),
which reads Max's refpages and the inlet/outlet counts Max saved in its own patchers.

Table format, per object: "ins" and "outs" are either a list with one rate per xlet (a
fixed count) or a single rate shared by any number of xlets (a count that depends on
arguments, attributes or contents). Inlet rates are "control" (takes no audio) or "any".
Outlet rates are "signal", "mc", "matrix", "control" or "any".
"""

import argparse
import ast
import contextlib
import functools
import json
import os
import re
import subprocess
import warnings
from pathlib import Path

PACKAGES = ["jit", "max", "msp"]

_HERE = Path(__file__).resolve().parent
OBJECTS_DIR = _HERE.parent / "objects"
DATA_PATH = _HERE.parent / "data" / "xlet_types.json"
OBJ_INFO_DIR = _HERE.parent / "data" / "OBJ_INFO"
REPO_ROOT = _HERE.parent.parent

_INLET = {"control": "Control", "any": "Signal | Control"}
_OUTLET = {"signal": "Signal", "mc": "MCSignal", "matrix": "Matrix", "control": "Control", "any": "Any"}


#************************************************************
#*************** SIGNATURE TABLE ****************************
#************************************************************


def build_xlet_types(signatures):
    """
    Build the xlet rate table for every stub object from a signature table (dict).

    Fixed counts that disagree with maxpylang's runtime objects are opened up, so the
    stubs never promise an inlet or outlet that the runtime object lacks.
    """

    objs = signatures["objects"]
    aliases = signatures.get("aliases", {})

    table = {}
    for package in PACKAGES:
        table[package] = {}
        for _, max_name, _ in read_stub_module(package):
            sig = objs.get(max_name) or objs.get(aliases.get(max_name) or "")
            if sig is None:
                continue
            types = object_types(max_name, sig)
            _open_runtime_disagreements(package, max_name, types)
            table[package][max_name] = types

    return table


# objects that pass on whatever they are given, audio included
_PASS_THROUGH = {"inlet", "outlet"}


def object_types(max_name, sig):
    """Static rates of one object's inlets ("ins") and outlets ("outs") from its signature row."""

    types = {"ins": _side(sig, "inlets"), "outs": _side(sig, "outlets")}
    if max_name in _PASS_THROUGH:
        for side, rates in types.items():
            types[side] = ["any"] * len(rates) if isinstance(rates, list) else "any"
    return types


def _side(sig, key):
    """Rates for one side of an object: a list for a fixed count, else one shared rate."""

    arity = (sig.get("arity") or {}).get(key) or {}
    if arity.get("kind") == "content":
        return "any"  # containers (bpatcher, poly~, js...): xlets come from what is inside

    if key == "inlets":
        rates = [_inlet_rate(sig, inlet) for inlet in sig["inlets"]]
    else:
        rates = [_outlet_rate(outlet) for outlet in sig["outlets"]]

    if arity.get("kind") == "fixed":
        count = arity["value"]
        return (rates + ["any"] * count)[:count]

    # open count: keep a rate only when every documented xlet shares it. Refpages list
    # representative outlets only (play~'s list has no room for its done-bang outlet), so
    # an audio rate also needs a type that Max saved in its own patchers.
    if key == "outlets" and any(o.get("type_source") != "patchers" for o in sig["outlets"]):
        rates = [r if r not in ("signal", "mc") else "any" for r in rates]
    if rates and len(set(rates)) == 1:
        return rates[0]
    return "any"


def _inlet_rate(sig, inlet):
    """An inlet takes no audio when its object has documented methods and none is signal."""

    methods = sig.get("methods") or []
    if methods and "signal" not in methods and inlet["rate"] in ("control", "matrix"):
        return "control"
    return "any"


# refpage digests of outlets that send messages, though some refpages type them as signals
# (the done bang of play~, mc.sfplay~ and mc.train~, the dumpout of jit.peek~)
_MESSAGE_DIGEST = re.compile(r"\s*(bang|dumpout)\b", re.IGNORECASE)


def _outlet_rate(outlet):
    kind = outlet["type"]
    if outlet.get("type_source") != "patchers" and _MESSAGE_DIGEST.match(outlet.get("digest") or ""):
        return "control"
    if kind == "signal":
        return "signal"
    if kind in ("multichannelsignal", "multi-channel signal"):
        return "mc"
    if kind in ("jit_matrix", "matrix"):
        return "matrix"
    return "control"


def _open_runtime_disagreements(package, max_name, types):
    """
    Replace a fixed count with an open one where maxpylang's runtime object may differ: the
    object is not in a clean install's object database (so it has no xlets), its count
    changes with arguments at runtime, or its default count differs.
    """

    counts = runtime_xlet_counts(package, max_name)
    rule_sides = runtime_rule_sides(package, max_name)

    for i, side in enumerate(("ins", "outs")):
        if not isinstance(types[side], list):
            continue
        if counts is None:
            reason = "not in the tracked object database"
        elif side in rule_sides:
            reason = "count changes with arguments at runtime"
        elif len(types[side]) != counts[i]:
            reason = f"Max has {len(types[side])}, maxpylang has {counts[i]}"
        else:
            continue
        print(f"\t{max_name} {side}: {reason}; left open")
        types[side] = "any"


@functools.lru_cache(maxsize=None)
def known_objects():
    """
    (package, Max name) of every object in a clean install's object database: the OBJ_INFO
    files tracked by git, or, outside a git checkout, the files on disk.
    """

    try:
        listing = subprocess.run(["git", "ls-files", "-z", "--", str(OBJ_INFO_DIR)], cwd=REPO_ROOT,
                                 capture_output=True, check=True).stdout.decode()
        paths = [Path(p) for p in listing.split("\0") if p.endswith(".json")]
    except (OSError, subprocess.CalledProcessError):
        paths = []
    if not paths:
        paths = list(OBJ_INFO_DIR.glob("*/*.json"))
    return {(path.parent.name, path.stem) for path in paths}


def _obj_info(package, max_name):
    """The object's OBJ_INFO json, or None when a clean install does not know it."""

    if (package, max_name) not in known_objects():
        return None
    with open(OBJ_INFO_DIR / package / f"{max_name}.json") as f:
        return json.load(f)


def runtime_rule_sides(package, max_name):
    """Sides ("ins", "outs") whose count maxpylang's runtime changes with arguments."""

    rules = (_obj_info(package, max_name) or {}).get("in/out") or {}
    return {side for side, key in (("ins", "numinlets"), ("outs", "numoutlets")) if rules.get(key)}


# placeholder values for required arguments, by documented type
_PLACEHOLDER_ARGS = {"symbol": "x", "int": "1", "float": "1.", "number": "1", "list": "1", "any": "1"}


def runtime_xlet_counts(package, max_name):
    """
    (inlets, outlets) of maxpylang's runtime object, built with placeholder values for any
    required arguments. None when this install does not know the object.
    """

    info = _obj_info(package, max_name)
    if info is None:
        return None

    required = info.get("args", {}).get("required", [])
    words = [max_name] + [_PLACEHOLDER_ARGS.get((arg.get("type") or ["any"])[0], "1") for arg in required]

    from maxpylang.maxobject import MaxObject

    with warnings.catch_warnings(), open(os.devnull, "w") as devnull:
        warnings.simplefilter("ignore")
        with contextlib.redirect_stdout(devnull):
            obj = MaxObject(" ".join(words))

    if obj.notknown():
        return None
    return len(obj.ins), len(obj.outs)


def load_xlet_types():
    """The committed xlet rate table."""

    with open(DATA_PATH) as f:
        return json.load(f)


def dump_xlet_types(table):
    """Write the table with one object per line, so diffs stay readable."""

    lines = ["{"]
    for p, package in enumerate(PACKAGES):
        lines.append(f'  "{package}": {{')
        entries = sorted(table[package].items())
        for e, (name, types) in enumerate(entries):
            comma = "," if e < len(entries) - 1 else ""
            lines.append(f"    {json.dumps(name)}: {json.dumps(types, sort_keys=True)}{comma}")
        lines.append("  }" + ("," if p < len(PACKAGES) - 1 else ""))
    lines.append("}")

    with open(DATA_PATH, "w") as f:
        f.write("\n".join(lines) + "\n")


#************************************************************
#*************** TYPE STUBS *********************************
#************************************************************


def read_stub_module(package):
    """(python name, Max name, docstring) for each stub in objects/{package}.py."""

    tree = ast.parse((OBJECTS_DIR / f"{package}.py").read_text())
    stubs = []
    for i, node in enumerate(tree.body):
        # py_name = MaxObject('max_name')
        if not (isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name)
                and isinstance(node.value, ast.Call) and isinstance(node.value.func, ast.Name)
                and node.value.func.id == "MaxObject" and isinstance(node.value.args[0], ast.Constant)):
            continue
        # followed by its docstring
        doc = None
        if i + 1 < len(tree.body):
            after = tree.body[i + 1]
            if isinstance(after, ast.Expr) and isinstance(after.value, ast.Constant) \
                    and isinstance(after.value.value, str):
                doc = after.value.value
        stubs.append((node.targets[0].id, node.value.args[0].value, doc))

    return stubs


def build_pyi(package, xlet_types):
    """Text of objects/{package}.pyi, typing every stub in objects/{package}.py."""

    stubs = read_stub_module(package)
    types = xlet_types.get(package, {})

    lines = [
        f'"""Type stubs for maxpylang.objects.{package}. Generated by maxpylang.tools.typedstubs; do not edit."""',
        "",
        "from typing import Any",
        "",
        "from maxpylang.maxobject import MaxObject",
        "from maxpylang.rates import Control, Matrix, MCSignal, Signal",
        "from maxpylang.xlet import Inlet, Outlet",
        "",
        "__all__ = [",
    ]
    lines += [f"    {py_name!r}," for py_name, _, _ in sorted(stubs)]
    lines += ["]", "", "_NAMES: dict[str, str]", ""]

    for py_name, max_name, doc in sorted(stubs):
        obj_types = types.get(max_name, {"ins": None, "outs": None})
        cls = "_T_" + py_name
        lines.append(f"class {cls}(MaxObject):")
        if doc:
            lines.append('    """' + _escape_doc(doc) + '"""')
        lines.append("    @property")
        lines.append(f"    def ins(self) -> {_xlet_tuple('Inlet', _INLET, obj_types['ins'])}: ...")
        lines.append("    @property")
        lines.append(f"    def outs(self) -> {_xlet_tuple('Outlet', _OUTLET, obj_types['outs'])}: ...")
        lines.append(f"    def __call__(self, *args: Any, **attribs: Any) -> {cls}: ...")
        lines.append("")
        lines.append(f"{py_name}: {cls}")
        lines.append("")

    return "\n".join(lines)


def _xlet_tuple(kind, names, rates):
    if rates is None:
        return f"tuple[{kind}[Any], ...]"
    if isinstance(rates, str):
        return f"tuple[{kind}[{names[rates]}], ...]"
    if not rates:
        return "tuple[()]"
    return "tuple[" + ", ".join(f"{kind}[{names[r]}]" for r in rates) + "]"


def _escape_doc(doc):
    return doc.replace("\\", "\\\\").replace('"""', '\\"\\"\\"')


def build_init_pyi():
    """Text of objects/__init__.pyi."""

    lines = ['"""Type stubs for maxpylang.objects. Generated by maxpylang.tools.typedstubs; do not edit."""', ""]
    lines += [f"from .{package} import *" for package in PACKAGES]
    return "\n".join(lines) + "\n"


def write_stubs():
    xlet_types = load_xlet_types()
    for package in PACKAGES:
        (OBJECTS_DIR / f"{package}.pyi").write_text(build_pyi(package, xlet_types))
        print(f"\ttype stubs generated: objects/{package}.pyi")
    (OBJECTS_DIR / "__init__.pyi").write_text(build_init_pyi())


def main(argv=None):
    parser = argparse.ArgumentParser(description="Generate maxpylang/objects/*.pyi type stubs.")
    parser.add_argument("--refresh", metavar="SIGNATURES_JSON",
                        help="rebuild data/xlet_types.json from a signature table first")
    args = parser.parse_args(argv)

    if args.refresh:
        with open(args.refresh) as f:
            dump_xlet_types(build_xlet_types(json.load(f)))
        print(f"\txlet table written: {DATA_PATH}")

    write_stubs()


if __name__ == "__main__":
    main()
