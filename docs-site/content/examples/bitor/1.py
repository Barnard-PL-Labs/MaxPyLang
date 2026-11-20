"""Only odd notes
bitor is the long name of |. bitor 1 turns on the lowest bit, so every random number 0..11 becomes odd: above note 60 that leaves 61, 63, 65, 67, 69, 71, a whole-tone scale.
"""
import maxpylang as mp
from maxpylang.objects import cycle_tilde, ezdac_tilde, metro, mtof, random

patch = mp.MaxPatch()
clock = patch.place(metro(180, active=1))[0]
pick = patch.place(random(12))[0]
odd = patch.place("bitor 1")[0]
note = patch.place("+ 60")[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], pick.ins[0]),
    (pick.outs[0], odd.ins[0]),
    (odd.outs[0], note.ins[0]),
    (note.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("bitor")
