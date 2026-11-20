"""Dividing a number
/ divides by its argument. counter's 0..15 divided by 15. gives 0 to 1 in sixteen steps, used as the volume of a 220 Hz tone: it swells, then starts again. The . in 15. makes the division float; / 15 would give only 0 or 1.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, metro

patch = mp.MaxPatch()
clock = patch.place(metro(150, active=1))[0]
step = patch.place(counter(0, 15))[0]
share = patch.place("/ 15.")[0]
osc = patch.place(cycle_tilde(220))[0]
level = patch.place("*~ 0.")[0]      # the right inlet sets the volume
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], share.ins[0]),
    (share.outs[0], level.ins[1]),
    (osc.outs[0], level.ins[0]),
    (level.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("div")
