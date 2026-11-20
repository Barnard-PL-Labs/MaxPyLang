"""A fall that plunges
acos is the inverse of cos: 0 gives π/2 and 1 gives 0. Counting 0.0 .. 1.0 in tenths, the pitch falls from note 73.6 to 50, gently at first and steeply at the end.
"""
import maxpylang as mp
from maxpylang.objects import acos, counter, cycle_tilde, ezdac_tilde, metro, mtof

patch = mp.MaxPatch()
clock = patch.place(metro(200, active=1))[0]
step = patch.place(counter(0, 10))[0]
unit = patch.place("/ 10.")[0]
angle = patch.place(acos)[0]
depth = patch.place("* 15.")[0]
note = patch.place("+ 50.")[0]
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
patch.save("acos")
