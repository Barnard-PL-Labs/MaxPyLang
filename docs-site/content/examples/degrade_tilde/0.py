"""Lo-fi: fewer bits
degrade~ lowers the sample rate and bit depth. 0.2 of the rate and 4 bits turn a sine into a crunchy video-game tone.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, degrade_tilde, ezdac_tilde

patch = mp.MaxPatch()
osc = patch.place(cycle_tilde(330))[0]
crunch = patch.place(degrade_tilde(0.2, 4))[0]
quiet = patch.place("*~ 0.2")[0]        # turn it down
out = patch.place(ezdac_tilde)[0]       # to both speakers

patch.connect(
    (osc.outs[0], crunch.ins[0]),
    (crunch.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("degrade_tilde")
