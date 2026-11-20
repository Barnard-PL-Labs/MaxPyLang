---
description: "import_objs() for objects from Max packages."
---

# Objects from packages

maxpylang ships with data for most objects in Max, MSP and Jitter. For an object from a
package (for example one installed with Max's Package Manager), import its data first:

```python
import maxpylang as mp

mp.import_objs("my_package")               # the package's folder name
mp.import_objs("vanilla", overwrite=True)  # refresh max, msp and jit
```

This works only on macOS, with Max installed in `/Applications/Max.app`. **Max must be open
while it runs**: maxpylang reads each object's reference page and asks Max for its inlet and
outlet counts. If the import fails, make sure Max is open and try again. The data is saved
inside the installed maxpylang, so you import a package once.

It also writes stubs for the package into `maxpylang.objects`, which you can import and run.
They have no type information, though, so editors do not autocomplete them and type checkers
do not check their cords.

Until a package is imported, its objects are {doc}`unknown <unknown_objs>`.
