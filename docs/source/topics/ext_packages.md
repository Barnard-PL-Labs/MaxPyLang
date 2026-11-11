---
description: "import_objs() for objects from Max packages."
---

# Objects from packages

maxpylang ships with data for every object in Max, MSP and Jitter. For an object from a
package (for example one installed with Max's Package Manager), import its data first:

```python
import maxpylang as mp

mp.import_objs("my_package")               # the package's folder name
mp.import_objs("vanilla", overwrite=True)  # refresh max, msp and jit
```

**Max must be open while this runs**: maxpylang reads each object's reference page and asks Max
for its inlet and outlet counts. If the import fails, make sure Max is open and run it again. The data is saved inside the installed maxpylang, so you import a package once.
It also regenerates the stubs in `maxpylang.objects`, so the package's objects autocomplete.

Until a package is imported, its objects are {doc}`unknown <unknown_objs>`.
