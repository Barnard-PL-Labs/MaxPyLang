"""Lifting the low notes
lessthaneq is the long name of <=. trigger sends each random note out of its right outlet first: lessthaneq 65 gives 1 for notes up to 65, and times 12 stores 12 or 0 in the cold inlet of + 0. Then the note goes left into + 0, so the low notes play an octave up.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, metro, mtof, random, trigger

patch = mp.MaxPatch()
clock = patch.place(metro(200, active=1))[0]
pick = patch.place(random(24))[0]
note = patch.place("+ 54")[0]
both = patch.place(trigger("i", "i"))[0]
low = patch.place("lessthaneq 65")[0]
octave = patch.place("* 12")[0]
lift = patch.place("+ 0")[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], pick.ins[0]),
    (pick.outs[0], note.ins[0]),
    (note.outs[0], both.ins[0]),
    (both.outs[1], low.ins[0]),       # right outlet fires first
    (low.outs[0], octave.ins[0]),
    (octave.outs[0], lift.ins[1]),
    (both.outs[0], lift.ins[0]),
    (lift.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("lessthaneq")
