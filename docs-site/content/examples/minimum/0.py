"""A ceiling over the melody
minimum outputs the smaller of its input and its argument. The scale climbs 60..75, but minimum 70 stops it at note 70, which repeats until the counter starts again.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, metro, minimum, mtof

patch = mp.MaxPatch()
clock = patch.place(metro(160, active=1))[0]
step = patch.place(counter(60, 75))[0]
ceiling = patch.place(minimum(70))[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], ceiling.ins[0]),
    (ceiling.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("minimum")
