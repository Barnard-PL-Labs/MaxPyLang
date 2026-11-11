---
description: "Turn on type checking in VS Code (Type Checking Mode set to standard), or run mypy or pyright."
---

# Editor setup

maxpylang ships type information (`py.typed` and `.pyi` stubs). With a type checker on, wrong
cords show up in your editor before you run anything. See {doc}`checks` for what is checked.

## VS Code

VS Code's Python support (Pylance) does no type checking by default. Turn it on:

1. Select the interpreter where you installed maxpylang: **Python: Select Interpreter** in
   the Command Palette, then your `.venv`.
2. Open Settings, search for **Type Checking Mode**, and set it to **standard**. Or add this to
   `.vscode/settings.json`:

   ```json
   {
     "python.analysis.typeCheckingMode": "standard"
   }
   ```

`basic` also catches cord mistakes; `off`, the default, catches nothing. A wrong cord is then
underlined in red:

```text
Argument of type "tuple[Outlet[Signal], Inlet[Control]]" cannot be assigned to parameter "c0"
```

Hovering a stub such as `cycle_tilde` shows the object's description, arguments, and what
each inlet and outlet takes.

## From the command line

Any of these checks a script:

```bash
pip install mypy pyright
mypy my_patch.py
pyright my_patch.py
```

How each reports the same mistakes:

| Mistake                         | mypy                                         | pyright / Pylance                          |
|---------------------------------|----------------------------------------------|--------------------------------------------|
| audio into a message-only inlet | `Cannot infer value of type parameter "_R0"` | `Argument of type "tuple[Outlet[Signal], Inlet[Control]]" cannot be assigned` |
| inlet number too high           | `Tuple index out of range`                   | `Index 2 is out of range for type tuple[...]` |

[ty](https://github.com/astral-sh/ty) works too, but use version 0.0.95
(`pip install ty==0.0.95`): 0.0.96 to 0.0.98 skip the audio check.

## Working on maxpylang itself

Install the repository so type checkers can follow it:

```bash
pip install -e ".[dev]" --config-settings editable_mode=compat
```

The default editable install uses an import hook that type checkers cannot read, so they would
see no types. After changing `maxpylang/data/xlet_types.json`, regenerate the stubs with
`python -m maxpylang.tools.typedstubs`.
