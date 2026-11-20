"""A leap that levels off
atan gives the angle whose tangent is its input, never more than π/2. For 0..15 it shoots up from 0 then flattens near 1.5, so the melody leaps from note 54 and then barely moves.
"""
import maxpylang as mp
from maxpylang.objects import atan, counter, cycle_tilde, ezdac_tilde, metro, mtof

patch = mp.MaxPatch()
clock = patch.place(metro(180, active=1))[0]
step = patch.place(counter(0, 15))[0]
angle = patch.place(atan)[0]
depth = patch.place("* 16.")[0]
note = patch.place("+ 54.")[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], angle.ins[0]),
    (angle.outs[0], depth.ins[0]),
    (depth.outs[0], note.ins[0]),
    (note.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("atan")
