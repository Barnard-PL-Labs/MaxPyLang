"""Checks: catch a misspelled object name before saving."""
import warnings

import maxpylang as mp
from maxpylang.exceptions import UnknownObjectWarning

# Turn the warning into an error, so a typo stops the script at the line that made it.
warnings.simplefilter("error", UnknownObjectWarning)

patch = mp.MaxPatch(verbose=False)
try:
    patch.place("cycel~ 440")  # typo for cycle~
except UnknownObjectWarning as err:
    print("caught:", err)

# Without the filter, the object is placed with no inlets or outlets.
warnings.simplefilter("ignore", UnknownObjectWarning)
typo = patch.place("cycel~ 440")[0]
print("notknown():", typo.notknown(), "| inlets:", len(typo.ins))

# delete() takes object ids ("obj-1"), the keys of patch.objs.
typo_id = next(obj_id for obj_id, obj in patch.objs.items() if obj is typo)
patch.delete(objs=[typo_id])

osc = patch.place("cycle~ 440")[0]
print("notknown():", osc.notknown(), "| inlets:", len(osc.ins))

# save() prints the PatchCheck report: unknown objects, js files, abstractions.
patch.save("checked")
