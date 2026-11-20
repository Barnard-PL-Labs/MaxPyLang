"""From period to frequency
rdiv is the long name of !/. A wave that repeats every 2, 3 ... 9 ms has a frequency of 1000 divided by that, so rdiv 1000. turns the periods into 500 Hz down to 111 Hz.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, metro

patch = mp.MaxPatch()
clock = patch.place(metro(200, active=1))[0]
period = patch.place(counter(2, 9))[0]
hz = patch.place("rdiv 1000.")[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], period.ins[0]),
    (period.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("rdiv")
