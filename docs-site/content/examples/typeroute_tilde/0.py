"""Sorting audio from numbers
typeroute~ sends what comes in out a different outlet for each kind: audio out the first, floats out the fourth. A sine and a number box share its inlet; the sine goes on to the speakers and the number to a display.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, flonum, typeroute_tilde

patch = mp.MaxPatch()
osc = patch.place(cycle_tilde(220))[0]
typed = patch.place(flonum)[0]
sort = patch.place(typeroute_tilde)[0]
shown = patch.place(flonum)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (osc.outs[0], sort.ins[0]),
    (typed.outs[0], sort.ins[0]),
    (sort.outs[0], quiet.ins[0]),      # audio
    (sort.outs[3], shown.ins[0]),      # floats
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("typeroute")
