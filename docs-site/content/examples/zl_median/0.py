"""Smooth out random notes
zl.median sends out the middle value of a list. zl.group gathers random notes in threes and only the middle one of each three plays, so the wildest notes are left out. Press ▶, then set the number box to 7 to take the middle of seven for a smoother line.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, metro, mtof, number, random, zl_group, zl_median

patch = mp.MaxPatch()
clock = patch.place(metro(120, active=1))[0]
pick = patch.place(random(25))[0]
three = patch.place(zl_group(3))[0]      # 3 numbers -> one list
size = patch.place(number)[0]            # a new group size
middle = patch.place(zl_median)[0]
note = patch.place("+ 55")[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], pick.ins[0]),
    (pick.outs[0], three.ins[0]),
    (size.outs[0], three.ins[1]),
    (three.outs[0], middle.ins[0]),
    (middle.outs[0], note.ins[0]),
    (note.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("zl.median")
