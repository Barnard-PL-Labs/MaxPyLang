"""
Check that every example in docs/examples/ works as the docs say.

    python docs/run_examples.py            # run the examples
    python docs/run_examples.py --types    # also type-check them with mypy and pyright

Each example runs in a fresh temporary folder, and must
  - exit without an error,
  - place no unknown objects (no UnknownObjectWarning, no "PatchCheck: unknown objects :" list),
  - save at least one .maxpat or .amxd file.

bad_*.py files are never run. With --types, the other examples must type-check with 0 errors,
and in bad_*.py exactly the lines ending in `# error` must be flagged, which shows the checks fire.
"""

import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

EXAMPLES = Path(__file__).resolve().parent / "examples"
UNKNOWN_LIST = re.compile(r"PatchCheck: unknown objects :\s*\n\s+obj-")


def run(path):
    with tempfile.TemporaryDirectory() as tmp:
        result = subprocess.run([sys.executable, "-W", "ignore::SyntaxWarning", str(path)],
                                cwd=tmp, capture_output=True, text=True)
        output = result.stdout + result.stderr
        saved = [p.name for p in Path(tmp).iterdir() if p.suffix in (".maxpat", ".amxd")]
    problems = []
    if result.returncode != 0:
        problems.append(f"exited with {result.returncode}")
    if "UnknownObjectWarning" in result.stderr or UNKNOWN_LIST.search(output):
        problems.append("placed an unknown object")
    if not saved:
        problems.append("saved no patch")
    return problems, output, saved


def checker_commands(path):
    pyright = shutil.which("pyright") or str(Path(sys.executable).parent / "pyright")
    return {
        "mypy": [sys.executable, "-m", "mypy", "--follow-imports=silent", "--no-error-summary",
                 "--hide-error-context", "--no-incremental", str(path)],
        "pyright": [pyright, "--pythonpath", sys.executable, str(path)],
    }


def flagged_lines(path, output):
    pattern = re.compile(re.escape(path.name) + r":(\d+)(?::\d+)?:?(?: -)? error")
    return {int(m.group(1)) for m in pattern.finditer(output)}


def expected_lines(path):
    return {n for n, line in enumerate(path.read_text().splitlines(), start=1)
            if line.rstrip().endswith("# error")}


def type_check(path):
    problems = []
    with tempfile.TemporaryDirectory() as tmp:
        # Check a copy outside the repo, so maxpylang resolves as an installed package.
        copy = Path(tmp) / path.name
        shutil.copy(path, copy)
        for name, cmd in checker_commands(copy).items():
            result = subprocess.run(cmd, cwd=tmp, capture_output=True, text=True)
            got, want = flagged_lines(copy, result.stdout + result.stderr), expected_lines(path)
            if got != want:
                problems.append(f"{name}: flagged lines {sorted(got)}, expected {sorted(want)}\n"
                                + result.stdout + result.stderr)
    return problems


def main():
    types = "--types" in sys.argv
    failed = 0
    for path in sorted(EXAMPLES.glob("*.py")):
        problems = []
        if not path.name.startswith("bad_"):
            run_problems, output, saved = run(path)
            problems += run_problems
            if run_problems:
                problems.append(output)
        if types:
            problems += type_check(path)
        status = "FAIL" if problems else "ok"
        print(f"{status:4}  {path.name}")
        for p in problems:
            print("      " + p.replace("\n", "\n      "))
        failed += bool(problems)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
