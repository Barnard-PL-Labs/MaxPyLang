"""An S-shaped sweep
atan2 gives the angle of the point (x, y): y in the left inlet, x in the right. With x = 2 and y counting -8..8, the angle climbs slowly, rushes through the middle, and slows again. Press ▶, then drag the number box to set x: 0 jumps between two notes, larger values smooth the curve.
"""
import maxpylang as mp
from maxpylang.objects import atan2, counter, cycle_tilde, ezdac_tilde, metro, mtof, number

patch = mp.MaxPatch()
clock = patch.place(metro(150, active=1))[0]
step = patch.place(counter(0, 16))[0]
y = patch.place("- 8")[0]
x = patch.place(number)[0]
angle = patch.place(atan2(2.))[0]
depth = patch.place("* 9.")[0]
note = patch.place("+ 66.")[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], y.ins[0]),
    (y.outs[0], angle.ins[0]),
    (x.outs[0], angle.ins[1]),
    (angle.outs[0], depth.ins[0]),
    (depth.outs[0], note.ins[0]),
    (note.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("atan2")
