---
description: "UnknownObjectWarning, the PatchCheck report save() prints, and type checks on cords (what they catch and miss)."
---

# Checks and warnings

maxpylang checks a patch at three moments. Each catches different mistakes.

| When                        | What is caught                                      | How you see it |
|-----------------------------|-----------------------------------------------------|----------------|
| As you type (type checker)  | audio into an inlet that takes none; an inlet or outlet number past the object's count | an error in your editor or from `mypy`/`pyright`/`ty` |
| When you place an object    | a name Max does not have                            | `UnknownObjectWarning` |
| When you save               | unknown objects, `js` files and abstractions the patch needs | `PatchCheck:` lines |

## Unknown objects

A name maxpylang does not know, often a typo, gives a warning:

```text
UnknownObjectWarning: Unknown Max object: 'cycel~'
```

The object is still placed, with **no inlets or outlets**, so every later `connect()` to it
fails. Fix the name rather than carrying on. `obj.notknown()` returns `True` for such an
object. To stop at the line with the typo, make the warning an error:

```python
import warnings
from maxpylang.exceptions import UnknownObjectWarning

warnings.simplefilter("error", UnknownObjectWarning)
```

See also {doc}`../topics/unknown_objs`.

## The `PatchCheck` report

`save()` ends with a report like this:

```text
PatchCheck: unknown objects : no unknown objects
PatchCheck: unlinked js objects : no unlinked js objects
PatchCheck: linked js objects (files must be in same folder as patch file): no linked js objects
PatchCheck: linked abstractions (files must be in same folder as patch file): no linked abstractions
maxpatch saved to checked.maxpat
```

| Line                     | Means                                                           | Do |
|--------------------------|-----------------------------------------------------------------|----|
| `unknown objects`        | objects maxpylang does not know; listed by id and text          | fix the names |
| `unlinked js objects`    | `js` boxes whose `.js` file was not found                       | put the file next to the script, or `obj.link("file.js")` |
| `linked js objects`      | `js` files the patch uses                                       | copy them with the patch |
| `linked abstractions`    | other `.maxpat` files the patch uses                            | copy them with the patch |

`patch.save(..., check=False)` skips the report, and `patch.check()` prints it at any time.

## Example

```{literalinclude} ../../examples/checks.py
:language: python
```

## Type checks on cords

The stubs in `maxpylang.objects` record, for each object, how many inlets and outlets it has
and whether each one carries audio or messages. A type checker reads that and flags cords
that cannot work:

```{literalinclude} ../../examples/bad_connections.py
:language: python
```

What each rate means:

| Rate       | Carries                                  |
|------------|------------------------------------------|
| `Control`  | messages: numbers, symbols, lists, bang  |
| `Matrix`   | a Jitter matrix (a kind of `Control`)    |
| `Signal`   | MSP audio                                |
| `MCSignal` | multichannel audio (a kind of `Signal`)  |

An error naming `Outlet[Signal]` and `Inlet[Control]` means audio is going into an inlet that
takes only messages. To show an audio value as a number, put `snapshot~` in between. Messages
into an audio inlet are always allowed, because most audio inlets also take numbers.

**What is not checked:**

- cords written as lists, `[outlet, inlet]`;
- objects placed by string, `patch.place("cycle~ 440")`;
- more than eight cords in one `connect()` call;
- objects whose inlet or outlet count depends on their arguments (`vst~ 4 4`), past index 0;
- operators such as `times_tilde` (`*~`), whose types are not recorded yet.

:::{important}
These checks run only in a type checker, not when you run the script. Running it with
`python` saves a cord from audio into a message-only inlet without any warning. An inlet
number past the object's count does fail at run time, with `IndexError`. Set up your editor
as in {doc}`editor-setup` to see these errors as you type.
:::
