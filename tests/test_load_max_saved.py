"""
Load patches saved by Max itself, not by maxpylang.

Max stores no "text" field for UI boxes (toggle, number, dial, ...), empty message
boxes, or inlet and outlet. maxpylang always writes one, so its own patches load,
but loading a patch saved by Max used to fail with KeyError: 'text'.
"""

import json
from pathlib import Path

import pytest

import maxpylang as mp

ROOT = Path(__file__).resolve().parents[1]

# maxpylang's template stamps every patch it writes with this Max version.
MAXPYLANG_APPVERSION = (8, 1, 11)


def saved_by_max(path):
    av = json.loads(path.read_text())["patcher"]["appversion"]
    return (av["major"], av["minor"], av["revision"]) != MAXPYLANG_APPVERSION


MAX_SAVED = sorted(
    p for p in (ROOT / "examples").rglob("*.maxpat")
    if "maxpy-generated" not in str(p) and saved_by_max(p)
)


def box(obj_id, maxclass, rect, numinlets, numoutlets, text=None):
    b = {"id": obj_id, "maxclass": maxclass, "numinlets": numinlets,
         "numoutlets": numoutlets, "patching_rect": rect}
    if numoutlets:
        b["outlettype"] = [""] * numoutlets
    if text is not None:
        b["text"] = text
    return {"box": b}


def test_boxes_without_text_load(tmp_path, monkeypatch):
    """A toggle, inlet and outlet as Max writes them: no "text" field."""
    template = mp.MaxPatch(verbose=False).dict
    template["patcher"]["boxes"] = [
        box("obj-1", "inlet", [30.0, 30.0, 30.0, 30.0], 0, 1),
        box("obj-2", "toggle", [30.0, 80.0, 24.0, 24.0], 1, 1),
        box("obj-3", "newobj", [30.0, 130.0, 50.0, 22.0], 2, 1, text="metro 500"),
        box("obj-4", "outlet", [30.0, 180.0, 30.0, 30.0], 1, 0),
    ]
    template["patcher"]["lines"] = [
        {"patchline": {"source": ["obj-1", 0], "destination": ["obj-2", 0]}},
        {"patchline": {"source": ["obj-2", 0], "destination": ["obj-3", 0]}},
        {"patchline": {"source": ["obj-3", 0], "destination": ["obj-4", 0]}},
    ]
    monkeypatch.chdir(tmp_path)
    Path("from_max.maxpat").write_text(json.dumps(template))

    patch = mp.MaxPatch(load_file="from_max.maxpat", verbose=False)

    assert sorted(o.name for o in patch.objs.values()) == ["inlet", "metro", "outlet", "toggle"]
    patch.save("resaved", verbose=False, check=False)
    assert len(json.loads(Path("resaved.maxpat").read_text())["patcher"]["lines"]) == 3


def test_examples_are_found():
    assert MAX_SAVED, "no Max-saved patches found under examples/"


@pytest.mark.parametrize("path", MAX_SAVED, ids=lambda p: str(p.relative_to(ROOT / "examples")))
def test_max_saved_example_loads(path, tmp_path, monkeypatch):
    """Every patch in examples/ that Max saved loads, and saves back with all its boxes and cords."""
    # Linked abstractions and js files are looked up in the current folder.
    monkeypatch.chdir(path.parent)
    source = json.loads(path.read_text())["patcher"]

    patch = mp.MaxPatch(load_file=path.name, verbose=False)
    out = tmp_path / "resaved.maxpat"
    patch.save(str(out), verbose=False, check=False)
    saved = json.loads(out.read_text())["patcher"]

    assert patch.num_objs == len(source["boxes"])
    assert len(saved["boxes"]) == len(source["boxes"])
    assert len(saved["lines"]) == len(source["lines"])
