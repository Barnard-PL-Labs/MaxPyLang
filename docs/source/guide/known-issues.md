---
description: "Bugs in maxpylang that change what works: loading patches saved by Max, frozen devices, js and comment boxes, unknown objects, random placement."
---

# Known issues

These are bugs in maxpylang, as of the code on `main`, that change what the rest of these
pages can promise. Each was found by running maxpylang against patches and devices saved by
Max 9.1, and checked again against the current code.

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

A fix is in review ([pull request #20](https://github.com/Barnard-PL-Labs/MaxPyLang/pull/20)).
Until it is merged and released, there is no workaround.

## Frozen Max for Live devices cannot be loaded

When Max saves a device *frozen* (with its files embedded, which is how devices are usually
shared), the patch is stored in a binary container rather than plain JSON. `load_amxd()` and
`mp.MaxPatch(load_file="device.amxd")` fail on these with `UnicodeDecodeError`. Of the 83
devices that ship with Max 9.1, 80 are frozen.

Devices **written by maxpylang** are never frozen and load fine. To load a device made in Max,
unfreeze it in Max and save it again first.

## Two unknown objects in one patch overwrite each other

Every unknown object shares one box record. Place two, and the saved file has two copies of the
last one, with the same id: `place("foo1")` then `place("foo2")` saves `foo2` twice, and loading
that file gives one object. Fix each `UnknownObjectWarning` before saving.

## Some stubs are unknown objects, silently

About 235 of the 1,165 stubs in `maxpylang.objects` have no object data behind them, such as
`array.*`, `string.*` and `v8`. Placed, each becomes an unknown object with no inlets, and
**no warning** is raised (the `PatchCheck: unknown objects` line at `save()` does list it),
while a type checker still sees inlets. If `len(obj.ins)` is 0, check `obj.notknown()`.

## `js` boxes are written with the counts before the file name

For `patch.place("js double.js")`, maxpylang writes the box as `js 1 1 double.js`: the inlet
and outlet counts, then the file name. Max's reference for `js` puts the file name first, and
every `js` box in Max's own patches starts with the file name (`js double.js`). Max may not
find the script in the box maxpylang writes. Check `js` boxes in Max after generating a patch.

## Comments start with the word "comment"

`patch.place("comment hello there")` writes the box text as `comment hello there`, so the
comment shows the word "comment" in Max. (Message boxes don't have this problem.)

## Random placement crashes

`patch.place(..., randpick=True)` and `spacing_type="random"` raise
`NameError: name 'np' is not defined`. Pick objects with Python's `random` module instead, and
place them with the default grid or with `set_position()`.
