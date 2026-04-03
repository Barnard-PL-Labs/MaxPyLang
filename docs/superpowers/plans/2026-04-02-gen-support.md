# Gen Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add comprehensive Gen operator support to MaxPyLang — catalog of all 243 gen operators, gen patcher infrastructure via `MaxPatch(gen_type=...)`, and embedding gen patchers inside gen~ objects.

**Architecture:** Extract gen operators from local Max reference files and online Cycling '74 docs. Generate `gen.py` stubs and `OBJ_INFO/gen/` metadata following the existing `importobjs.py` pattern. Extend `MaxPatch` with a `gen_type` parameter that sets `classnamespace` on the patcher dict, and extend `place()` with a `gen_patcher` parameter that embeds a gen patcher's JSON into the placed object's box dict.

**Tech Stack:** Python 3.9+, pytest, json, re (for parsing Cycling '74 JSX content)

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `maxpylang/data/PATCH_TEMPLATES/gen_template.json` | Create | Simplified patcher template for gen sub-patchers |
| `maxpylang/tools/gen_scraper.py` | Create | Script to extract gen operators from local Max files and online docs |
| `maxpylang/data/OBJ_INFO/gen/` | Create (dir + files) | Metadata JSONs for each gen operator |
| `maxpylang/objects/gen.py` | Create | Auto-generated stubs for all gen operators |
| `maxpylang/objects/__init__.py` | Modify | Add gen import |
| `maxpylang/maxpatch.py` | Modify | Add `gen_type` parameter to `__init__` |
| `maxpylang/tools/patchfuncs/instantiation.py` | Modify | Handle `gen_type` in `load_template` |
| `maxpylang/tools/patchfuncs/placing.py` | Modify | Add `gen_patcher` parameter to `place()` and `place_obj()` |
| `maxpylang/tools/patchfuncs/saving.py` | Modify | Handle gen patcher embedding in `get_json()` |
| `docs/gen_operator_comparison.md` | Create | Report of local vs. online operator coverage |
| `tests/test_gen.py` | Create | Tests for gen patcher infrastructure |

---

### Task 1: Create Gen Patcher Template

**Files:**
- Create: `maxpylang/data/PATCH_TEMPLATES/gen_template.json`

- [ ] **Step 1: Create the gen patcher template file**

This is a minimal patcher dict matching the structure seen in real gen~ objects (e.g., `ex1_passthrough.maxpat`). It uses `classnamespace: "dsp.gen"` as default — the actual classnamespace gets overridden by the `gen_type` parameter at runtime.

```json
{
  "patcher": {
    "fileversion": 1,
    "appversion": {
      "major": 8,
      "minor": 1,
      "revision": 11,
      "architecture": "x64",
      "modernui": 1
    },
    "classnamespace": "dsp.gen",
    "rect": [0.0, 0.0, 600.0, 450.0],
    "bglocked": 0,
    "openinpresentation": 0,
    "default_fontsize": 12.0,
    "default_fontface": 0,
    "default_fontname": "Arial",
    "gridonopen": 1,
    "gridsize": [15.0, 15.0],
    "gridsnaponopen": 1,
    "objectsnaponopen": 1,
    "statusbarvisible": 2,
    "toolbarvisible": 1,
    "lefttoolbarpinned": 0,
    "toptoolbarpinned": 0,
    "righttoolbarpinned": 0,
    "bottomtoolbarpinned": 0,
    "toolbars_unpinned_last_save": 0,
    "tallnewobj": 0,
    "boxanimatetime": 200,
    "enablehscroll": 1,
    "enablevscroll": 1,
    "devicewidth": 0.0,
    "description": "",
    "digest": "",
    "tags": "",
    "style": "",
    "subpatcher_template": "",
    "assistshowspatchername": 0,
    "boxes": [],
    "lines": []
  }
}
```

- [ ] **Step 2: Verify the template file is valid JSON**

Run: `python3 -c "import json; json.load(open('maxpylang/data/PATCH_TEMPLATES/gen_template.json')); print('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add maxpylang/data/PATCH_TEMPLATES/gen_template.json
git commit -m "feat: add gen patcher template for gen sub-patchers"
```

---

### Task 2: Add `gen_type` Parameter to MaxPatch

**Files:**
- Modify: `maxpylang/maxpatch.py:36-60`
- Modify: `maxpylang/tools/patchfuncs/instantiation.py:22-46`
- Test: `tests/test_gen.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_gen.py`:

```python
"""Tests for Gen patcher support in MaxPyLang."""

import os
import sys
import json
import tempfile

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import maxpylang as mp


class TestGenPatcherCreation:
    """Test creating gen patchers with gen_type parameter."""

    def test_gen_type_dsp_gen(self):
        """MaxPatch with gen_type='dsp.gen' should have correct classnamespace."""
        gen_patch = mp.MaxPatch(gen_type="dsp.gen", verbose=False)
        json_dict = gen_patch.get_json()
        assert json_dict["patcher"]["classnamespace"] == "dsp.gen"

    def test_gen_type_jit_gen(self):
        """MaxPatch with gen_type='jit.gen' should have correct classnamespace."""
        gen_patch = mp.MaxPatch(gen_type="jit.gen", verbose=False)
        json_dict = gen_patch.get_json()
        assert json_dict["patcher"]["classnamespace"] == "jit.gen"

    def test_gen_type_jit_pix(self):
        """MaxPatch with gen_type='jit.pix' should have correct classnamespace."""
        gen_patch = mp.MaxPatch(gen_type="jit.pix", verbose=False)
        json_dict = gen_patch.get_json()
        assert json_dict["patcher"]["classnamespace"] == "jit.pix"

    def test_gen_type_jit_gl_pix(self):
        """MaxPatch with gen_type='jit.gl.pix' should have correct classnamespace."""
        gen_patch = mp.MaxPatch(gen_type="jit.gl.pix", verbose=False)
        json_dict = gen_patch.get_json()
        assert json_dict["patcher"]["classnamespace"] == "jit.gl.pix"

    def test_default_patch_has_box_classnamespace(self):
        """Normal MaxPatch (no gen_type) should still use 'box' classnamespace."""
        patch = mp.MaxPatch(verbose=False)
        json_dict = patch.get_json()
        assert json_dict["patcher"]["classnamespace"] == "box"

    def test_gen_patch_can_place_objects(self):
        """Gen patcher should support place() just like a normal patch."""
        gen_patch = mp.MaxPatch(gen_type="dsp.gen", verbose=False)
        inp = gen_patch.place("in 1", verbose=False)[0]
        outp = gen_patch.place("out 1", verbose=False)[0]
        assert gen_patch.num_objs == 2

    def test_gen_patch_can_connect_objects(self):
        """Gen patcher should support connect() just like a normal patch."""
        gen_patch = mp.MaxPatch(gen_type="dsp.gen", verbose=False)
        inp = gen_patch.place("in 1", verbose=False)[0]
        outp = gen_patch.place("out 1", verbose=False)[0]
        gen_patch.connect([inp.outs[0], outp.ins[0]], verbose=False)
        assert len(outp.ins[0].sources) == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/katie/MaxPyLang && python3 -m pytest tests/test_gen.py::TestGenPatcherCreation -v`
Expected: FAIL — `MaxPatch.__init__() got an unexpected keyword argument 'gen_type'`

- [ ] **Step 3: Modify MaxPatch.__init__ to accept gen_type**

In `maxpylang/maxpatch.py`, change the constructor signature and body:

```python
def __init__(self, template=None, load_file=None, reorder=True, verbose=True, gen_type=None):
    """
    Constructor method.
    """

    # instance variables:
    self._objs = {}  #: objects in patch, referenced as "obj-num": object
    self._num_objs = 0  #: number of objects in the patch
    self._patcher_dict = {}  #: the patch's JSON data
    self._curr_position = [0.0, 0.0]  #: 'cursor' position at which to place objects
    self._filename = "default.maxpat"  #: the file where the patch is saved
    self._gen_type = gen_type  #: gen classnamespace, e.g. "dsp.gen", "jit.gen"

    # load existing maxpatch
    if load_file:
        self.load_file(load_file, reorder=reorder, verbose=verbose)

    # or, make copy from template
    else:
        if gen_type is not None:
            if template is None:
                template = os.path.join(
                    self.patch_templates_path, "gen_template.json"
                )
            self.load_template(template, verbose=verbose)
            self._patcher_dict["patcher"]["classnamespace"] = gen_type
        else:
            if template is None:
                template = os.path.join(
                    self.patch_templates_path, "empty_template.json"
                )
            self.load_template(template, verbose=verbose)

    return
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/katie/MaxPyLang && python3 -m pytest tests/test_gen.py::TestGenPatcherCreation -v`
Expected: All 7 tests PASS

- [ ] **Step 5: Run existing tests to confirm no regressions**

Run: `cd /Users/katie/MaxPyLang && python3 -m pytest tests/ -v`
Expected: All existing tests still pass

- [ ] **Step 6: Commit**

```bash
git add maxpylang/maxpatch.py tests/test_gen.py
git commit -m "feat: add gen_type parameter to MaxPatch for gen sub-patchers"
```

---

### Task 3: Add `gen_patcher` Parameter to `place()`

**Files:**
- Modify: `maxpylang/tools/patchfuncs/placing.py:26-37` (place signature)
- Modify: `maxpylang/tools/patchfuncs/placing.py:345-379` (place_obj)
- Test: `tests/test_gen.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/test_gen.py`:

```python
class TestGenPatcherEmbedding:
    """Test embedding gen patchers inside gen~ objects."""

    def test_place_gen_tilde_with_gen_patcher(self):
        """Placing gen~ with gen_patcher should embed the patcher dict."""
        gen_patch = mp.MaxPatch(gen_type="dsp.gen", verbose=False)
        inp = gen_patch.place("in 1", verbose=False)[0]
        outp = gen_patch.place("out 1", verbose=False)[0]
        gen_patch.connect([inp.outs[0], outp.ins[0]], verbose=False)

        patch = mp.MaxPatch(verbose=False)
        gen_obj = patch.place("gen~", gen_patcher=gen_patch, verbose=False)[0]

        assert "patcher" in gen_obj._dict["box"]
        assert gen_obj._dict["box"]["patcher"]["classnamespace"] == "dsp.gen"

    def test_embedded_gen_patcher_has_boxes(self):
        """Embedded gen patcher should contain the placed objects."""
        gen_patch = mp.MaxPatch(gen_type="dsp.gen", verbose=False)
        gen_patch.place("in 1", verbose=False)
        gen_patch.place("out 1", verbose=False)

        patch = mp.MaxPatch(verbose=False)
        gen_obj = patch.place("gen~", gen_patcher=gen_patch, verbose=False)[0]

        boxes = gen_obj._dict["box"]["patcher"]["boxes"]
        texts = [b["box"]["text"] for b in boxes]
        assert "in 1" in texts
        assert "out 1" in texts

    def test_embedded_gen_patcher_has_lines(self):
        """Embedded gen patcher should contain patchcord connections."""
        gen_patch = mp.MaxPatch(gen_type="dsp.gen", verbose=False)
        inp = gen_patch.place("in 1", verbose=False)[0]
        outp = gen_patch.place("out 1", verbose=False)[0]
        gen_patch.connect([inp.outs[0], outp.ins[0]], verbose=False)

        patch = mp.MaxPatch(verbose=False)
        gen_obj = patch.place("gen~", gen_patcher=gen_patch, verbose=False)[0]

        lines = gen_obj._dict["box"]["patcher"]["lines"]
        assert len(lines) == 1

    def test_save_patch_with_embedded_gen(self, tmp_path):
        """Patch with embedded gen~ should save and reload correctly."""
        gen_patch = mp.MaxPatch(gen_type="dsp.gen", verbose=False)
        inp = gen_patch.place("in 1", verbose=False)[0]
        outp = gen_patch.place("out 1", verbose=False)[0]
        gen_patch.connect([inp.outs[0], outp.ins[0]], verbose=False)

        patch = mp.MaxPatch(verbose=False)
        gen_obj = patch.place("gen~", gen_patcher=gen_patch, verbose=False)[0]
        dac = patch.place("ezdac~", verbose=False)[0]
        patch.connect([gen_obj.outs[0], dac.ins[0]], verbose=False)

        filepath = str(tmp_path / "test_gen_embed.maxpat")
        patch.save(filepath, verbose=False, check=False)

        # Verify file exists and contains gen patcher
        assert os.path.exists(filepath)
        with open(filepath, "r") as f:
            saved = json.load(f)

        # Find the gen~ box
        gen_boxes = [b for b in saved["patcher"]["boxes"]
                     if b["box"].get("text", "") == "gen~"]
        assert len(gen_boxes) == 1
        assert gen_boxes[0]["box"]["patcher"]["classnamespace"] == "dsp.gen"

    def test_place_without_gen_patcher_unchanged(self):
        """Normal place() without gen_patcher should work as before."""
        patch = mp.MaxPatch(verbose=False)
        osc = patch.place("cycle~ 440", verbose=False)[0]
        assert "patcher" not in osc._dict["box"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/katie/MaxPyLang && python3 -m pytest tests/test_gen.py::TestGenPatcherEmbedding -v`
Expected: FAIL — `place() got an unexpected keyword argument 'gen_patcher'`

- [ ] **Step 3: Add gen_patcher parameter to place() and place_obj()**

In `maxpylang/tools/patchfuncs/placing.py`, update the `place()` signature (line 26):

```python
def place(
    self,
    *objs,
    randpick=False,
    num_objs=1,
    seed=None,
    weights=None,
    spacing_type="grid",
    spacing=[80.0, 80.0],
    starting_pos=None,
    verbose=False,
    gen_patcher=None,
) -> list[MaxObject]:
```

Then update the grid/custom/random/vertical placement calls to pass `gen_patcher` through. In each of `place_grid`, `place_random`, `place_custom`, `place_vertical`, add `gen_patcher=None` parameter and pass it to `place_obj`:

For `place_grid` (line 234), change the signature and the `place_obj` call:

```python
def place_grid(self, objs, spacing, verbose=False, gen_patcher=None):
```

And inside, change the `place_obj` call (line 263):

```python
placedObj = self.place_obj(obj, position=[curr_x, curr_y], verbose=verbose, gen_patcher=gen_patcher)
```

Apply the same pattern to `place_random` (line 272), `place_custom` (line 297), and `place_vertical` (line 319):

```python
def place_random(self, objs, seed, verbose=False, gen_patcher=None):
    # ... existing code ...
    placedObj = self.place_obj(obj, position=position, verbose=verbose, gen_patcher=gen_patcher)

def place_custom(self, objs, positions, verbose=False, gen_patcher=None):
    # ... existing code ...
    placedObj = self.place_obj(obj, position=pos, verbose=verbose, gen_patcher=gen_patcher)

def place_vertical(self, objs, spacing, verbose=False, gen_patcher=None):
    # ... existing code ...
    placedObj = self.place_obj(obj, position=[x, y], verbose=verbose, gen_patcher=gen_patcher)
```

In `place()` itself, pass `gen_patcher` to each spacing function call (lines 85-92):

```python
if spacing_type == "grid":
    placed_objs = self.place_grid(picked_objs, spacing, verbose=verbose, gen_patcher=gen_patcher)
elif spacing_type == "custom":
    placed_objs = self.place_custom(picked_objs, spacing, verbose=verbose, gen_patcher=gen_patcher)
elif spacing_type == "random":
    if seed is None:
        seed = random.randrange(2 ** 32 - 1)
    placed_objs = self.place_random(picked_objs, seed, verbose=verbose, gen_patcher=gen_patcher)
elif spacing_type == "vertical":
    placed_objs = self.place_vertical(picked_objs, spacing, verbose=verbose, gen_patcher=gen_patcher)
```

Update `place_obj` (line 345) to accept and use `gen_patcher`:

```python
def place_obj(self, obj, position=[0.0, 0.0], verbose=False, replace_id=None, gen_patcher=None):
    """
    Helper function for placing.
    If obj denoted by string, creates obj; otherwise, adds existing object to patcher at specified position.

    obj --> object to be placed (str or MaxObject)
    position --> patcher position
    verbose --> debug commands
    replace_id --> 'obj-num' string of object being replaced
    gen_patcher --> MaxPatch with gen_type set, to embed as sub-patcher
    """

    # get object from specification
    obj = self.get_obj_from_spec(obj)

    if replace_id == None:  # for just adding (not replacing)...
        self._num_objs += 1  # increment patch number of objects
        obj._dict["box"]["id"] = "obj-" + str(
            self._num_objs
        )  # change obj id to number of patch objects
    else:
        obj._dict["box"]["id"] = replace_id  # change obj id to replacement id

    obj._dict["box"]["patching_rect"][0:2] = position  # change position

    # embed gen patcher if provided
    if gen_patcher is not None:
        obj._dict["box"]["patcher"] = gen_patcher.get_json()["patcher"]

    # add to various dictionaries of patch objects by obj-id
    obj_id = obj._dict["box"]["id"]
    self._objs[obj_id] = obj

    if verbose:
        print("Patcher:", obj.name, end="")
        if obj.notknown():
            print(" (unknown)", end="")
        print(" added, total objects", self._num_objs)  # log

    return obj
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/katie/MaxPyLang && python3 -m pytest tests/test_gen.py::TestGenPatcherEmbedding -v`
Expected: All 5 tests PASS

- [ ] **Step 5: Run all tests to confirm no regressions**

Run: `cd /Users/katie/MaxPyLang && python3 -m pytest tests/ -v`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add maxpylang/tools/patchfuncs/placing.py tests/test_gen.py
git commit -m "feat: add gen_patcher parameter to place() for embedding gen sub-patchers"
```

---

### Task 4: Extract Gen Operators from Local Max Files

**Files:**
- Create: `maxpylang/tools/gen_scraper.py`
- Test: `tests/test_gen.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/test_gen.py`:

```python
class TestGenScraper:
    """Test gen operator extraction from local Max files."""

    def test_extract_common_operators(self):
        """Should extract common gen operators from local file."""
        from maxpylang.tools.gen_scraper import extract_local_gen_operators
        result = extract_local_gen_operators()
        assert "common" in result
        assert len(result["common"]) > 100  # we know there are 150

    def test_extract_gen_tilde_operators(self):
        """Should extract gen~ specific operators from local file."""
        from maxpylang.tools.gen_scraper import extract_local_gen_operators
        result = extract_local_gen_operators()
        assert "gen_tilde" in result
        assert len(result["gen_tilde"]) > 50  # we know there are 63

    def test_extract_jitter_operators(self):
        """Should extract jitter gen operators from local file."""
        from maxpylang.tools.gen_scraper import extract_local_gen_operators
        result = extract_local_gen_operators()
        assert "jitter" in result
        assert len(result["jitter"]) > 20  # we know there are 30

    def test_operators_have_names(self):
        """Each operator should have at least a name."""
        from maxpylang.tools.gen_scraper import extract_local_gen_operators
        result = extract_local_gen_operators()
        for category, ops in result.items():
            for op in ops:
                assert "name" in op, f"Operator missing name in {category}"
                assert len(op["name"]) > 0

    def test_operators_have_categories(self):
        """Each operator should have a category."""
        from maxpylang.tools.gen_scraper import extract_local_gen_operators
        result = extract_local_gen_operators()
        for group, ops in result.items():
            for op in ops:
                assert "category" in op, f"Operator {op['name']} missing category in {group}"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/katie/MaxPyLang && python3 -m pytest tests/test_gen.py::TestGenScraper -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'maxpylang.tools.gen_scraper'`

- [ ] **Step 3: Implement the local gen operator extractor**

Create `maxpylang/tools/gen_scraper.py`:

```python
"""
tools.gen_scraper

Extract gen operator information from local Max reference files
and online Cycling '74 documentation.

Local source: /Applications/Max.app/Contents/Resources/C74/docs/userguide/content/gen/
Files:
  - gen_common_operators.json  (operators common to all gen types)
  - gen~_operators.json        (gen~ / audio-rate specific)
  - gen_jitter_operators.json  (jit.gen / jit.pix / jit.gl.pix specific)
"""

import json
import os
import re

from .constants import get_constant


# Default path to local gen docs inside Max.app
_DEFAULT_GEN_DOCS_PATH = "/Applications/Max.app/Contents/Resources/C74/docs/userguide/content/gen/"

# Map of local filenames to our category keys
_LOCAL_FILES = {
    "gen_common_operators.json": "common",
    "gen~_operators.json": "gen_tilde",
    "gen_jitter_operators.json": "jitter",
}


def _get_gen_docs_path():
    """Return path to gen docs directory, derived from Max refpath constant."""
    try:
        max_refpath = get_constant("max_refpath")
        # max_refpath is like /Applications/Max.app/Contents/Resources/C74/docs/refpages/
        # gen docs are at .../C74/docs/userguide/content/gen/
        c74_path = max_refpath.split("/docs/refpages")[0]
        gen_path = os.path.join(c74_path, "docs", "userguide", "content", "gen")
        if os.path.exists(gen_path):
            return gen_path
    except Exception:
        pass

    # Fallback to default
    if os.path.exists(_DEFAULT_GEN_DOCS_PATH):
        return _DEFAULT_GEN_DOCS_PATH

    return None


def _parse_operators_from_jsx(content, headings):
    """
    Parse gen operator names, descriptions, and categories from the JSX content string.

    The content contains JSX like:
        className: "c74-object-link",
            children: "operatorName"

    Followed by description text. Headings (h2) define categories.

    Returns list of dicts: [{"name": str, "description": str, "category": str, "aliases": list}, ...]
    """
    operators = []

    # Extract h2 headings and their positions to determine categories
    h2_pattern = r'_jsx\(_components\.h2,\s*\{\s*id:\s*"([^"]*)",\s*\n\s*children:\s*"([^"]*)"'
    h2_matches = list(re.finditer(h2_pattern, content))

    # Build category ranges: [(start_pos, end_pos, category_name), ...]
    category_ranges = []
    for i, match in enumerate(h2_matches):
        start = match.start()
        end = h2_matches[i + 1].start() if i + 1 < len(h2_matches) else len(content)
        category_name = match.group(2)
        # Skip "See Also" sections
        if category_name.lower() not in ("see also",):
            category_ranges.append((start, end, category_name))

    # Extract operators within each category
    op_pattern = r'c74-object-link",\s*\n\s*children:\s*"([^"]+)"'

    for cat_start, cat_end, category in category_ranges:
        section = content[cat_start:cat_end]

        # Find list items — each <li> can have multiple object-link names (aliases)
        # and a description after the colon
        li_pattern = r'_jsxs?\(_components\.li,\s*\{[^}]*children:\s*\[([^\]]*(?:\[[^\]]*\])*[^\]]*)\]'

        # Simpler approach: find all operator names and descriptions per category
        # Each operator entry looks like: "opname", ... "alias" : description text
        op_matches = list(re.finditer(op_pattern, section))

        # Group operators by their list item context
        # For now, extract all unique names in this category
        seen_in_category = set()
        for op_match in op_matches:
            name = op_match.group(1)
            if name not in seen_in_category:
                seen_in_category.add(name)
                operators.append({
                    "name": name,
                    "category": category,
                })

    return operators


def extract_local_gen_operators(gen_docs_path=None):
    """
    Extract all gen operators from local Max installation files.

    Returns dict with keys 'common', 'gen_tilde', 'jitter',
    each containing a list of operator dicts with 'name' and 'category'.
    """
    if gen_docs_path is None:
        gen_docs_path = _get_gen_docs_path()

    if gen_docs_path is None:
        raise FileNotFoundError(
            "Could not find local Gen documentation. "
            "Is Max installed at /Applications/Max.app?"
        )

    result = {}

    for filename, key in _LOCAL_FILES.items():
        filepath = os.path.join(gen_docs_path, filename)
        if not os.path.exists(filepath):
            result[key] = []
            continue

        with open(filepath, "rb") as f:
            data = json.loads(f.read())

        content = data.get("content", "")
        headings = data.get("headings", [])

        if not content:
            result[key] = []
            continue

        operators = _parse_operators_from_jsx(content, headings)
        result[key] = operators

    return result


def get_all_gen_operator_names(gen_docs_path=None):
    """
    Return a flat deduplicated list of all gen operator names from local files.
    """
    result = extract_local_gen_operators(gen_docs_path)
    names = set()
    for ops in result.values():
        for op in ops:
            names.add(op["name"])
    return sorted(names)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/katie/MaxPyLang && python3 -m pytest tests/test_gen.py::TestGenScraper -v`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add maxpylang/tools/gen_scraper.py tests/test_gen.py
git commit -m "feat: add gen operator extraction from local Max reference files"
```

---

### Task 5: Scrape Cycling '74 Online Docs and Generate Comparison Report

**Files:**
- Modify: `maxpylang/tools/gen_scraper.py`
- Create: `docs/gen_operator_comparison.md`
- Test: `tests/test_gen.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/test_gen.py`:

```python
class TestGenComparison:
    """Test comparison between local and online gen operator catalogs."""

    def test_generate_comparison_report(self):
        """Should produce a comparison dict with expected keys."""
        from maxpylang.tools.gen_scraper import compare_local_vs_online
        report = compare_local_vs_online()
        assert "local_only" in report
        assert "online_only" in report
        assert "both" in report
        assert "local_total" in report
        assert "online_total" in report
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/katie/MaxPyLang && python3 -m pytest tests/test_gen.py::TestGenComparison -v`
Expected: FAIL — `ImportError: cannot import name 'compare_local_vs_online'`

- [ ] **Step 3: Add online scraping and comparison to gen_scraper.py**

Add these functions to `maxpylang/tools/gen_scraper.py`:

```python
import urllib.request


_CYCLING74_GEN_URLS = {
    "common": "https://docs.cycling74.com/userguide/gen/gen_common_operators",
    "gen_tilde": "https://docs.cycling74.com/userguide/gen/gen~_operators",
    "jitter": "https://docs.cycling74.com/userguide/gen/gen_jitter_operators",
}


def extract_online_gen_operators():
    """
    Scrape gen operator names from Cycling '74 online documentation.

    Returns dict with keys 'common', 'gen_tilde', 'jitter',
    each containing a list of operator name strings.

    Falls back to empty lists if URLs are unreachable.
    """
    result = {}

    for key, url in _CYCLING74_GEN_URLS.items():
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "MaxPyLang/1.0"})
            with urllib.request.urlopen(req, timeout=15) as resp:
                html = resp.read().decode("utf-8", errors="replace")

            # Extract operator names from HTML links with class containing "object-link"
            # Pattern: <a ...class="...object-link..."...>operatorName</a>
            names = re.findall(r'class="[^"]*object-link[^"]*"[^>]*>([^<]+)<', html)
            seen = set()
            unique = []
            for name in names:
                name = name.strip()
                if name and name not in seen:
                    seen.add(name)
                    unique.append(name)
            result[key] = unique
        except Exception:
            result[key] = []

    return result


def compare_local_vs_online(gen_docs_path=None):
    """
    Compare local and online gen operator catalogs.

    Returns dict with:
      - local_only: operators only found locally
      - online_only: operators only found online
      - both: operators found in both
      - local_total: total local operator count
      - online_total: total online operator count
    """
    local = extract_local_gen_operators(gen_docs_path)
    online = extract_online_gen_operators()

    local_names = set()
    for ops in local.values():
        for op in ops:
            local_names.add(op["name"])

    online_names = set()
    for ops in online.values():
        for name in ops:
            online_names.add(name)

    return {
        "local_only": sorted(local_names - online_names),
        "online_only": sorted(online_names - local_names),
        "both": sorted(local_names & online_names),
        "local_total": len(local_names),
        "online_total": len(online_names),
    }


def generate_comparison_report(gen_docs_path=None, output_path=None):
    """
    Generate a markdown comparison report and write it to output_path.
    """
    report = compare_local_vs_online(gen_docs_path)

    lines = [
        "# Gen Operator Comparison: Local vs. Cycling '74 Online Docs",
        "",
        f"**Local operators:** {report['local_total']}",
        f"**Online operators:** {report['online_total']}",
        f"**In both:** {len(report['both'])}",
        f"**Local only:** {len(report['local_only'])}",
        f"**Online only:** {len(report['online_only'])}",
        "",
    ]

    if report["local_only"]:
        lines.append("## Operators Found Only in Local Installation")
        lines.append("")
        for name in report["local_only"]:
            lines.append(f"- `{name}`")
        lines.append("")

    if report["online_only"]:
        lines.append("## Operators Found Only in Online Docs")
        lines.append("")
        for name in report["online_only"]:
            lines.append(f"- `{name}`")
        lines.append("")

    if report["both"]:
        lines.append("## Operators Found in Both Sources")
        lines.append("")
        for name in report["both"]:
            lines.append(f"- `{name}`")
        lines.append("")

    content = "\n".join(lines)

    if output_path:
        with open(output_path, "w") as f:
            f.write(content)

    return content
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/katie/MaxPyLang && python3 -m pytest tests/test_gen.py::TestGenComparison -v`
Expected: PASS

- [ ] **Step 5: Generate the comparison report**

Run: `cd /Users/katie/MaxPyLang && python3 -c "from maxpylang.tools.gen_scraper import generate_comparison_report; generate_comparison_report(output_path='docs/gen_operator_comparison.md'); print('Report generated')"`
Expected: `Report generated` and file created at `docs/gen_operator_comparison.md`

- [ ] **Step 6: Commit**

```bash
git add maxpylang/tools/gen_scraper.py docs/gen_operator_comparison.md tests/test_gen.py
git commit -m "feat: add online gen operator scraping and comparison report"
```

---

### Task 6: Generate Gen OBJ_INFO Metadata

**Files:**
- Modify: `maxpylang/tools/gen_scraper.py`
- Create: `maxpylang/data/OBJ_INFO/gen/` (directory + JSON files)
- Test: `tests/test_gen.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/test_gen.py`:

```python
class TestGenObjInfo:
    """Test gen operator OBJ_INFO metadata generation."""

    def test_generate_gen_obj_info(self, tmp_path):
        """Should create JSON files for gen operators."""
        from maxpylang.tools.gen_scraper import generate_gen_obj_info
        generate_gen_obj_info(output_dir=str(tmp_path))

        json_files = [f for f in os.listdir(tmp_path) if f.endswith(".json")]
        assert len(json_files) > 200  # we expect ~243 operators

    def test_gen_obj_info_file_structure(self, tmp_path):
        """Each OBJ_INFO JSON should have expected keys."""
        from maxpylang.tools.gen_scraper import generate_gen_obj_info
        generate_gen_obj_info(output_dir=str(tmp_path))

        # Check a known operator
        history_path = os.path.join(tmp_path, "history.json")
        if os.path.exists(history_path):
            with open(history_path, "r") as f:
                info = json.load(f)
            assert "default" in info
            assert "args" in info
            assert "attribs" in info
            assert "in/out" in info
            assert "doc" in info

    def test_gen_obj_info_default_has_box(self, tmp_path):
        """Each OBJ_INFO default should contain a valid box dict."""
        from maxpylang.tools.gen_scraper import generate_gen_obj_info
        generate_gen_obj_info(output_dir=str(tmp_path))

        # Check 'in' operator (saved as 'in.json' since it's a gen op name)
        in_path = os.path.join(tmp_path, "in.json")
        if os.path.exists(in_path):
            with open(in_path, "r") as f:
                info = json.load(f)
            box = info["default"]["box"]
            assert "id" in box
            assert "maxclass" in box
            assert "text" in box
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/katie/MaxPyLang && python3 -m pytest tests/test_gen.py::TestGenObjInfo -v`
Expected: FAIL — `ImportError: cannot import name 'generate_gen_obj_info'`

- [ ] **Step 3: Add OBJ_INFO generation to gen_scraper.py**

Add to `maxpylang/tools/gen_scraper.py`:

```python
from .constants import obj_info_folder


def _make_gen_obj_info(name, category=""):
    """
    Create an OBJ_INFO-compatible dict for a gen operator.

    Gen operators are simpler than Max objects — they don't have the full
    XML reference structure. We build a minimal but compatible info dict.
    """
    # Build a default box dict matching the structure in constants.unknown_obj_dict
    # but with actual object info
    default_box = {
        "box": {
            "id": "obj-1",
            "maxclass": "newobj",
            "numinlets": 1,
            "numoutlets": 1,
            "outlettype": [""],
            "patching_rect": [0.0, 0.0, 60.0, 22.0],
            "text": name,
        }
    }

    # Special cases for known inlet/outlet counts
    if name in ("in", "in1", "in2", "in3", "in4", "in5"):
        default_box["box"]["numinlets"] = 0
        default_box["box"]["numoutlets"] = 1
    elif name in ("out", "out1", "out2", "out3", "out4", "out5"):
        default_box["box"]["numinlets"] = 1
        default_box["box"]["numoutlets"] = 0
    elif name in ("param", "Param"):
        default_box["box"]["numinlets"] = 0
        default_box["box"]["numoutlets"] = 1
    elif name in ("+", "add", "-", "sub", "*", "mul", "/", "div",
                  "==", "eq", "!=", "neq", ">", "gt", "<", "lt",
                  ">=", "gte", "<=", "lte", "max", "min", "pow",
                  "atan2", "mod", "%", "scale", "clip", "clamp",
                  "fold", "wrap", "mix", "smoothstep", "?", "switch",
                  "gate", "selector", "delay"):
        default_box["box"]["numinlets"] = 2
        default_box["box"]["numoutlets"] = 1
    elif name in ("noise", "samplerate", "SAMPLERATE", "vectorsize",
                  "VECTORSIZE", "elapsed", "voice", "voicecount",
                  "mc_channel", "mc_channelcount",
                  "pi", "PI", "twopi", "TWOPI", "e", "E",
                  "halfpi", "HALFPI", "constant"):
        default_box["box"]["numinlets"] = 0
        default_box["box"]["numoutlets"] = 1

    return {
        "default": default_box,
        "args": {"required": [], "optional": []},
        "attribs": [],
        "in/out": {},
        "doc": {
            "digest": f"Gen operator: {name}",
            "description": f"Gen operator '{name}' (category: {category})",
        },
    }


def generate_gen_obj_info(gen_docs_path=None, output_dir=None):
    """
    Generate OBJ_INFO JSON files for all gen operators.

    If output_dir is None, writes to maxpylang/data/OBJ_INFO/gen/.
    """
    if output_dir is None:
        output_dir = os.path.join(obj_info_folder, "gen")

    os.makedirs(output_dir, exist_ok=True)

    local_ops = extract_local_gen_operators(gen_docs_path)

    # Flatten all operators, deduplicating by name
    all_ops = {}
    for group, ops in local_ops.items():
        for op in ops:
            name = op["name"]
            if name not in all_ops:
                all_ops[name] = op

    # Generate info file for each operator
    for name, op in all_ops.items():
        info = _make_gen_obj_info(name, category=op.get("category", ""))
        filepath = os.path.join(output_dir, f"{name}.json")
        with open(filepath, "w") as f:
            json.dump(info, f, indent=2)

    return len(all_ops)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/katie/MaxPyLang && python3 -m pytest tests/test_gen.py::TestGenObjInfo -v`
Expected: All 3 tests PASS

- [ ] **Step 5: Generate the actual OBJ_INFO/gen/ files**

Run: `cd /Users/katie/MaxPyLang && python3 -c "from maxpylang.tools.gen_scraper import generate_gen_obj_info; n = generate_gen_obj_info(); print(f'{n} gen operator info files generated')"`
Expected: `~243 gen operator info files generated`

- [ ] **Step 6: Commit**

```bash
git add maxpylang/tools/gen_scraper.py maxpylang/data/OBJ_INFO/gen/ tests/test_gen.py
git commit -m "feat: generate OBJ_INFO metadata for all gen operators"
```

---

### Task 7: Generate gen.py Stubs and Update objects/__init__.py

**Files:**
- Modify: `maxpylang/tools/gen_scraper.py`
- Create: `maxpylang/objects/gen.py` (generated)
- Modify: `maxpylang/objects/__init__.py`
- Test: `tests/test_gen.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/test_gen.py`:

```python
class TestGenStubs:
    """Test gen.py stub generation and imports."""

    def test_generate_gen_stubs(self, tmp_path):
        """Should create a gen.py stub file."""
        from maxpylang.tools.gen_scraper import generate_gen_stubs
        stub_path = str(tmp_path / "gen.py")
        generate_gen_stubs(output_path=stub_path)
        assert os.path.exists(stub_path)

    def test_gen_stubs_contain_known_operators(self, tmp_path):
        """Generated stubs should contain known gen operators."""
        from maxpylang.tools.gen_scraper import generate_gen_stubs
        stub_path = str(tmp_path / "gen.py")
        generate_gen_stubs(output_path=stub_path)
        with open(stub_path, "r") as f:
            content = f.read()
        # Check for some known operators (using sanitized Python names)
        assert "history" in content
        assert "phasor" in content
        assert "cycle" in content
        assert "noise" in content

    def test_gen_stubs_sanitize_names(self, tmp_path):
        """Operators with special chars should get sanitized Python names."""
        from maxpylang.tools.gen_scraper import generate_gen_stubs
        stub_path = str(tmp_path / "gen.py")
        generate_gen_stubs(output_path=stub_path)
        with open(stub_path, "r") as f:
            content = f.read()
        # 'in' is a Python keyword -> should become 'in_'
        assert "in_ = MaxObject(" in content
        # '!=' should become something valid
        # '+' should become something valid
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/katie/MaxPyLang && python3 -m pytest tests/test_gen.py::TestGenStubs -v`
Expected: FAIL — `ImportError: cannot import name 'generate_gen_stubs'`

- [ ] **Step 3: Add stub generation to gen_scraper.py**

Add to `maxpylang/tools/gen_scraper.py`:

```python
import keyword
import builtins


def _sanitize_gen_py_name(name):
    """Convert a gen operator name to a valid Python identifier.

    Uses the same conventions as importobjs.sanitize_py_name but also
    handles gen-specific operator symbols like +, -, *, /, etc.
    """
    # Symbol-to-word mapping for gen operators
    symbol_map = {
        "+": "add_op",
        "-": "sub_op",
        "*": "mul_op",
        "/": "div_op",
        "%": "mod_op",
        "!": "not_op",
        "!=": "neq_op",
        "!=p": "neqp_op",
        "==": "eq_op",
        "==p": "eqp_op",
        ">": "gt_op",
        ">=": "gte_op",
        ">p": "gtp_op",
        ">=p": "gtep_op",
        "<": "lt_op",
        "<=": "lte_op",
        "<p": "ltp_op",
        "<=p": "ltep_op",
        "&&": "and_op",
        "||": "or_op",
        "^^": "xor_op",
        "?": "switch_op",
        "!-": "rsub_op",
        "!/": "rdiv_op",
        "!%": "rmod_op",
        "+=": "plusequals_op",
        "*=": "mulequals_op",
    }

    if name in symbol_map:
        return symbol_map[name]

    # Standard sanitization (same as importobjs)
    result = name.replace("~", "_tilde")
    result = result.replace(".", "_")
    result = result.replace("-", "_")
    if result and result[0].isdigit():
        result = "_" + result
    if keyword.iskeyword(result) or result in dir(builtins):
        result = result + "_"
    return result


def generate_gen_stubs(gen_docs_path=None, output_path=None):
    """
    Generate gen.py stub file for IDE autocomplete.

    Follows the same pattern as importobjs.generate_stubs():
    - __all__ list
    - _NAMES dict mapping py_name -> gen operator name
    - Per-operator docstring + MaxObject instantiation

    If output_path is None, writes to maxpylang/objects/gen.py.
    """
    if output_path is None:
        objects_dir = os.path.join(
            os.path.abspath(os.path.join(os.path.realpath(__file__), os.pardir, os.pardir)),
            "objects",
        )
        output_path = os.path.join(objects_dir, "gen.py")

    local_ops = extract_local_gen_operators(gen_docs_path)

    # Flatten and deduplicate
    all_ops = {}
    for group, ops in local_ops.items():
        for op in ops:
            name = op["name"]
            if name not in all_ops:
                all_ops[name] = op

    # Build py_name -> gen_name mapping
    names_map = {}
    for name in sorted(all_ops.keys()):
        py_name = _sanitize_gen_py_name(name)
        names_map[py_name] = name

    # Build stub file
    stub_lines = []
    stub_lines.append('"""MaxObject stubs for gen operators. Auto-generated by gen_scraper."""')
    stub_lines.append("import os as _os")
    stub_lines.append("import sys as _sys")
    stub_lines.append("from maxpylang.maxobject import MaxObject")
    stub_lines.append("")

    # __all__
    all_names = sorted(names_map.keys())
    stub_lines.append("__all__ = [")
    for py_name in all_names:
        stub_lines.append(f"    '{py_name}',")
    stub_lines.append("]")
    stub_lines.append("")

    # _NAMES dict
    stub_lines.append("_NAMES = {")
    for py_name in all_names:
        stub_lines.append(f"    '{py_name}': '{names_map[py_name]}',")
    stub_lines.append("}")
    stub_lines.append("")

    # Suppress stdout during stub instantiation
    stub_lines.append("_devnull = open(_os.devnull, 'w')")
    stub_lines.append("_old_stdout = _sys.stdout")
    stub_lines.append("_sys.stdout = _devnull")
    stub_lines.append("")

    # Per-operator stubs
    for py_name in all_names:
        gen_name = names_map[py_name]
        op = all_ops[gen_name]
        category = op.get("category", "")
        docstring = f"{gen_name} - Gen operator ({category})"
        docstring = docstring.replace('"""', '\\"""')

        stub_lines.append('"""')
        stub_lines.append(docstring)
        stub_lines.append('"""')
        stub_lines.append(f"{py_name} = MaxObject('{gen_name}')")
        stub_lines.append("")

    # Restore stdout
    stub_lines.append("_sys.stdout = _old_stdout")
    stub_lines.append("_devnull.close()")
    stub_lines.append("del _devnull, _old_stdout")
    stub_lines.append("")

    with open(output_path, "w") as f:
        f.write("\n".join(stub_lines))

    return output_path
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/katie/MaxPyLang && python3 -m pytest tests/test_gen.py::TestGenStubs -v`
Expected: All 3 tests PASS

- [ ] **Step 5: Generate the actual gen.py stubs**

Run: `cd /Users/katie/MaxPyLang && python3 -c "from maxpylang.tools.gen_scraper import generate_gen_stubs; path = generate_gen_stubs(); print(f'Stubs generated at {path}')"`
Expected: `Stubs generated at .../maxpylang/objects/gen.py`

- [ ] **Step 6: Update objects/__init__.py to import gen**

In `maxpylang/objects/__init__.py`, add gen import after the existing msp import:

```python
"""Pre-instantiated MaxObject stubs for all imported packages."""
import warnings
from maxpylang.exceptions import UnknownObjectWarning

# Stubs intentionally create objects without args; suppress warnings during import
with warnings.catch_warnings():
    warnings.simplefilter("ignore", UnknownObjectWarning)
    try:
        from .jit import *
    except ImportError:
        pass
    try:
        from .max import *
    except ImportError:
        pass
    try:
        from .msp import *
    except ImportError:
        pass
    try:
        from .gen import *
    except ImportError:
        pass
```

- [ ] **Step 7: Test that gen objects can be imported**

Run: `cd /Users/katie/MaxPyLang && python3 -c "from maxpylang.objects.gen import history, phasor, cycle, noise, in_, out_; print('Gen imports work')"`
Expected: `Gen imports work`

- [ ] **Step 8: Run all tests**

Run: `cd /Users/katie/MaxPyLang && python3 -m pytest tests/ -v`
Expected: All tests pass

- [ ] **Step 9: Commit**

```bash
git add maxpylang/tools/gen_scraper.py maxpylang/objects/gen.py maxpylang/objects/__init__.py tests/test_gen.py
git commit -m "feat: generate gen.py stubs and add gen import to objects package"
```

---

### Task 8: End-to-End Integration Test

**Files:**
- Test: `tests/test_gen.py`

- [ ] **Step 1: Write the integration test**

Add to `tests/test_gen.py`:

```python
class TestGenEndToEnd:
    """End-to-end tests: create gen patchers, embed them, save, and verify output."""

    def test_passthrough_patch(self, tmp_path):
        """Recreate the ex1_passthrough.maxpat using the new API."""
        # Create gen patcher
        gen_patch = mp.MaxPatch(gen_type="dsp.gen", verbose=False)
        inp = gen_patch.place("in 1", verbose=False)[0]
        outp = gen_patch.place("out 1", verbose=False)[0]
        gen_patch.connect([inp.outs[0], outp.ins[0]], verbose=False)

        # Create outer patch
        patch = mp.MaxPatch(verbose=False)
        gen_obj = patch.place("gen~", gen_patcher=gen_patch, verbose=False)[0]
        dac = patch.place("dac~", verbose=False)[0]
        patch.connect([gen_obj.outs[0], dac.ins[0]], verbose=False)

        # Save
        filepath = str(tmp_path / "passthrough.maxpat")
        patch.save(filepath, verbose=False, check=False)

        # Load and verify structure
        with open(filepath, "r") as f:
            saved = json.load(f)

        # Should have 2 top-level objects
        assert len(saved["patcher"]["boxes"]) == 2

        # Find gen~ box
        gen_boxes = [b for b in saved["patcher"]["boxes"]
                     if b["box"].get("text", "").startswith("gen~")]
        assert len(gen_boxes) == 1

        gen_box = gen_boxes[0]["box"]
        assert "patcher" in gen_box
        assert gen_box["patcher"]["classnamespace"] == "dsp.gen"
        assert len(gen_box["patcher"]["boxes"]) == 2
        assert len(gen_box["patcher"]["lines"]) == 1

    def test_gen_with_cycle_operator(self, tmp_path):
        """Create a gen~ patch that uses the cycle operator."""
        gen_patch = mp.MaxPatch(gen_type="dsp.gen", verbose=False)
        inp = gen_patch.place("in 1", verbose=False)[0]
        cyc = gen_patch.place("cycle", verbose=False)[0]
        outp = gen_patch.place("out 1", verbose=False)[0]
        gen_patch.connect(
            [inp.outs[0], cyc.ins[0]],
            [cyc.outs[0], outp.ins[0]],
            verbose=False,
        )

        patch = mp.MaxPatch(verbose=False)
        gen_obj = patch.place("gen~", gen_patcher=gen_patch, verbose=False)[0]
        dac = patch.place("ezdac~", verbose=False)[0]
        patch.connect([gen_obj.outs[0], dac.ins[0]], verbose=False)

        filepath = str(tmp_path / "gen_cycle.maxpat")
        patch.save(filepath, verbose=False, check=False)

        with open(filepath, "r") as f:
            saved = json.load(f)

        gen_box = [b for b in saved["patcher"]["boxes"]
                   if b["box"].get("text", "").startswith("gen~")][0]
        inner_texts = [b["box"]["text"] for b in gen_box["box"]["patcher"]["boxes"]]
        assert "in 1" in inner_texts
        assert "cycle" in inner_texts
        assert "out 1" in inner_texts
        assert len(gen_box["box"]["patcher"]["lines"]) == 2

    def test_jit_gen_patcher(self, tmp_path):
        """Create a jit.gen patch with correct classnamespace."""
        gen_patch = mp.MaxPatch(gen_type="jit.gen", verbose=False)
        inp = gen_patch.place("in 1", verbose=False)[0]
        outp = gen_patch.place("out 1", verbose=False)[0]
        gen_patch.connect([inp.outs[0], outp.ins[0]], verbose=False)

        patch = mp.MaxPatch(verbose=False)
        gen_obj = patch.place("jit.gen", gen_patcher=gen_patch, verbose=False)[0]

        filepath = str(tmp_path / "jit_gen_test.maxpat")
        patch.save(filepath, verbose=False, check=False)

        with open(filepath, "r") as f:
            saved = json.load(f)

        gen_box = [b for b in saved["patcher"]["boxes"]
                   if "patcher" in b["box"]][0]
        assert gen_box["box"]["patcher"]["classnamespace"] == "jit.gen"
```

- [ ] **Step 2: Run integration tests**

Run: `cd /Users/katie/MaxPyLang && python3 -m pytest tests/test_gen.py::TestGenEndToEnd -v`
Expected: All 3 tests PASS

- [ ] **Step 3: Run full test suite**

Run: `cd /Users/katie/MaxPyLang && python3 -m pytest tests/ -v`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add tests/test_gen.py
git commit -m "test: add end-to-end integration tests for gen patcher support"
```

---

### Task 9: Update Package __init__.py Docstring

**Files:**
- Modify: `maxpylang/__init__.py`

- [ ] **Step 1: Update the docstring to document gen support**

In `maxpylang/__init__.py`, add gen documentation after the "Stub Objects" section (around line 63):

```python
Gen Patchers
------------

Create gen~ sub-patchers using ``gen_type`` parameter::

    # Inner gen patcher
    gen_patch = mp.MaxPatch(gen_type="dsp.gen")
    inp = gen_patch.place("in 1")[0]
    cyc = gen_patch.place("cycle")[0]
    outp = gen_patch.place("out 1")[0]
    gen_patch.connect([inp.outs[0], cyc.ins[0]],
                      [cyc.outs[0], outp.ins[0]])

    # Embed in outer patch
    patch = mp.MaxPatch()
    gen_obj = patch.place("gen~", gen_patcher=gen_patch)[0]
    dac = patch.place("ezdac~")[0]
    patch.connect([gen_obj.outs[0], dac.ins[0]])
    patch.save("my_gen_patch")

Gen type options:

- ``"dsp.gen"`` — gen~ (audio-rate)
- ``"jit.gen"`` — jit.gen (CPU matrix)
- ``"jit.pix"`` — jit.pix (CPU pixel)
- ``"jit.gl.pix"`` — jit.gl.pix (GPU pixel)

Gen operator stubs are in ``maxpylang/objects/gen.py``::

    from maxpylang.objects import gen
```

Also update the "Available Objects" section to mention gen:

```python
All valid object names are in ``maxpylang/objects/`` (stubs by package: ``max.py``, ``msp.py``, ``jit.py``, ``gen.py``).
```

- [ ] **Step 2: Verify the import still works**

Run: `cd /Users/katie/MaxPyLang && python3 -c "import maxpylang as mp; print(mp.__doc__[:200])"`
Expected: Prints first 200 chars of the updated docstring without errors

- [ ] **Step 3: Commit**

```bash
git add maxpylang/__init__.py
git commit -m "docs: add gen patcher documentation to package docstring"
```

---

## Summary

| Task | What it does | Key files |
|------|-------------|-----------|
| 1 | Gen patcher JSON template | `gen_template.json` |
| 2 | `gen_type` param on MaxPatch | `maxpatch.py`, `test_gen.py` |
| 3 | `gen_patcher` param on place() | `placing.py`, `test_gen.py` |
| 4 | Extract gen ops from local Max | `gen_scraper.py`, `test_gen.py` |
| 5 | Scrape online docs + comparison report | `gen_scraper.py`, `gen_operator_comparison.md` |
| 6 | Generate OBJ_INFO/gen/ metadata | `gen_scraper.py`, `OBJ_INFO/gen/*.json` |
| 7 | Generate gen.py stubs + update imports | `gen.py`, `__init__.py` |
| 8 | End-to-end integration tests | `test_gen.py` |
| 9 | Update package docstring | `__init__.py` |
