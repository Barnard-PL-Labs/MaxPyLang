"""
The agent guide (maxpylang/data/AGENTS_TEMPLATE.md) is what coding agents copy from, so its
examples must run and must pass the type checkers it tells agents to use.

An example is a ```python block that places objects. The other blocks are API signatures or
need files on disk. Each example runs after a shared prelude (maxpylang as mp, every stub,
and an empty patch), the context the guide assumes.
"""

import ast
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from test_static_types import CHECKERS, find_tool, flagged_lines

ROOT = Path(__file__).resolve().parents[1]
GUIDE = ROOT / "maxpylang" / "data" / "AGENTS_TEMPLATE.md"
EMPTY_PATCH = ROOT / "maxpylang" / "data" / "PATCH_TEMPLATES" / "empty_template.json"

PRELUDE = """\
import maxpylang as mp
from maxpylang.objects import *
patch = mp.MaxPatch()
"""


def guide_blocks():
    return re.findall(r"```python\n(.*?)```", GUIDE.read_text(encoding="utf-8"), re.DOTALL)


def examples():
    found = []
    for block in guide_blocks():
        try:
            ast.parse(block)
        except SyntaxError:
            continue
        if "place(" in block:
            found.append(block)
    return found


def example_id(block):
    return block.strip().splitlines()[0][:40]


def test_guide_has_examples():
    assert len(examples()) >= 5


def test_guide_teaches_only_checked_connections():
    # the list form still works, but a type checker cannot check it
    for block in guide_blocks():
        assert not re.search(r"\.connect\(\s*\[", block), f"list-form connect() in the guide:\n{block}"


@pytest.mark.parametrize("block", examples(), ids=example_id)
def test_example_runs(block, tmp_path):
    # the abstraction example finds my_synth.maxpat in the working directory
    shutil.copy(EMPTY_PATCH, tmp_path / "my_synth.maxpat")
    script = tmp_path / "example.py"
    script.write_text(PRELUDE + block, encoding="utf-8")
    result = subprocess.run([sys.executable, str(script)], cwd=tmp_path, capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "UnknownObjectWarning" not in result.stderr, result.stderr
    assert "ConnectionWarning" not in result.stderr, result.stderr


@pytest.mark.parametrize("checker", sorted(CHECKERS))
def test_examples_type_check(checker, tmp_path):
    if find_tool(checker) is None:
        if os.environ.get("CI"):
            pytest.fail(f"{checker} is not installed; CI must run every checker")
        pytest.skip(f"{checker} is not installed")

    # one file per example, so names reused across examples do not clash
    paths = []
    for n, block in enumerate(examples()):
        path = tmp_path / f"guide_example_{n}.py"
        path.write_text(PRELUDE + block, encoding="utf-8")
        paths.append(path)

    for path in paths:
        result = subprocess.run(CHECKERS[checker](path), cwd=tmp_path, capture_output=True, text=True)
        output = result.stdout + result.stderr
        assert not flagged_lines(path, output), f"{checker} flags a guide example:\n{path.read_text()}\n{output}"
