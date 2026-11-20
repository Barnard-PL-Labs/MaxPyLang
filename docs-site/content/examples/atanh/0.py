"""Racing toward the edges
atanh (inverse hyperbolic tangent) takes -1..1 and runs off toward infinity near the ends. -0.9 .. 0.9 in even steps becomes a pitch that leaps at both ends and drifts through the middle.
"""
import maxpylang as mp
from maxpylang.objects import atanh, counter, cycle_tilde, ezdac_tilde, metro, mtof, scale

patch = mp.MaxPatch()
clock = patch.place(metro(150, active=1))[0]
step = patch.place(counter(0, 18))[0]
unit = patch.place(scale(0, 18, -0.9, 0.9))[0]
curve = patch.place(atanh)[0]
depth = patch.place("* 8.")[0]
note = patch.place("+ 66.")[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], unit.ins[0]),
    (unit.outs[0], curve.ins[0]),
    (curve.outs[0], depth.ins[0]),
    (depth.outs[0], note.ins[0]),
    (note.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("atanh")
