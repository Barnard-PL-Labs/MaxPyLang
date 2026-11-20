"""Math written as a formula
expr evaluates a C-like formula; $i1 is the integer arriving in its left inlet. Here "$i1 * 7 % 12 + 60" turns a count into notes a fifth apart, folded into one octave: a whole melody from one box.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, metro, mtof

patch = mp.MaxPatch()
clock = patch.place(metro(220, active=1))[0]
step = patch.place(counter(0, 11))[0]
notes = patch.place("expr $i1 * 7 % 12 + 60")[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], notes.ins[0]),
    (notes.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("expr")
