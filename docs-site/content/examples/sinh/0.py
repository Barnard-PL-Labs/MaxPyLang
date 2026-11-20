"""A slow start, then a rocket
sinh (hyperbolic sine) grows almost exponentially. Inputs 0 .. 3 give 0 .. 10, heard as 200 .. 600 Hz: barely moving at first, then racing upward.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, metro, sinh

patch = mp.MaxPatch()
clock = patch.place(metro(150, active=1))[0]
step = patch.place(counter(0, 15))[0]
unit = patch.place("/ 5.")[0]
grow = patch.place(sinh)[0]
width = patch.place("* 40.")[0]
hz = patch.place("+ 200.")[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], unit.ins[0]),
    (unit.outs[0], grow.ins[0]),
    (grow.outs[0], width.ins[0]),
    (width.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("sinh")
