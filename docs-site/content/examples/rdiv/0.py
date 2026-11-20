"""The undertone series
!/ divides its argument BY its input: 1760 / 1, 1760 / 2, 1760 / 3 ... The pitch falls in ever smaller steps, from 1760 Hz down to 220 Hz.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, metro

patch = mp.MaxPatch()
clock = patch.place(metro(250, active=1))[0]
step = patch.place(counter(1, 8))[0]
under = patch.place("!/ 1760.")[0]   # the . makes it divide as floats
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], under.ins[0]),
    (under.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("rdiv")
