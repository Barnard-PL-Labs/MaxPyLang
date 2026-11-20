---
description: "UnknownObjectWarning, ConnectionWarning and GraphWarning, the PatchCheck report save() prints, and type checks in your editor."
---

# Checks and warnings

maxpylang checks a patch at four moments. Each catches different mistakes.

| When                        | What is caught                                      | How you see it |
|-----------------------------|-----------------------------------------------------|----------------|
| As you type (type checker)  | audio into an inlet that takes none; an inlet or outlet number past the object's count | an error in your editor or from `mypy`/`pyright`/`ty` |
| When you place an object    | a name Max does not have                            | `UnknownObjectWarning` |
| When you connect            | a cord that sends audio into an inlet that takes none | `ConnectionWarning` |
| When you save               | the shape of the patch: a hot loop, audio feedback with no delay, an object whose output reaches nothing; plus missing files | `GraphWarning`, and the `PatchCheck:` report |

The warnings come from Python's `warnings` module, so they print where your script ran and
the script carries on. To stop at the first one instead, make them errors:

```python
import warnings
from maxpylang import ConnectionWarning, GraphWarning
from maxpylang.exceptions import UnknownObjectWarning

for kind in (UnknownObjectWarning, ConnectionWarning, GraphWarning):
    warnings.simplefilter("error", kind)
```

## Unknown objects

A name maxpylang does not know, often a typo, gives a warning:

```text
UnknownObjectWarning: Unknown Max object: 'cycel~'
```

The object is still placed, with **no inlets or outlets**, so every later `connect()` to it
fails. Fix the name rather than carrying on. `obj.notknown()` returns `True` for such an
object. See also {doc}`../topics/unknown_objs`.

## Audio into an inlet that takes none

`connect()` checks each cord as you make it, whichever way you write it (strings or stubs,
tuples or lists). A cord from an audio outlet into an inlet that only takes messages gives:

```text
ConnectionWarning: cycle~ (obj-1) outlet 0 sends audio, but flonum (obj-2) inlet 0 takes no
audio. Max keeps the cord and only prints a console warning. To use audio as numbers, go
through snapshot~.
```

The cord is still made, as Max would make it. Messages into an audio inlet are always fine,
because most audio inlets also take numbers. To read an audio value as a number, put
`snapshot~` in between.

## The shape of the patch

At `save()`, maxpylang looks at the whole patch, not one cord at a time, and gives a
`GraphWarning` for:

- **a hot loop**: a message cycle where every cord lands on a hot inlet, so one message loops
  without end and locks Max up (send one cord into a cold inlet, or put `deferlow` or `delay`
  in the loop);
- **audio feedback with no delay**, which Max can't compute (put a delay in the loop:
  `tapin~` and `tapout~`, or `send~` and `receive~`);
- **an object whose output reaches nothing**: no speakers, display or other effect, usually
  a missing cord. For example: `GraphWarning: cycle~ (obj-1) is not connected to anything.`

## The `PatchCheck` report

`save()` ends with a report like this (blank lines between the lines left out):

```text
PatchCheck: unknown objects : no unknown objects
PatchCheck: unlinked js objects : no unlinked js objects
PatchCheck: linked js objects (files must be in same folder as patch file): no linked js objects
PatchCheck: linked abstractions (files must be in same folder as patch file): no linked abstractions
PatchCheck: cords : 1 cord, 0 sending audio into an inlet that takes none, 0 not checked (no type data)
PatchCheck: graph : 0 hot loops, 0 audio feedback loops with no delay, 0 parts of the patch whose output reaches nothing
maxpatch saved to checked.maxpat
```

| Line                     | Means                                                           | Do |
|--------------------------|-----------------------------------------------------------------|----|
| `unknown objects`        | objects maxpylang does not know; listed by id and text          | fix the names |
| `unlinked js objects`    | `js` boxes whose `.js` file was not found                       | put the file in the folder you run the script from, or `obj.link("file.js")` |
| `linked js objects`      | `js` files the patch uses                                       | copy them with the patch |
| `linked abstractions`    | other `.maxpat` files the patch uses                            | copy them with the patch |
| `cords`                  | how many cords were checked, how many send audio where it can't go, and how many could not be judged | fix each `ConnectionWarning`; "not checked" means maxpylang has no type data for that object |
| `graph`                  | hot loops, audio feedback, and parts whose output reaches nothing | fix each `GraphWarning` |

`patch.save(..., check=False)` skips the report and the patch-shape checks.
`patch.check()` runs the same checks and prints the report at any time.

## Example

```{literalinclude} ../../examples/checks.py
:language: python
```

## Type checks as you type

The stubs in `maxpylang.objects` record, for each object, how many inlets and outlets it has
and whether each one carries audio or messages. A type checker reads that and flags cords
that cannot work, before you run anything:

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
takes only messages: the same mistake `ConnectionWarning` reports when the script runs.

**What the type checker does not check** (running the script still does):

- objects placed by string, `patch.place("cycle~ 440")`;
- cords written as lists, `[outlet, inlet]`, and calls with more than eight cords: the audio
  check is skipped, but inlet numbers are still checked;
- inlets or outlets whose count depends on the object's arguments, such as `vst~`'s outlets:
  any number passes.

Set up your editor as in {doc}`editor-setup` to see these errors as you type.
