"""Map one range to another
scale maps 0..15 onto 48..72. Here a counter's 16 steps become a two-octave climb.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, metro, mtof, scale

patch = mp.MaxPatch()
clock = patch.place(metro(120, active=1))[0]
step = patch.place(counter(0, 15))[0]
span = patch.place(scale(0, 15, 48, 72))[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], span.ins[0]),
    (span.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("scale")
