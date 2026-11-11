"""Linked files: build an abstraction, use it in another patch, and link a js file."""
from pathlib import Path

import maxpylang as mp

# 1. An abstraction is a patch saved next to the patch that uses it.
#    Its inlet and outlet objects become the box's inlets and outlets.
sub = mp.MaxPatch(verbose=False)
sub.set_position(30, 30)
src = sub.place("inlet")[0]
sub.set_position(30, 90)
amp = sub.place("*~ 0.5")[0]
sub.set_position(30, 150)
dst = sub.place("outlet")[0]
sub.connect((src.outs[0], amp.ins[0]), (amp.outs[0], dst.ins[0]))
sub.save("half_gain", check=False)

# 2. Place it by name. maxpylang finds half_gain.maxpat in the current folder.
patch = mp.MaxPatch(verbose=False)
patch.set_position(30, 30)
osc = patch.place("cycle~ 440")[0]
patch.set_position(30, 90)
half = patch.place("half_gain")[0]
print("half_gain:", len(half.ins), "inlet,", len(half.outs), "outlet")
patch.connect((osc.outs[0], half.ins[0]))

# 3. An abstraction that does not exist yet: declare its inlets and outlets.
patch.set_position(200, 90)
later = patch.place(mp.MaxObject("my_reverb", abstraction=True, inlets=2, outlets=2))[0]
patch.connect((half.outs[0], later.ins[0]))

# 4. A js object reads its inlet and outlet counts from the .js file.
#    Check js boxes in Max: maxpylang 0.1.1 writes the counts before the file name.
Path("double.js").write_text("inlets = 1;\noutlets = 1;\nfunction msg_float(x) { outlet(0, x * 2); }\n")
patch.set_position(400, 30)
js = patch.place("js double.js")[0]
print("js:", len(js.ins), "inlet,", len(js.outs), "outlet")

# save() lists the linked files; copy them along with the patch.
patch.save("uses_abstractions")
