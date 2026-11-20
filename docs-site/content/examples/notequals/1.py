"""Mostly high, sometimes low
notequals is the long name of !=. random picks 0..4, and notequals 0 is 1 four times in five: times 7 plus 53 plays middle C (60) mostly, and the F below (53) when random picks 0.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, metro, mtof, random

patch = mp.MaxPatch()
clock = patch.place(metro(180, active=1))[0]
pick = patch.place(random(5))[0]
high = patch.place("notequals 0")[0]
fifth = patch.place("* 7")[0]
note = patch.place("+ 53")[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], pick.ins[0]),
    (pick.outs[0], high.ins[0]),
    (high.outs[0], fifth.ins[0]),
    (fifth.outs[0], note.ins[0]),
    (note.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("notequals")
