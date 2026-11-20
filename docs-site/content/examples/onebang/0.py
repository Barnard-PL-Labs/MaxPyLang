"""One bang, then wait
onebang lets one bang through its left inlet, then shuts until its right inlet gets a bang. A fast 100 ms metro knocks on it and a 1 s metro reopens it, so a new random note sounds about once a second, on the fast grid.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, metro, mtof, onebang, random

patch = mp.MaxPatch()
fast = patch.place(metro(100, active=1))[0]
reopen = patch.place(metro(1000, active=1))[0]
once = patch.place(onebang(1))[0]      # 1: starts open
pick = patch.place(random(12))[0]
note = patch.place("+ 60")[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (fast.outs[0], once.ins[0]),
    (reopen.outs[0], once.ins[1]),
    (once.outs[0], pick.ins[0]),
    (pick.outs[0], note.ins[0]),
    (note.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("onebang")
