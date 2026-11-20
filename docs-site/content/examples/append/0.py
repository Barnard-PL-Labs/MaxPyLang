"""Add a glide time to each note
append puts its arguments after every message. Each note becomes "note 150", which tells line to slide to it in 150 ms instead of jumping.
"""
import maxpylang as mp
from maxpylang.objects import append, cycle_tilde, ezdac_tilde, line, metro, mtof, random

patch = mp.MaxPatch()
clock = patch.place(metro(300, active=1))[0]
pick = patch.place(random(13))[0]
note = patch.place("+ 60")[0]
timed = patch.place(append(150))[0]      # 64 -> "64 150"
slide = patch.place(line(60))[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], pick.ins[0]),
    (pick.outs[0], note.ins[0]),
    (note.outs[0], timed.ins[0]),
    (timed.outs[0], slide.ins[0]),
    (slide.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("append")
