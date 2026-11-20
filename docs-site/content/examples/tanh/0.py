"""A swell that saturates
tanh (hyperbolic tangent) rises steeply, then flattens just under 1. Used as a volume, 0 .. 5 makes the tone swell quickly and then hold, never going past full level.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, metro, tanh

patch = mp.MaxPatch()
clock = patch.place(metro(150, active=1))[0]
step = patch.place(counter(0, 15))[0]
unit = patch.place("/ 3.")[0]
soft = patch.place(tanh)[0]
osc = patch.place(cycle_tilde(294))[0]
level = patch.place("*~ 0.")[0]       # the right inlet sets the volume
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], unit.ins[0]),
    (unit.outs[0], soft.ins[0]),
    (soft.outs[0], level.ins[1]),
    (osc.outs[0], level.ins[0]),
    (level.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("tanh")
