---
description: "place() returns a list; 0-based inlets and outlets; connect() with tuples; stubs and their Python names."
---

# Connecting objects

## `place()` returns a list

`patch.place()` always returns a list of the objects it placed, even when it placed one:

```python
osc = patch.place("cycle~ 440")[0]        # one object: take [0]
a, b, c = patch.place("cycle~ 220", "cycle~ 330", "cycle~ 440")
voices = patch.place("cycle~", num_objs=8) # eight separate cycle~ objects
```

Forgetting `[0]` is the most common mistake: `patch.place("cycle~")` is a list, and a list has
no `.outs`.

## Inlets and outlets

Every object has `.ins` and `.outs`, numbered from 0, left to right, as in Max.
`cycle~` has two inlets (frequency, phase) and one outlet:

```python
osc.ins[0]    # frequency inlet
osc.ins[1]    # phase inlet
osc.outs[0]   # the audio out
```

To see an object's inlets and outlets, hover its stub in your editor, or print
`len(obj.ins)` and `len(obj.outs)`.

## `connect()`

Each cord is a pair, `(outlet, inlet)`. Pass as many pairs as you like in one call:

```python
patch.connect(
    (osc.outs[0], dac.ins[0]),
    (osc.outs[0], dac.ins[1]),
)
```

- **Tuples are checked, lists are not.** `[outlet, inlet]` also works, but a type checker
  skips it. Use tuples.
- **Midpoints.** A third element bends the cord: `(a.outs[0], b.ins[0], [[100.0, 40.0]])`.
- **Fan out freely.** One outlet can feed many inlets, and one inlet can take many cords.

## Stubs

`maxpylang.objects` has one ready-made object, a *stub*, for every object in Max, MSP and
Jitter. Python names follow these rules:

| Max name   | Python name      | Rule                               |
|------------|------------------|------------------------------------|
| `cycle~`   | `cycle_tilde`    | `~` becomes `_tilde`               |
| `jit.movie`| `jit_movie`      | `.` becomes `_`                    |
| `mc.cycle~`| `mc_cycle_tilde` | both                               |
| `2d.wave~` | `_2d_wave_tilde` | a leading digit gets `_` in front  |
| `in`       | `in_`            | a Python keyword gets `_` after it |

Operators are spelled out: `*~` is `times_tilde`, `+~` is `plus_tilde`. These write `times~`
and `plus~`, which Max accepts as other names for `*~` and `+~`. Operator stubs carry no type
information yet, so a string such as `patch.place("*~ 0.5")` is just as good, and easier to read.

**Call a stub to give it arguments and attributes.** Positional arguments become box
arguments and keywords become `@` attributes:

```python
from maxpylang.objects import cycle_tilde, metro

cycle_tilde(440)        # cycle~ 440
metro(500, active=1)    # metro 500 @active 1
```

**Connect what `place()` returns, never the stub.** A stub is a template; `place()` puts a copy
in the patch. Connecting the stub itself raises:

```text
ValueError: 'cycle~' is a stub from maxpylang.objects, which is never placed itself.
Connect the object place() returned instead, e.g. obj = patch.place(stub)[0]
```

## Example

```{literalinclude} ../../examples/connecting.py
:language: python
```
