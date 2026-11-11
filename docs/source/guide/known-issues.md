---
description: "Bugs in maxpylang 0.1.1 that change what works: loading patches saved by Max, frozen devices, js boxes, live.* objects, debug output."
---

# Known issues

These are bugs in maxpylang 0.1.1, the current release, that change what the rest of these pages
can promise. Each was found by running maxpylang against patches and devices saved by Max 9.1.

## Loading a patch saved by Max fails if it has UI objects

`mp.MaxPatch(load_file=...)` crashes with `KeyError: 'text'` on any patch saved by Max that
contains a box Max stores without a `text` field: UI objects such as `toggle`, `number`,
`flonum`, `button`, `slider`, `dial`, `umenu`, `multislider` and `live.dial`, an empty
`message` box, and also `inlet` and `outlet`. maxpylang expects every box to have one.

- Patches **written by maxpylang** load fine, because maxpylang always stores `text`.
- Patches saved by Max with only plain object boxes (`cycle~`, `metro`, …) load fine.
- Because `inlet` and `outlet` are among them, no abstraction saved by Max loads.
- Every Max-saved patch in this repository's `examples/` folder has such boxes, and none of
  them loads.

There is no workaround short of a fix in maxpylang.

## Frozen Max for Live devices cannot be loaded

When Max saves a device *frozen* (with its files embedded, which is how devices are usually
shared), the patch is stored in a binary container rather than plain JSON. `load_amxd()` and
`mp.MaxPatch(load_file="device.amxd")` fail on these with `UnicodeDecodeError`. Of the 83
devices that ship with Max 9.1, 80 are frozen.

Devices **written by maxpylang** are never frozen and load fine. To load a device made in Max,
unfreeze it in Max and save it again first.

## `js` boxes are written with the counts before the file name

For `patch.place("js double.js")`, maxpylang writes the box as `js 1 1 double.js`: the inlet
and outlet counts, then the file name. Max's reference for `js` puts the file name first, and
every `js` box in Max's own patches starts with the file name (`js double.js`). Max may not
find the script in the box maxpylang writes. Check `js` boxes in Max after generating a patch.

## Live's UI objects are unknown

`live.dial`, `live.slider`, `live.numbox`, `live.gain~`, `live.toggle` and `live.text` are
missing from maxpylang's object data. Placing one gives an `UnknownObjectWarning` and a box with no inlets
or outlets. Cycling '74's own devices use them constantly (`live.dial` is in 65 of the 71 audio
effects that ship with Max), so for now, use `dial`, `slider` or `number` and swap in the
`live.*` versions in Max.

## `noteout` needs two arguments

maxpylang's data for `noteout` marks its port and channel as required, so a plain `noteout`
(or `noteout 1`) gives an `UnknownObjectWarning` and no inlets. Give it a port and a channel:
`patch.place("noteout a 1")`. (`notein` had the same problem and was fixed.)

## Two unknown objects in one patch overwrite each other

Every unknown object shares one box record. Place two, and the saved file has two copies of the
last one, with the same id: `place("foo1")` then `place("foo2")` saves `foo2` twice, and loading
that file gives one object. Fix each `UnknownObjectWarning` before saving.

## Bare stubs for objects that need arguments are unknown, silently

About 140 stubs in `maxpylang.objects` are for objects whose data requires arguments, such as
`delay`, `pipe`, `prepend`, `join`, `loadmess` and `noteout`. Placed bare, each becomes an
unknown object with no inlets and **no warning**, while a type checker still sees inlets. Call
the stub with its arguments: `delay(500)`, `prepend("set")`. Another 130 or so stubs, such as
`array.*`, `string.*` and `v8`, have no object data at all and are always unknown. `expr` is
unknown even with arguments.

## Random placement crashes

`patch.place(..., randpick=True)` and `spacing_type="random"` raise
`NameError: name 'np' is not defined`. Pick objects with Python's `random` module instead, and
place them with the default grid or with `set_position()`.

## `place()` prints debug lines

Each `place()` prints two extra lines, such as `('cycle~ 440',)` and `['cycle~ 440']`,
whatever `verbose` is set to, and loading a patch prints one per object. They are harmless.

## `SyntaxWarning` on import

Python 3.12 and newer print a few `SyntaxWarning: invalid escape sequence` lines from
maxpylang's source the first time it loads. They are harmless.
