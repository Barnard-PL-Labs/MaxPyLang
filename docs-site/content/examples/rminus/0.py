"""Subtracting from a number
!- subtracts its input FROM the argument: 72 - 0, 72 - 1, ... 72 - 12. A rising counter becomes a falling chromatic scale.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, metro, mtof

patch = mp.MaxPatch()
clock = patch.place(metro(160, active=1))[0]
step = patch.place(counter(0, 12))[0]
down = patch.place("!- 72")[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], down.ins[0]),
    (down.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("rminus")
