"""Transposing down
minus is the long name of -: it subtracts its argument. The counter plays notes 72..79, and minus 12 moves them an octave down. Press ▶, then drag the number box to transpose by a different interval.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, metro, mtof, number

patch = mp.MaxPatch()
clock = patch.place(metro(200, active=1))[0]
step = patch.place(counter(72, 79))[0]
interval = patch.place(number)[0]
down = patch.place("minus 12")[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], down.ins[0]),
    (interval.outs[0], down.ins[1]),
    (down.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("minus")
