"""A floor under the melody
maximum outputs the larger of its input and its argument. Random notes 48..71 that fall below 60 come out as 60, so the low half of the melody turns into a repeated middle C.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, maximum, metro, mtof, random

patch = mp.MaxPatch()
clock = patch.place(metro(200, active=1))[0]
pick = patch.place(random(24))[0]
up = patch.place("+ 48")[0]
floor = patch.place(maximum(60))[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], pick.ins[0]),
    (pick.outs[0], up.ins[0]),
    (up.outs[0], floor.ins[0]),
    (floor.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("maximum")
