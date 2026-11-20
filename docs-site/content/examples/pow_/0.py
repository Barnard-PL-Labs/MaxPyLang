"""Raising to a power
pow raises its input to the power of its argument. 0..6 squared is 0, 1, 4, 9, 16, 25, 36: above note 48, each step of the melody is wider than the last.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, metro, mtof, pow_

patch = mp.MaxPatch()
clock = patch.place(metro(250, active=1))[0]
step = patch.place(counter(0, 6))[0]
square = patch.place(pow_(2))[0]
up = patch.place("+ 48")[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], square.ins[0]),
    (square.outs[0], up.ins[0]),
    (up.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("pow")
