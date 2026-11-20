"""A sweep that speeds up
tan grows faster and faster as the angle nears π/2. Angles 0 .. 1.35 give 0 .. 4.5, heard as 200 .. 645 Hz: the pitch creeps up, then shoots.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, metro, tan

patch = mp.MaxPatch()
clock = patch.place(metro(150, active=1))[0]
step = patch.place(counter(0, 15))[0]
angle = patch.place("* 0.09")[0]
steep = patch.place(tan)[0]
width = patch.place("* 100.")[0]
hz = patch.place("+ 200.")[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], angle.ins[0]),
    (angle.outs[0], steep.ins[0]),
    (steep.outs[0], width.ins[0]),
    (width.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("tan")
