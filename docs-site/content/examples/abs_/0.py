"""Down and back up
abs drops a number's minus sign. 0..12 minus 6 runs -6..6; abs makes that 6, 5 ... 0 ... 5, 6, so the whole-tone melody falls to note 60 and climbs back.
"""
import maxpylang as mp
from maxpylang.objects import abs_, counter, cycle_tilde, ezdac_tilde, metro, mtof

patch = mp.MaxPatch()
clock = patch.place(metro(180, active=1))[0]
step = patch.place(counter(0, 12))[0]
centre = patch.place("- 6")[0]
size = patch.place(abs_)[0]
tone = patch.place("* 2")[0]
up = patch.place("+ 60")[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], centre.ins[0]),
    (centre.outs[0], size.ins[0]),
    (size.outs[0], tone.ins[0]),
    (tone.outs[0], up.ins[0]),
    (up.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("abs")
