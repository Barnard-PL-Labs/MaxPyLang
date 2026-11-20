"""Checks: catch a misspelled object and a wrong cord, then save a patch that passes."""
import warnings

import maxpylang as mp
from maxpylang import ConnectionWarning
from maxpylang.exceptions import UnknownObjectWarning
from maxpylang.objects import cycle_tilde, ezdac_tilde, flonum

# Turn the warnings into errors, so a mistake stops the script at the line that made it.
warnings.simplefilter("error", UnknownObjectWarning)
warnings.simplefilter("error", ConnectionWarning)

patch = mp.MaxPatch(verbose=False)
try:
    patch.place("cycel~ 440")  # typo for cycle~
except UnknownObjectWarning as err:
    print("caught:", err)

osc = patch.place(cycle_tilde(440))[0]
shown = patch.place(flonum)[0]
try:
    # Audio into a number box (it needs snapshot~); a type checker flags this line too.
    patch.connect((osc.outs[0], shown.ins[0]))  # error
except ConnectionWarning as err:
    print("caught:", str(err).splitlines()[0])

# delete() takes object ids ("obj-1"), the keys of patch.objs.
shown_id = next(obj_id for obj_id, obj in patch.objs.items() if obj is shown)
patch.delete(objs=[shown_id])

out = patch.place(ezdac_tilde)[0]
patch.connect((osc.outs[0], out.ins[0]), (osc.outs[0], out.ins[1]))

# save() checks the whole patch (GraphWarning) and prints the PatchCheck report.
patch.save("checked")
