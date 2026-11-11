---
description: "Abstractions and js objects, whose files must sit next to the patch."
---

# Linked files: abstractions and `js`

Some boxes depend on another file next to the patch:

- an **abstraction**, a box named after another patch (`half_gain` uses `half_gain.maxpat`);
- a **`js` object**, which runs a JavaScript file (`js double.js`).

maxpylang reads those files to learn how many inlets and outlets the box has, so they must be
**in the current folder when the script runs**. Copy them along with the saved patch: Max looks
for them next to it too.

If the abstraction does not exist yet, declare its inlets and outlets yourself:

```python
reverb = mp.MaxObject("my_reverb", abstraction=True, inlets=2, outlets=2)
patch.place(reverb)
```

:::{warning}
maxpylang writes a `js` box with its inlet and outlet counts before the file name
(`js 1 1 double.js`), while Max puts the file name first. Check `js` boxes in Max; see
{doc}`../guide/known-issues`.
:::

`obj.link("file.js")` links a `js` box, or an abstraction, to a file after it is placed.
`save()` lists every linked and unlinked file in its `PatchCheck` report.

```{literalinclude} ../../examples/abstractions.py
:language: python
```
