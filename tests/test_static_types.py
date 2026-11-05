"""
Run the snippets in tests/typing_snippets/ through ty, mypy and pyright.

A snippet line ending in `# error` must get a diagnostic, and no other line may.

Each snippet is copied out of the repo before checking, so `import maxpylang`
resolves to the installed package the way it does for a user. Run from inside
the repo, pyright treats maxpylang as local source and skips the library rules
(that is how a missing `__all__` once went unnoticed). This needs an install
the checkers can follow: a wheel, or `pip install -e ".[dev]" --config-settings
editable_mode=compat`. The default editable install uses an import hook that
no type checker reads.
"""

import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SNIPPETS = sorted((ROOT / "tests" / "typing_snippets").glob("*.py"))


def expected_lines(path):
    lines = path.read_text().splitlines()
    return {n for n, line in enumerate(lines, start=1) if line.rstrip().endswith("# error")}


def flagged_lines(path, output):
    # ty "f.py:3:5: error[...]", mypy "f.py:3: error:", pyright "f.py:3:5 - error:"
    pattern = re.compile(re.escape(path.name) + r":(\d+)(?::\d+)?:?(?: -)? error")
    return {int(m.group(1)) for m in pattern.finditer(output)}


def find_tool(name):
    local = Path(sys.executable).parent / name
    return str(local) if local.exists() else shutil.which(name)


CHECKERS = {
    "ty": lambda path: [find_tool("ty"), "check", "--python", sys.executable,
                        "--output-format", "concise", str(path)],
    "mypy": lambda path: [sys.executable, "-m", "mypy", "--follow-imports=silent",
                          "--no-error-summary", "--hide-error-context", str(path)],
    "pyright": lambda path: [find_tool("pyright"), "--pythonpath", sys.executable, str(path)],
}


@pytest.mark.parametrize("checker", sorted(CHECKERS))
@pytest.mark.parametrize("path", SNIPPETS, ids=lambda p: p.name)
def test_snippet(checker, path, tmp_path):
    if find_tool(checker) is None:
        if os.environ.get("CI"):
            pytest.fail(f"{checker} is not installed; CI must run every checker")
        pytest.skip(f"{checker} is not installed")

    snippet = tmp_path / path.name
    shutil.copy(path, snippet)
    result = subprocess.run(CHECKERS[checker](snippet), cwd=tmp_path, capture_output=True, text=True)
    output = result.stdout + result.stderr

    unresolved = re.search(r"maxpylang.*(not resolved|Cannot resolve|Cannot find implementation)"
                           r"|(not resolved|Cannot resolve|Cannot find implementation).*maxpylang", output)
    assert not unresolved, (
        f"{checker} cannot find the installed maxpylang. Install it as a wheel or with "
        f'`pip install -e ".[dev]" --config-settings editable_mode=compat`.\n{output}'
    )

    flagged = flagged_lines(path, output)
    expected = expected_lines(path)
    assert flagged == expected, (
        f"missed: {sorted(expected - flagged)}, false alarms: {sorted(flagged - expected)}\n{output}"
    )
