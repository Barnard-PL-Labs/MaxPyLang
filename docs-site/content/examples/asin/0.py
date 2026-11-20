"""Fast at the edges, slow in the middle
asin is the inverse of sin: it takes -1..1 and gives the angle, -π/2..π/2. An even climb from -1 to 1 comes out as a pitch that leaps at the start and end and inches through the middle.
"""
import maxpylang as mp
from maxpylang.objects import asin, counter, cycle_tilde, ezdac_tilde, metro, mtof, scale

patch = mp.MaxPatch()
clock = patch.place(metro(150, active=1))[0]
step = patch.place(counter(0, 20))[0]
unit = patch.place(scale(0, 20, -1., 1.))[0]
angle = patch.place(asin)[0]
depth = patch.place("* 8.")[0]
note = patch.place("+ 66.")[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], unit.ins[0]),
    (unit.outs[0], angle.ins[0]),
    (angle.outs[0], depth.ins[0]),
    (depth.outs[0], note.ins[0]),
    (note.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("asin")
