"""A square-root climb
sqrt outputs the square root of its input. 220 Hz times the roots of 1..16 climbs from 220 to 880 Hz, in big steps at first and smaller and smaller ones after.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, metro, sqrt

patch = mp.MaxPatch()
clock = patch.place(metro(200, active=1))[0]
step = patch.place(counter(1, 16))[0]
root = patch.place(sqrt)[0]
hz = patch.place("* 220.")[0]       # float argument: sqrt's output is a float
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], root.ins[0]),
    (root.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("sqrt")
