---
description: "PyPI and source installs, and fixing a missing module."
---

# Installation

## Requirements

- Python 3.9 or newer
- Max (MaxMSP) to open and run the patches you generate. MaxPyLang itself does not need Max.

## Install from PyPI

Use a virtual environment so MaxPyLang and its dependencies stay separate from other projects:

```bash
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install maxpylang
```

This also installs `numpy`, `tabulate` and `sphinx_rtd_theme`.

## Install from source

To work on MaxPyLang itself, install the repository in editable mode:

```bash
git clone https://github.com/Barnard-PL-Labs/MaxPyLang.git
cd MaxPyLang
pip install -e ".[dev]" --config-settings editable_mode=compat
```

`[dev]` adds pytest and the type checkers (mypy, pyright, ty). `editable_mode=compat` makes
the editable install visible to type checkers; the default mode uses an import hook they
cannot follow.

## Check the install

```bash
python -c "import maxpylang as mp; mp.MaxPatch()"
```

This should print `Patcher: new patch created from template file: empty_template.json`.

## Troubleshooting

**`ModuleNotFoundError: No module named 'maxpylang'`.** The package is installed in a
different Python from the one you are running. Activate the virtual environment, or run
`python -m pip install maxpylang` with the same `python` you use for your script.

**`SyntaxWarning: invalid escape sequence` on import.** Python 3.12 and newer print a few of
these from maxpylang's own source, usually only the first time it loads. They are harmless.

**Old Python.** Check with `python3 --version`. MaxPyLang needs 3.9 or newer.
