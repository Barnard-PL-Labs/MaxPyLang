---
description: "Install, write a first patch, save it, load it back, and lay it out."
---

# Getting started

MaxPyLang writes Max patches from Python. You place objects, connect them, and save a
`.maxpat` file that opens in Max like any patch you made by hand.

## Install

```bash
python3 -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install maxpylang
```

You need Python 3.9 or newer. You only need Max to open the result. See {doc}`../install` for
installing from source.

## Your first patch

```{literalinclude} ../../examples/getting_started.py
:language: python
```

Run it with `python getting_started.py`. It prints what it connected, a `PatchCheck` report
(see {doc}`checks`) and the objects it loaded back, and writes `hello_world.maxpat`. Open that in
Max, turn on audio with the speaker (`ezdac~`), and you hear a 440 Hz sine.

## What the script prints

maxpylang logs as it works. Each part can be turned off:

| Output                                  | Turn it off with                          |
|-----------------------------------------|-------------------------------------------|
| `Patcher: new patch created ...`        | `mp.MaxPatch(verbose=False)`              |
| `Patcher: connected: ( ... )`           | `patch.connect(..., verbose=False)`       |
| the `PatchCheck` report                 | `patch.save(..., check=False)`            |
| `maxpatch saved to ...`                 | `patch.save(..., verbose=False)`          |

`place()` also prints each object it places, as two lines like `(cycle~ [cycle~ 440],)` and
`[cycle~ [cycle~ 440]]`, and loading a patch prints one line per object. These are left-over debug
lines and cannot be turned off yet; ignore them.

## The four ideas

**A patch.** `mp.MaxPatch()` is an empty patch. `mp.MaxPatch(load_file="x.maxpat")` loads an
existing one; it also reads Max for Live `.amxd` files. In 0.1.1, loading fails on most
patches saved by Max itself; patches written by maxpylang load fine. See {doc}`known-issues`.

**Placing.** `patch.place(...)` adds objects and **always returns a list**, even for one
object, so take `[0]`. You can describe an object two ways:

- a stub from `maxpylang.objects`: `cycle_tilde(440)`. Your editor autocompletes it and a
  type checker can check its cords (see {doc}`editor-setup`);
- a string with the text you would type in the box: `"cycle~ 440"`. Works for anything, checked
  only for a known name.

**Connecting.** `patch.connect((outlet, inlet), ...)` draws cords. `obj.outs[0]` is the
leftmost outlet and `obj.ins[0]` the leftmost inlet. See {doc}`connecting`.

**Saving.** `patch.save("name")` writes `name.maxpat`. With `device_type=` it writes a Max for
Live device instead; see {doc}`max-for-live`.

## Laying out a patch

Without positions, objects are placed on a grid in the order you place them. For a patch
people will read, call `patch.set_position(x, y)` before each `place()`. Coordinates are in
pixels from the top left, and `y` grows downward, so signal flows top to bottom.

`set_position()` moves a cursor, and `place()` puts the object one grid step (80 px) to the
right of it: after `set_position(30, 30)`, the object lands at (110, 30). A `y` of 0 is moved
down to 80. Only the spacing between objects matters for reading a patch, so this offset is
usually harmless. Good spacing:

- about 60 px between objects in a chain,
- parallel chains side by side at the same `y`,
- a `comment` just above an object to label it: `patch.place("comment pitch in")`.

## Next

- {doc}`connecting`: inlets, outlets, stubs and many objects at once
- {doc}`max-for-live`: devices for Ableton Live
- {doc}`checks`: what maxpylang checks, and when
- {doc}`editor-setup`: see wrong cords as you type
