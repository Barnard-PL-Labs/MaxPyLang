"""
Compile every reference example with real maxpylang, ahead of time.

    python docs-site/scripts/build_examples.py

Each example is a short maxpylang script at content/examples/<stub>/<n>.py, where <stub>
is the object's Python name in maxpylang.objects (cycle_tilde for cycle~). Its docstring's
first line is the example's title; the rest is a sentence or two shown under it.

The script runs each one the way the browser's Python worker does (web/src/compiler/
pyodide-worker.ts, __compile): MaxPatch.save is captured instead of writing a file. The
patch JSON is stored with the code, so the page can play an example at once, without
loading Python in the browser.

An example fails the build if it raises, places an object maxpylang does not know,
uses dac~ (silent in the browser; use ezdac~), or makes no patch.

It also builds a wheel of this repo's maxpylang into public/py/, which the browser's
Python installs when someone edits an example, and records its file name in
src/generated/wheel.json.

    python docs-site/scripts/build_examples.py --check FILE...   # compile only, write nothing

Writes src/generated/examples.json, plus two files the page uses for every entry:
  stubs.json  Max object name -> Python name in maxpylang.objects ("cycle~": "cycle_tilde")
  known.json  objects maxpylang can place, with the arguments it requires
"""

import ast
import io
import json
import re
import shutil
import subprocess
import sys
import warnings
from contextlib import redirect_stdout
from pathlib import Path

import maxpylang as mp
from maxpylang.exceptions import UnknownObjectWarning

HERE = Path(__file__).resolve().parent
SITE = HERE.parent
ROOT = SITE.parent
EXAMPLES = SITE / "content" / "examples"
OUT = SITE / "src" / "generated"

STUB_LINE = re.compile(r"^(\w+) = MaxObject\('(.+)'\)$", re.M)


def aliases():
    """maxpylang's alias table: '*~' -> 'times~', 't' -> 'trigger', ... (as reffile.check_aliases)."""
    return json.loads((ROOT / "maxpylang" / "data" / "OBJ_INFO" / "obj_aliases.json").read_text())


def stub_names():
    """Max object name -> Python name, read from maxpylang/objects/{max,msp,jit}.py.

    An alias gets its target's stub: '*~' -> times_tilde, which places times~, the same
    object as *~.
    """
    names = {}
    for pkg in ("max", "msp", "jit"):
        for py, max_name in STUB_LINE.findall((ROOT / "maxpylang" / "objects" / f"{pkg}.py").read_text()):
            names.setdefault(max_name, py)
    for alias, target in aliases().items():
        if target in names:
            names.setdefault(alias, names[target])
    return names


STUB_DIGEST = re.compile(r'^class _T_\w+\(MaxObject\):\n    """\n(\S+) - (.+)$', re.M)


def digests():
    """One-line summaries for every object, from the stubs' docstrings (maxpylang/objects/*.pyi).

    web/src/generated/objdocs.json has fuller docs, but misses some objects (abs, whose stub
    is abs_); the page falls back to these.
    """
    out = {}
    for pkg in ("max", "msp", "jit"):
        for name, digest in STUB_DIGEST.findall((ROOT / "maxpylang" / "objects" / f"{pkg}.pyi").read_text()):
            out.setdefault(name, digest.strip())
    return out


def known_objects():
    """Objects maxpylang has data for, with their required arguments."""
    known = {}
    for path in sorted((ROOT / "maxpylang" / "data" / "OBJ_INFO").glob("*/*.json")):
        info = json.loads(path.read_text())
        args = info.get("args", {})
        if isinstance(args, str):  # most files store this as a Python-literal string
            args = ast.literal_eval(args)
        required = [a.get("name") for a in args.get("required", []) if isinstance(a, dict)]
        known[path.stem] = {"required": required}
    for alias, target in aliases().items():
        if target in known:
            known.setdefault(alias, {**known[target], "aliasOf": target})
    return known


def compile_example(source):
    """Run a script and return the patch it saves, as the browser worker does."""
    captured = {}
    original = mp.MaxPatch.save

    def _save(self, *args, **kwargs):
        captured["json"] = self.get_json()

    mp.MaxPatch.save = _save
    namespace = {}
    try:
        with warnings.catch_warnings(record=True) as caught, redirect_stdout(io.StringIO()):
            warnings.simplefilter("always")
            exec(compile(source, "<example>", "exec"), namespace)
    finally:
        mp.MaxPatch.save = original
    unknown = [str(w.message) for w in caught if issubclass(w.category, UnknownObjectWarning)]
    return captured.get("json"), unknown


def box_names(patch):
    out = []
    for b in patch["patcher"]["boxes"]:
        box = b["box"]
        if box.get("maxclass") == "newobj":
            out.append(box.get("text", "").split(" ")[0])
        else:
            out.append(box.get("maxclass"))
    return out


def split_docstring(source):
    """(docstring, code after it); the page shows the code and the docstring separately."""
    m = re.match(r'\s*"""(.*?)"""\n*', source, re.S)
    return (m.group(1), source[m.end():]) if m else ("", source)


def parse_docstring(source):
    m = re.match(r'\s*"""(.*?)"""', source, re.S)
    if not m:
        return "", ""
    lines = m.group(1).strip().splitlines()
    return lines[0].strip(), " ".join(line.strip() for line in lines[1:]).strip()


def build_wheel():
    """A wheel of this checkout's maxpylang, for Python in the browser."""
    dest = SITE / "public" / "py"
    shutil.rmtree(dest, ignore_errors=True)
    dest.mkdir(parents=True)
    subprocess.run([sys.executable, "-m", "pip", "wheel", str(ROOT), "--no-deps", "--quiet",
                    "--wheel-dir", str(dest)], check=True)
    (wheel,) = dest.glob("maxpylang-*.whl")
    return wheel.name


def main():
    stubs = stub_names()
    by_stub = {}
    for name, py in stubs.items():  # the object's own name, not an alias
        if name not in aliases():
            by_stub.setdefault(py, name)
    # An example folder is named by stub (times_tilde); list it under the name the
    # reference uses (*~) when that is an alias of the stub's object.
    listed = {o for c in json.loads((SITE / "content" / "categories.json").read_text())["categories"] for o in c["objects"]}
    shown_as = {target: alias for alias, target in aliases().items() if alias in listed and target not in listed}
    examples, errors = [], []

    check = "--check" in sys.argv
    paths = ([Path(a).resolve() for a in sys.argv[sys.argv.index("--check") + 1:]] if check
             else sorted(EXAMPLES.glob("*/*.py")))
    for path in paths:
        stub = path.parent.name
        obj = by_stub.get(stub)
        obj = shown_as.get(obj, obj)
        rel = path.relative_to(SITE)
        if obj is None:
            errors.append(f"{rel}: folder '{stub}' is not a name in maxpylang.objects")
            continue
        source = path.read_text()
        title, note = parse_docstring(source)
        try:
            patch, unknown = compile_example(source)
        except Exception as exc:  # report every failing example, not just the first
            errors.append(f"{rel}: {type(exc).__name__}: {exc}")
            continue
        if patch is None:
            errors.append(f"{rel}: makes no patch (call patch.save())")
            continue
        names = box_names(patch)
        if unknown:
            errors.append(f"{rel}: unknown objects: {'; '.join(unknown)}")
        if "dac~" in names:
            errors.append(f"{rel}: uses dac~, which is silent in the browser; use ezdac~")
        # Every example has an output: speakers (ezdac~, mc.ezdac~, playlist~), or for a
        # video example, a picture (jit.pwindow / jit.window).
        outputs = {"ezdac~", "mc.ezdac~", "playlist~", "jit.pwindow", "jit.window"}
        if not outputs & set(names):
            errors.append(f"{rel}: has no output (ezdac~, or jit.pwindow for video), so nothing happens")
        if not title:
            errors.append(f"{rel}: needs a docstring whose first line is the example's title")
        examples.append({
            "object": obj, "stub": stub, "index": int(path.stem), "file": str(rel),
            "title": title, "note": note, "code": split_docstring(source)[1],
            "objects": sorted(set(names)), "patch": patch,
        })

    if errors:
        print(f"{len(errors)} problem(s):", file=sys.stderr)
        for e in errors:
            print("  " + e, file=sys.stderr)
        sys.exit(1)
    if check:
        for e in examples:
            print(f"ok  {e['file']}  ->  {e['object']}: {e['title']}  [{', '.join(e['objects'])}]")
        return

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "examples.json").write_text(json.dumps(examples, indent=1))
    (OUT / "stubs.json").write_text(json.dumps(stubs, indent=1, sort_keys=True))
    (OUT / "known.json").write_text(json.dumps(known_objects(), indent=1, sort_keys=True))
    (OUT / "digests.json").write_text(json.dumps(digests(), indent=1, sort_keys=True))
    # playlist~ in the browser fetches its sounds from <site>/samples/ (web's drum kit).
    samples = SITE / "public" / "samples"
    shutil.rmtree(samples, ignore_errors=True)
    shutil.copytree(ROOT / "web" / "public" / "samples", samples)
    if "--no-wheel" not in sys.argv:
        (OUT / "wheel.json").write_text(json.dumps({"file": build_wheel()}))
    print(f"{len(examples)} examples for {len({e['object'] for e in examples})} objects -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
