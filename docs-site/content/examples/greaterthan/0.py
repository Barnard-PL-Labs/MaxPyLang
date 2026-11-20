"""Sometimes a fifth higher
> outputs 1 when its input is greater than its argument. random picks 0..99, and > 70 is 1 about 30% of the time: those ticks jump from middle C up a fifth. Press ▶, then drag the number box to set the threshold: higher means fewer jumps.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, metro, mtof, number, random

patch = mp.MaxPatch()
clock = patch.place(metro(160, active=1))[0]
pick = patch.place(random(100))[0]
threshold = patch.place(number)[0]
above = patch.place("> 70")[0]
fifth = patch.place("* 7")[0]
note = patch.place("+ 60")[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], pick.ins[0]),
    (pick.outs[0], above.ins[0]),
    (threshold.outs[0], above.ins[1]),
    (above.outs[0], fifth.ins[0]),
    (fifth.outs[0], note.ins[0]),
    (note.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("greaterthan")
