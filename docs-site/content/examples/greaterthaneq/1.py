"""A coin toss between octaves
greaterthaneq is the long name of >=. random picks 0..99 and greaterthaneq 50 is 1 half the time: times 12 plus 57 hops at random between A 57 and the A an octave up.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, metro, mtof, random

patch = mp.MaxPatch()
clock = patch.place(metro(150, active=1))[0]
pick = patch.place(random(100))[0]
heads = patch.place("greaterthaneq 50")[0]
octave = patch.place("* 12")[0]
note = patch.place("+ 57")[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], pick.ins[0]),
    (pick.outs[0], heads.ins[0]),
    (heads.outs[0], octave.ins[0]),
    (octave.outs[0], note.ins[0]),
    (note.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("greaterthaneq")
