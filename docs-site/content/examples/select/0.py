"""Do something on one value
select sends a bang out of its left outlet when its input matches (0), and passes other values out of the right. The first beat of every four is an octave higher.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, metro, mtof, select

patch = mp.MaxPatch()
clock = patch.place(metro(250, active=1))[0]
beat = patch.place(counter(0, 3))[0]
first = patch.place(select(0))[0]
high = patch.place("message 72")[0]
low = patch.place("message 60")[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], beat.ins[0]),
    (beat.outs[0], first.ins[0]),
    (first.outs[0], high.ins[0]),
    (first.outs[1], low.ins[0]),
    (high.outs[0], hz.ins[0]),
    (low.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("select")
