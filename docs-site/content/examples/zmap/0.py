"""Map a range, and hold the ends
zmap maps 4..11 onto notes 60..74, like scale, but clips anything outside: counts 0..3 all play 60 and 12..15 all play 74. You hear a hold, a whole-tone climb, then a hold at the top.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, metro, mtof, zmap

patch = mp.MaxPatch()
clock = patch.place(metro(150, active=1))[0]
step = patch.place(counter(0, 15))[0]
span = patch.place(zmap(4, 11, 60, 74))[0]
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
patch.save("zmap")
