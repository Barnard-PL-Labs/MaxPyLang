---
description: "Names maxpylang does not know, what happens to them, and how to replace them."
---

# Unknown objects

maxpylang knows an object when its object data has an entry for it and the box has the
arguments that entry requires. The data covers most objects in Max, MSP and Jitter, plus any
packages you import (see {doc}`ext_packages`). Anything else is *unknown*.

**When you place one,** you get an `UnknownObjectWarning` and an object with no inlets or
outlets. Usually it is a typo or a missing argument; fix it. `obj.notknown()` tells you in code.
Fix every unknown object before saving: in 0.1.1, two unknown objects in one patch overwrite
each other (see {doc}`../guide/known-issues`).

**When you load a patch that has one,** for example from a package you have not imported, the
object keeps its cords and saves back unchanged, but you cannot edit it. (In 0.1.1 most
patches saved by Max fail to load; see {doc}`../guide/known-issues`.) Replace it with a
known object by id:

```python
patch = mp.MaxPatch(load_file="old.maxpat")
patch.replace("obj-3", "cycle~ 440")   # keeps the cords that fit the new object
```

`save()` lists the unknown objects that remain; see {doc}`../guide/checks`.

Some objects that exist in Max are still unknown to maxpylang, notably Live's UI objects
(`live.dial`, `live.slider`, `live.gain~`). `noteout` is known but needs a port and channel,
`noteout a 1`; see {doc}`../guide/known-issues`.
