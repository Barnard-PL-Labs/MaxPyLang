"""Swap the order
swap sends its left-inlet number out the RIGHT outlet first, then its stored right-inlet number out the left. Crossed into -, that makes 72 minus the count: a scale falling from 72. Press ▶, then type a new top note into the number box.
"""
import maxpylang as mp
from maxpylang.objects import counter, cycle_tilde, ezdac_tilde, metro, mtof, number, swap

patch = mp.MaxPatch()
clock = patch.place(metro(250, active=1))[0]
step = patch.place(counter(0, 7))[0]
top = patch.place(number)[0]
cross = patch.place(swap(72))[0]
minus = patch.place("- 0")[0]
hz = patch.place(mtof)[0]
osc = patch.place(cycle_tilde)[0]
quiet = patch.place("*~ 0.2")[0]
out = patch.place(ezdac_tilde)[0]

patch.connect(
    (clock.outs[0], step.ins[0]),
    (step.outs[0], cross.ins[0]),
    (top.outs[0], cross.ins[1]),
    (cross.outs[1], minus.ins[1]),     # the count, first, into the cold inlet
    (cross.outs[0], minus.ins[0]),     # then 72 into the hot one
    (minus.outs[0], hz.ins[0]),
    (hz.outs[0], osc.ins[0]),
    (osc.outs[0], quiet.ins[0]),
    (quiet.outs[0], out.ins[0]),
    (quiet.outs[0], out.ins[1]),
)
patch.save("swap")
