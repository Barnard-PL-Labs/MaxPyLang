"""Turning an arpeggio upside down
rminus is the long name of !-. 0, 3, 6 ... 21 counted up in minor thirds; rminus 84 gives 84 minus each, so the same arpeggio falls from note 84.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, metro, mtof

patch = mp.MaxPatch()
clock = patch.place(metro(220, active=1))[0]
step = patch.place(counter(0, 7))[0]
thirds = patch.place("* 3")[0]
flip = patch.place("rminus 84")[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], thirds.ins[0]),
    (thirds.outs[0], flip.ins[0]),
    (flip.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("rminus")
