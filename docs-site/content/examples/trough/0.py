"""Only ever lower
trough outputs a number only when it is the lowest so far, so the random notes can only fall. Every 3 seconds a 24 into its right inlet resets the trough, and the fall starts again from the top.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, metro, mtof, random, trough

patch = mp.MaxPatch()
clock = patch.place(metro(200, active=1))[0]
reset = patch.place(metro(3000, active=1))[0]
top = patch.place("message 24")[0]
pick = patch.place(random(24))[0]
low = patch.place(trough)[0]
note = patch.place("+ 52")[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (reset.outs[0], top.ins[0]),
    (top.outs[0], low.ins[1]),         # sets the trough, no output
    (clock.outs[0], pick.ins[0]), (pick.outs[0], low.ins[0]), (low.outs[0], note.ins[0]),
    (note.outs[0], hz.ins[0]), (hz.outs[0], osc.ins[0]), (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]), (quiet.outs[0], out.ins[1]),
)
patch.save("trough")
